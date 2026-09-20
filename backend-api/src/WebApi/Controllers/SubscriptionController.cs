using System.Text.RegularExpressions;
using Application.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace WebApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class SubscriptionController : ControllerBase
{
    private readonly ISubscriptionService _subscriptionService;
    private readonly ILogger<SubscriptionController> _logger;

    public SubscriptionController(ISubscriptionService subscriptionService, ILogger<SubscriptionController> logger)
    {
        _subscriptionService = subscriptionService;
        _logger = logger;
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

        // Verify HMAC-SHA256 signature using unified secret
        var hmacSecret = Environment.GetEnvironmentVariable("HMAC_SECRET") ?? "RhynoDns_Secure_HMAC_Secret_Key_2026_!@#";
        using var hmac = new System.Security.Cryptography.HMACSHA256(System.Text.Encoding.UTF8.GetBytes(hmacSecret));
        var expectedHash = BitConverter.ToString(hmac.ComputeHash(System.Text.Encoding.UTF8.GetBytes(telegramId.ToString()))).Replace("-", "").ToLowerInvariant();

        if (!string.Equals(sign?.Trim(), expectedHash, StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogWarning($"Signature mismatch! TelegramId: {telegramId}, Received: '{sign}', Expected: '{expectedHash}'");
            return BadRequest(new { success = false, message = "امضای امنیتی نامعتبر است. لطفاً از طریق دکمه تلگرام وارد شوید." });
        }

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

        // Calculate remaining time from the registered subscription
        var remainingTime = await _subscriptionService.GetRemainingTimeAsync(telegramId);

        return Ok(new
        {
            success = true,
            ip = clientIp,
            remainingHours = remainingTime.TotalHours,
            primaryDns = "37.32.28.44",
            secondaryDns = "37.32.30.252"
        });
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