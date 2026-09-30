using System.Security.Claims;
using Application.Interfaces;
using Domain.Entities;
using Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StackExchange.Redis;
using System.Text.Json;

namespace WebApi.Controllers;

[ApiController]
[Route("api/admin")]
[Authorize]
public class AdminController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly ISubscriptionService _subscriptionService;
    private readonly IConnectionMultiplexer _redis;
    private readonly ILogger<AdminController> _logger;

    public AdminController(AppDbContext db, ISubscriptionService subscriptionService, IConnectionMultiplexer redis, ILogger<AdminController> logger)
    {
        _db = db;
        _subscriptionService = subscriptionService;
        _redis = redis;
        _logger = logger;
    }

    private string? GetCurrentUsername() => User.FindFirst(ClaimTypes.Name)?.Value;
    private bool IsSuperAdmin() => User.FindFirst(ClaimTypes.Role)?.Value == "SuperAdmin";

    private async Task<bool> HasPermission(string permission)
    {
        var username = GetCurrentUsername();
        if (string.IsNullOrEmpty(username)) return false;
        var admin = await _db.AdminUsers.FirstOrDefaultAsync(u => u.Username == username);
        if (admin == null) return false;
        if (admin.Role == "SuperAdmin") return true;
        return admin.Permissions == "all" || admin.Permissions.Split(',').Contains(permission);
    }

    /// <summary>
    /// Get all users with their subscription info and payment status.
    /// </summary>
    [HttpGet("users")]
    public async Task<IActionResult> GetUsers([FromQuery] int page = 1, [FromQuery] int pageSize = 20, [FromQuery] string? search = null)
    {
        if (!await HasPermission("users")) return Forbid();

        var query = _db.Users
            .Include(u => u.Subscriptions)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.ToLower();
            query = query.Where(u =>
                u.Username != null && u.Username.ToLower().Contains(s) ||
                u.FirstName != null && u.FirstName.ToLower().Contains(s) ||
                u.TelegramId.ToString().Contains(s));
        }

        var total = await query.CountAsync();
        var users = await query
            .OrderByDescending(u => u.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(u => new
            {
                u.Id,
                u.TelegramId,
                u.Username,
                u.FirstName,
                u.CreatedAt,
                Subscriptions = u.Subscriptions.Select(s => new
                {
                    s.Id,
                    s.Type,
                    s.StartDate,
                    s.EndDate,
                    s.IsActive,
                    s.RegisteredIp,
                    s.ExpiryReminderSent,
                    RemainingTime = s.EndDate > DateTime.UtcNow ? s.EndDate - DateTime.UtcNow : TimeSpan.Zero,
                    IsExpired = s.EndDate <= DateTime.UtcNow
                }).OrderByDescending(s => s.StartDate).ToList(),
                HasPurchased = u.Subscriptions.Any(s => s.Type != SubscriptionType.Trial24H && s.IsActive),
                ActiveSubscription = u.Subscriptions
                    .Where(s => s.IsActive && s.EndDate > DateTime.UtcNow)
                    .OrderByDescending(s => s.EndDate)
                    .Select(s => new
                    {
                        s.Id,
                        s.Type,
                        s.StartDate,
                        s.EndDate,
                        s.RegisteredIp,
                        RemainingTime = s.EndDate - DateTime.UtcNow
                    })
                    .FirstOrDefault()
            })
            .ToListAsync();

        return Ok(new { users, total, page, pageSize });
    }

    /// <summary>
    /// Get user detail by TelegramId
    /// </summary>
    [HttpGet("users/{telegramId:long}")]
    public async Task<IActionResult> GetUser(long telegramId)
    {
        if (!await HasPermission("users")) return Forbid();

        var user = await _db.Users
            .Include(u => u.Subscriptions)
            .FirstOrDefaultAsync(u => u.TelegramId == telegramId);

        if (user == null) return NotFound(new { message = "User not found" });

        var subs = user.Subscriptions.OrderByDescending(s => s.StartDate).ToList();
        var activeSub = subs.FirstOrDefault(s => s.IsActive && s.EndDate > DateTime.UtcNow);

        var transactions = await _db.PaymentTransactions
            .Where(t => t.UserId == user.Id)
            .OrderByDescending(t => t.CreatedAt)
            .Select(t => new
            {
                t.Id,
                t.Amount,
                t.Status,
                t.Authority,
                t.RefId,
                t.CreatedAt,
                t.VerifiedAt,
                PlanTitle = t.Plan.Title
            })
            .ToListAsync();

        return Ok(new
        {
            user.Id,
            user.TelegramId,
            user.Username,
            user.FirstName,
            user.CreatedAt,
            Subscriptions = subs.Select(s => new
            {
                s.Id,
                Type = s.Type.ToString(),
                s.StartDate,
                s.EndDate,
                s.IsActive,
                s.RegisteredIp,
                s.ExpiryReminderSent,
                RemainingDays = (s.EndDate > DateTime.UtcNow ? (s.EndDate - DateTime.UtcNow).TotalDays : 0)
            }),
            ActiveSubscription = activeSub != null ? new
            {
                activeSub.Id,
                Type = activeSub.Type.ToString(),
                activeSub.StartDate,
                activeSub.EndDate,
                activeSub.RegisteredIp,
                RemainingDays = (activeSub.EndDate > DateTime.UtcNow ? (activeSub.EndDate - DateTime.UtcNow).TotalDays : 0)
            } : null,
            HasPurchased = subs.Any(s => s.Type != SubscriptionType.Trial24H && s.IsActive),
            Transactions = transactions
        });
    }

    /// <summary>
    /// Manually add credit (days) to a user's active subscription or create a new one.
    /// </summary>
    [HttpPost("users/{telegramId:long}/add-credit")]
    public async Task<IActionResult> AddCredit(long telegramId, [FromBody] AddCreditRequest request)
    {
        if (!await HasPermission("users")) return Forbid();

        if (request.Days <= 0) return BadRequest(new { message = "Days must be positive" });

        var user = await _db.Users
            .Include(u => u.Subscriptions)
            .FirstOrDefaultAsync(u => u.TelegramId == telegramId);

        if (user == null) return NotFound(new { message = "User not found" });

        var activeSub = user.Subscriptions
            .Where(s => s.IsActive && s.EndDate > DateTime.UtcNow)
            .OrderByDescending(s => s.EndDate)
            .FirstOrDefault();

        Subscription sub;
        if (activeSub != null)
        {
            activeSub.EndDate = activeSub.EndDate.AddDays(request.Days);
            activeSub.ExpiryReminderSent = false;
            sub = activeSub;
        }
        else
        {
            sub = new Subscription
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                Type = SubscriptionType.PaidMonthly,
                StartDate = DateTime.UtcNow,
                EndDate = DateTime.UtcNow.AddDays(request.Days),
                IsActive = true,
                ExpiryReminderSent = false
            };
            _db.Subscriptions.Add(sub);
        }

        // Update Redis TTL for registered IP if exists
        if (!string.IsNullOrWhiteSpace(sub.RegisteredIp))
        {
            var db = _redis.GetDatabase();
            var remainingSeconds = (int)(sub.EndDate - DateTime.UtcNow).TotalSeconds;
            if (remainingSeconds > 0)
            {
                await db.KeyExpireAsync($"allowed_ips:{sub.RegisteredIp}", TimeSpan.FromSeconds(remainingSeconds));
                await db.KeyExpireAsync("whitelist:ips", TimeSpan.FromSeconds(remainingSeconds));
            }
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {Admin} added {Days} days credit to user {TelegramId}", GetCurrentUsername(), request.Days, telegramId);

        return Ok(new
        {
            message = $"{request.Days} days added successfully",
            newEndDate = sub.EndDate,
            remainingDays = (int)(sub.EndDate - DateTime.UtcNow).TotalDays
        });
    }

    /// <summary>
    /// Get all bot admins.
    /// </summary>
    [HttpGet("bot-admins")]
    public async Task<IActionResult> GetBotAdmins()
    {
        if (!IsSuperAdmin()) return Forbid();

        var admins = await _db.AdminUsers
            .Select(a => new
            {
                a.Id,
                a.Username,
                a.Role,
                a.Permissions,
                a.CreatedAt
            })
            .ToListAsync();

        return Ok(new { admins });
    }

    /// <summary>
    /// Create a new bot admin.
    /// </summary>
    [HttpPost("bot-admins")]
    public async Task<IActionResult> CreateBotAdmin([FromBody] CreateBotAdminRequest request)
    {
        if (!IsSuperAdmin()) return Forbid();

        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
            return BadRequest(new { message = "Username and password are required" });

        if (await _db.AdminUsers.AnyAsync(a => a.Username == request.Username))
            return BadRequest(new { message = "Username already exists" });

        var passwordSalt = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
        var passwordHash = AppDbContextSeed.HashPassword(request.Password, passwordSalt);

        var admin = new AdminUser
        {
            Id = Guid.NewGuid(),
            Username = request.Username,
            PasswordHash = passwordHash,
            PasswordSalt = passwordSalt,
            Role = request.Role ?? "Admin",
            Permissions = request.Permissions ?? "postdns,postnews"
        };

        _db.AdminUsers.Add(admin);
        await _db.SaveChangesAsync();

        return Ok(new { message = "Admin created successfully", admin.Username, admin.Role, admin.Permissions });
    }

    /// <summary>
    /// Update bot admin permissions.
    /// </summary>
    [HttpPut("bot-admins/{id:guid}")]
    public async Task<IActionResult> UpdateBotAdmin(Guid id, [FromBody] UpdateBotAdminRequest request)
    {
        if (!IsSuperAdmin()) return Forbid();

        var admin = await _db.AdminUsers.FindAsync(id);
        if (admin == null) return NotFound(new { message = "Admin not found" });

        if (request.Permissions != null)
            admin.Permissions = request.Permissions;
        if (request.Role != null)
            admin.Role = request.Role;

        await _db.SaveChangesAsync();
        return Ok(new { message = "Admin updated successfully" });
    }

    /// <summary>
    /// Delete a bot admin.
    /// </summary>
    [HttpDelete("bot-admins/{id:guid}")]
    public async Task<IActionResult> DeleteBotAdmin(Guid id)
    {
        if (!IsSuperAdmin()) return Forbid();

        var admin = await _db.AdminUsers.FindAsync(id);
        if (admin == null) return NotFound(new { message = "Admin not found" });

        // Prevent deleting self
        var currentUsername = GetCurrentUsername();
        if (admin.Username == currentUsername)
            return BadRequest(new { message = "Cannot delete yourself" });

        _db.AdminUsers.Remove(admin);
        await _db.SaveChangesAsync();
        return Ok(new { message = "Admin deleted successfully" });
    }

    /// <summary>
    /// Dashboard stats.
    /// </summary>
    [HttpGet("stats")]
    public async Task<IActionResult> GetStats()
    {
        if (!await HasPermission("users")) return Forbid();

        var totalUsers = await _db.Users.CountAsync();
        var activeSubscriptions = await _db.Subscriptions.CountAsync(s => s.IsActive && s.EndDate > DateTime.UtcNow);
        var totalPaidSubscriptions = await _db.Subscriptions.CountAsync(s => s.Type != SubscriptionType.Trial24H && s.IsActive);
        var trialSubscriptions = await _db.Subscriptions.CountAsync(s => s.Type == SubscriptionType.Trial24H);
        var totalRevenue = await _db.PaymentTransactions
            .Where(t => t.Status == PaymentStatus.Success)
            .SumAsync(t => t.Amount);
        var totalTransactions = await _db.PaymentTransactions.CountAsync();
        var successfulTransactions = await _db.PaymentTransactions.CountAsync(t => t.Status == PaymentStatus.Success);
        var usersWithIp = await _db.Subscriptions.CountAsync(s => s.IsActive && s.EndDate > DateTime.UtcNow && s.RegisteredIp != null);

        return Ok(new
        {
            totalUsers,
            activeSubscriptions,
            totalPaidSubscriptions,
            trialSubscriptions,
            totalRevenue,
            totalTransactions,
            successfulTransactions,
            usersWithIp
        });
    }
}

public class AddCreditRequest
{
    public int Days { get; set; }
}

public class CreateBotAdminRequest
{
    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public string? Role { get; set; }
    public string? Permissions { get; set; }
}

public class UpdateBotAdminRequest
{
    public string? Role { get; set; }
    public string? Permissions { get; set; }
}