using System.Text.RegularExpressions;
using Application.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace WebApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class SubscriptionController : ControllerBase
{
    private readonly ISubscriptionService _subscriptionService;

    public SubscriptionController(ISubscriptionService subscriptionService)
    {
        _subscriptionService = subscriptionService;
    }

    /// <summary>
    /// Get or create a user and optionally provision a trial subscription.
    /// </summary>
    [HttpPost("get-or-create")]
    public async Task<IActionResult> GetOrCreateUser([FromBody] GetOrCreateUserRequest request)
    {
        if (request.TelegramId == 0)
            return BadRequest(new { error = "TelegramId is required" });

        var user = await _subscriptionService.GetOrCreateUserAsync(
            request.TelegramId, request.Username, request.FirstName);

        SubscriptionDto? trial = null;
        if (user.IsNewUser || (request.ProvisionTrial && user.ActiveSubscription == null))
        {
            trial = await _subscriptionService.ProvisionTrialAsync(request.TelegramId);
        }

        return Ok(new
        {
            user,
            trialProvisioned = trial != null,
            trial
        });
    }

    /// <summary>
    /// Get subscription status for a user.
    /// </summary>
    [HttpGet("status")]
    public async Task<IActionResult> GetStatus([FromQuery] long telegramId)
    {
        if (telegramId == 0)
            return BadRequest(new { error = "TelegramId is required" });

        var status = await _subscriptionService.GetSubscriptionStatusAsync(telegramId);
        return Ok(status);
    }

    /// <summary>
    /// One-click automatic IP registration using the caller's real IP address.
    /// Returns JSON response for the frontend.
    /// </summary>
    [HttpGet("quick-register")]
    public async Task<IActionResult> QuickRegister([FromQuery] long telegramId, [FromQuery] string sign)
    {
        if (telegramId == 0)
            return BadRequest(new { success = false, message = "TelegramId is required" });

        // Verify HMAC-SHA256 signature
        var botToken = await GetBotTokenFromDbAsync();
        if (string.IsNullOrEmpty(botToken))
            return BadRequest(new { success = false, message = "توکن ربات پیکربندی نشده است." });

        var expectedSign = HmacSha256(botToken, telegramId.ToString());
        if (!string.Equals(sign, expectedSign, StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { success = false, message = "امضای امنیتی نامعتبر است یا کاربر یافت نشد." });

        // Extract real client IP (ArvanCloud CDN sends Ar-Real-IP)
        string? clientIp = null;

        // Priority 1: ArvanCloud Ar-Real-IP header
        var arRealIp = HttpContext.Request.Headers["Ar-Real-IP"].FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(arRealIp))
            clientIp = arRealIp;

        // Priority 2: X-Forwarded-For (from nginx reverse proxy)
        if (string.IsNullOrWhiteSpace(clientIp))
        {
            var forwardedFor = HttpContext.Request.Headers["X-Forwarded-For"].FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(forwardedFor))
            {
                clientIp = forwardedFor.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .FirstOrDefault();
            }
        }

        // Priority 3: Direct TCP connection IP
        if (string.IsNullOrWhiteSpace(clientIp))
        {
            var remoteIp = HttpContext.Connection.RemoteIpAddress;
            if (remoteIp != null)
                clientIp = remoteIp.MapToIPv4().ToString();
        }

        if (string.IsNullOrWhiteSpace(clientIp))
            return BadRequest(new { success = false, message = "امضای امنیتی نامعتبر است یا کاربر یافت نشد." });

        var success = await _subscriptionService.RegisterIpAsync(telegramId, clientIp);

        if (!success)
            return BadRequest(new { success = false, message = "امضای امنیتی نامعتبر است یا کاربر یافت نشد." });

        // Calculate remaining hours from the registered subscription
        var remainingHours = await _subscriptionService.GetRemainingHoursAsync(telegramId);

        return Ok(new
        {
            success = true,
            message = "آی‌پی با موفقیت فعال شد",
            ip = clientIp,
            remainingHours,
            primaryDns = "37.32.28.44"
        });
    }

    private async Task<string?> GetBotTokenFromDbAsync()
    {
        using var scope = HttpContext.RequestServices.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<Infrastructure.Data.AppDbContext>();
        var setting = await db.SystemSettings.FindAsync("bot_token");
        return setting?.Value;
    }

    private static string HmacSha256(string key, string data)
    {
        using var hmac = new System.Security.Cryptography.HMACSHA256(System.Text.Encoding.UTF8.GetBytes(key));
        var hash = hmac.ComputeHash(System.Text.Encoding.UTF8.GetBytes(data));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    /// <summary>
    /// Register an IP address for a user's active subscription.
    /// </summary>
    [HttpPost("register-ip")]
    public async Task<IActionResult> RegisterIp([FromBody] RegisterIpRequest request)
    {
        if (request.TelegramId == 0)
            return BadRequest(new RegisterIpResponse { Success = false, Message = "TelegramId is required" });

        if (string.IsNullOrWhiteSpace(request.IpAddress))
            return BadRequest(new RegisterIpResponse { Success = false, Message = "IpAddress is required" });

        // Validate IPv4 format
        var ipv4Regex = new Regex(@"^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$");
        if (!ipv4Regex.IsMatch(request.IpAddress))
            return BadRequest(new RegisterIpResponse { Success = false, Message = "Invalid IPv4 address format" });

        var success = await _subscriptionService.RegisterIpAsync(request.TelegramId, request.IpAddress);

        if (!success)
            return BadRequest(new RegisterIpResponse
            {
                Success = false,
                Message = "User not found or no active subscription"
            });

        return Ok(new RegisterIpResponse
        {
            Success = true,
            Message = "IP registered successfully",
            RegisteredIp = request.IpAddress
        });
    }
}

public class GetOrCreateUserRequest
{
    public long TelegramId { get; set; }
    public string? Username { get; set; }
    public string? FirstName { get; set; }
    public bool ProvisionTrial { get; set; }
}