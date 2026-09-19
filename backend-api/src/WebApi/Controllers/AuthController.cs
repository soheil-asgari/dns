using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Domain.Entities;
using Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.IdentityModel.Tokens;

namespace WebApi.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IConfiguration _config;
    private readonly IDistributedCache _cache;

    public AuthController(AppDbContext db, IConfiguration config, IDistributedCache cache)
    {
        _db = db;
        _config = config;
        _cache = cache;
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
            return BadRequest(new { message = "Username and password are required" });

        var admin = await _db.AdminUsers.FirstOrDefaultAsync(u => u.Username == request.Username);
        if (admin == null)
            return Unauthorized(new { message = "Invalid credentials" });

        var hash = AppDbContextSeed.HashPassword(request.Password, admin.PasswordSalt);
        if (hash != admin.PasswordHash)
            return Unauthorized(new { message = "Invalid credentials" });

        var token = GenerateJwtToken(admin);

        // Set secure HTTP-only cookie
        Response.Cookies.Append("auth_token", token, new CookieOptions
        {
            HttpOnly = true,
            Secure = true,
            SameSite = SameSiteMode.Strict,
            Expires = DateTime.UtcNow.AddHours(24)
        });

        return Ok(new { token, username = admin.Username, role = admin.Role });
    }

    [HttpPost("logout")]
    public IActionResult Logout()
    {
        Response.Cookies.Delete("auth_token");
        return Ok(new { message = "Logged out" });
    }

    [Authorize]
    [HttpGet("me")]
    public async Task<IActionResult> Me()
    {
        var username = User.FindFirst(ClaimTypes.Name)?.Value;
        if (string.IsNullOrEmpty(username))
            return Unauthorized();

        var admin = await _db.AdminUsers.FirstOrDefaultAsync(u => u.Username == username);
        if (admin == null)
            return Unauthorized();

        return Ok(new { username = admin.Username, role = admin.Role });
    }

    private string GenerateJwtToken(AdminUser admin)
    {
        var jwtSettings = _config.GetSection("Jwt");
        var secretKey = jwtSettings["SecretKey"] ?? "DefaultSuperSecretKeyForDevelopment12345!";
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secretKey));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(ClaimTypes.Name, admin.Username),
            new Claim(ClaimTypes.Role, admin.Role),
            new Claim(ClaimTypes.NameIdentifier, admin.Id.ToString())
        };

        var token = new JwtSecurityToken(
            issuer: jwtSettings["Issuer"] ?? "DnsService",
            audience: jwtSettings["Audience"] ?? "DnsPanel",
            claims: claims,
            expires: DateTime.UtcNow.AddHours(24),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

public class LoginRequest
{
    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
}