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