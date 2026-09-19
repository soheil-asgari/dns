using Domain.Entities;
using Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Distributed;
using StackExchange.Redis;
using System.Text.Json;

namespace WebApi.Controllers;

[ApiController]
[Route("api/settings")]
public class SettingsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IDistributedCache _cache;
    private readonly IConnectionMultiplexer _redis;

    public SettingsController(AppDbContext db, IDistributedCache cache, IConnectionMultiplexer redis)
    {
        _db = db;
        _cache = cache;
        _redis = redis;
    }

    /// <summary>
    /// Get current bot token (masked for non-admin, full for admin/admin internal).
    /// Returns full token when X-Internal-Service header is "telegram-bot" or user is authenticated admin.
    /// </summary>
    [HttpGet("bot-token")]
    public async Task<IActionResult> GetBotToken()
    {
        var setting = await _db.SystemSettings.FindAsync("bot_token");
        var token = setting?.Value ?? string.Empty;

        // Prefer DB value as source of truth; fall back to Redis cache only if valid
        var cached = await _cache.GetStringAsync("config:bot_token");
        if (!string.IsNullOrEmpty(cached) && cached != "config:bot_token")
            token = cached;

        var isInternal = Request.Headers["X-Internal-Service"].FirstOrDefault() == "telegram-bot";
        var isAdmin = User.Identity?.IsAuthenticated == true && User.IsInRole("Admin");

        return Ok(new
        {
            token = isInternal || isAdmin ? token : MaskToken(token),
            isConfigured = !string.IsNullOrEmpty(token)
        });
    }

    /// <summary>
    /// Update bot token, store in DB, update Redis, trigger re-initialization signal.
    /// </summary>
    [HttpPut("bot-token")]
    public async Task<IActionResult> UpdateBotToken([FromBody] UpdateBotTokenRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Token))
            return BadRequest(new { message = "Token is required" });

        var setting = await _db.SystemSettings.FindAsync("bot_token");
        if (setting == null)
        {
            setting = new SystemSetting
            {
                Key = "bot_token",
                Value = request.Token
            };
            _db.SystemSettings.Add(setting);
        }
        else
        {
            setting.Value = request.Token;
            setting.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();

        // Update Redis cache
        await _cache.SetStringAsync("config:bot_token", request.Token);

        // Publish to Redis pub/sub so bot picks up new token
        var subscriber = _redis.GetSubscriber();
        await subscriber.PublishAsync(RedisChannel.Literal("config:bot_token_changed"), request.Token);

        return Ok(new { message = "Bot token updated successfully" });
    }

    /// <summary>
    /// Test bot token by making a request to Telegram API.
    /// </summary>
    [HttpPost("bot-token/test")]
    public async Task<IActionResult> TestBotToken([FromBody] TestBotTokenRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Token))
            return BadRequest(new { message = "Token is required" });

        try
        {
            using var httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            var response = await httpClient.GetAsync($"https://api.telegram.org/bot{request.Token}/getMe");
            var content = await response.Content.ReadAsStringAsync();

            if (response.IsSuccessStatusCode)
            {
                var json = JsonDocument.Parse(content);
                var ok = json.RootElement.GetProperty("ok").GetBoolean();
                if (ok)
                {
                    var bot = json.RootElement.GetProperty("result");
                    return Ok(new
                    {
                        success = true,
                        botUsername = bot.GetProperty("username").GetString(),
                        message = "Token is valid"
                    });
                }
            }

            return Ok(new { success = false, message = "Invalid token or Telegram API unreachable" });
        }
        catch (Exception ex)
        {
            return Ok(new { success = false, message = $"Connection failed: {ex.Message}" });
        }
    }

    private static string MaskToken(string token)
    {
        if (string.IsNullOrEmpty(token) || token.Length < 8)
            return token;

        return token[..4] + new string('*', token.Length - 8) + token[^4..];
    }
}

public class UpdateBotTokenRequest
{
    public string Token { get; set; } = string.Empty;
}

public class TestBotTokenRequest
{
    public string Token { get; set; } = string.Empty;
}