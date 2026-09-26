using System.Text;
using Infrastructure.Data;
using Infrastructure.Services;
using Application.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

// Add services
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Database
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));

// Redis cache (IDistributedCache)
builder.Services.AddStackExchangeRedisCache(options =>
{
    options.Configuration = builder.Configuration.GetConnectionString("Redis");
    options.InstanceName = "DNS";
});

// Redis ConnectionMultiplexer (for direct Redis commands like SADD)
builder.Services.AddSingleton<IConnectionMultiplexer>(sp =>
{
    var config = builder.Configuration.GetConnectionString("Redis") ?? "redis:6379";
    var options = ConfigurationOptions.Parse(config);
    // Enable keyspace notifications for set events and key expiry
    // so HaproxyAclSyncService can react to whitelist changes in real time.
    options.DefaultDatabase = 0;
    var muxer = ConnectionMultiplexer.Connect(options);

    // Enable keyspace notifications on the server:
    //   K  = keyspace events
    //   E  = keyevent events
    //   g  = generic commands (del, expire, etc.)
    //   s  = set commands (sadd, srem)
    //   x  = expired events
    // => "KEgsx" covers sadd/srem/del/expired on whitelist:ips
    try
    {
        var server = muxer.GetServer(muxer.GetEndPoints().First());
        server.ConfigSet("notify-keyspace-events", "KEgsx");
    }
    catch (Exception ex)
    {
        var logger = sp.GetRequiredService<ILogger<Program>>();
        logger.LogWarning(ex, "Failed to enable Redis keyspace notifications. Real-time ACL sync will be degraded; periodic reconciliation still active.");
    }

    return muxer;
});

// JWT Authentication
var jwtSettings = builder.Configuration.GetSection("Jwt");
var secretKey = jwtSettings["SecretKey"] ?? "DefaultSuperSecretKeyForDevelopment12345!";
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtSettings["Issuer"] ?? "DnsService",
            ValidAudience = jwtSettings["Audience"] ?? "DnsPanel",
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secretKey))
        };

        // Support token from cookie as fallback
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var token = context.Request.Cookies["auth_token"];
                if (!string.IsNullOrEmpty(token))
                    context.Token = token;
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();

// Application services
builder.Services.AddScoped<IDnsService, DnsService>();
builder.Services.AddScoped<ISubscriptionService, SubscriptionService>();

// Background workers
builder.Services.AddHostedService<Infrastructure.BackgroundServices.SubscriptionExpiryNotifierWorker>();
builder.Services.AddHostedService<Infrastructure.BackgroundServices.HaproxyAclSyncService>();

// ZarinPal payment gateway (creates its own HttpClient with WAF-friendly TLS config)
builder.Services.AddScoped<ZarinPalPaymentService>();

// Certificate Transparency (crt.sh) for subdomain discovery
builder.Services.AddHttpClient("crtSh", client =>
{
    client.Timeout = TimeSpan.FromSeconds(15);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("DnsPanel/1.0");
});

// CORS
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
    {
        policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();
    });
});

// Health checks
builder.Services.AddHealthChecks()
    .AddDbContextCheck<AppDbContext>();

var app = builder.Build();

// Configure pipeline
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("AllowAll");
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapHealthChecks("/health");

// Apply migrations and seed database on startup
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    try
    {
        logger.LogInformation("Applying EF Core migrations for AppDbContext...");
        var pending = await db.Database.GetPendingMigrationsAsync();
        logger.LogInformation("Pending migrations: {Count}", pending.Count());
        await db.Database.MigrateAsync();
        logger.LogInformation("Migrations applied successfully.");

        // Seed database (admin user, gaming domains, plans)
        logger.LogInformation("Seeding database...");
        await AppDbContextSeed.SeedAsync(db);
        logger.LogInformation("Database seeded successfully.");
    }
    catch (Exception ex)
    {
        // Prevent crash if migration fails (e.g. tables already exist on an existing database).
        logger.LogWarning(ex, "Migration warning: schema might already be up to date. Proceeding without crashing.");
    }
}

// Warm up DNS Redis cache on startup
using (var scope = app.Services.CreateScope())
{
    var dnsService = scope.ServiceProvider.GetRequiredService<IDnsService>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    try
    {
        logger.LogInformation("Warming up DNS Redis cache on startup...");
        await dnsService.SyncToRedisAsync();
        logger.LogInformation("DNS Redis cache successfully warmed up.");
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Failed to warm up DNS Redis cache on startup.");
    }
}

await app.RunAsync();