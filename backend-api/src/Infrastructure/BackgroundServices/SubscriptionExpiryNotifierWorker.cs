using Domain.Entities;
using Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using StackExchange.Redis;
using System.Text.Json;

namespace Infrastructure.BackgroundServices;

public class SubscriptionExpiryNotifierWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConnectionMultiplexer _redis;
    private readonly ILogger<SubscriptionExpiryNotifierWorker> _logger;

    private static readonly TimeSpan RunInterval = TimeSpan.FromHours(6);

    public SubscriptionExpiryNotifierWorker(
        IServiceScopeFactory scopeFactory,
        IConnectionMultiplexer redis,
        ILogger<SubscriptionExpiryNotifierWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _redis = redis;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("SubscriptionExpiryNotifierWorker started.");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessExpiringSubscriptionsAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing expiring subscriptions.");
            }

            await Task.Delay(RunInterval, stoppingToken);
        }
    }

    private async Task ProcessExpiringSubscriptionsAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var now = DateTime.UtcNow;
        var cutoff = now.AddDays(3);

        var expiringSubs = await context.Subscriptions
            .Include(s => s.User)
            .Where(s => s.IsActive
                        && s.EndDate <= cutoff
                        && s.EndDate > now
                        && !s.ExpiryReminderSent)
            .ToListAsync(ct);

        if (expiringSubs.Count == 0)
        {
            _logger.LogDebug("No expiring subscriptions found for 3-day reminder.");
            return;
        }

        _logger.LogInformation("Found {Count} subscriptions expiring within 3 days.", expiringSubs.Count);

        var subscriber = _redis.GetSubscriber();

        foreach (var sub in expiringSubs)
        {
            try
            {
                var payload = JsonSerializer.Serialize(new
                {
                    telegramId = sub.User.TelegramId,
                    endDate = sub.EndDate,
                    type = "expiry_reminder"
                });

                await subscriber.PublishAsync(
                    RedisChannel.Literal("payment:notify"), payload);

                sub.ExpiryReminderSent = true;
                _logger.LogInformation(
                    "Expiry reminder sent for subscription {SubId} (User {TelegramId}). Expires: {EndDate}",
                    sub.Id, sub.User.TelegramId, sub.EndDate);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex,
                    "Failed to send expiry reminder for subscription {SubId} (User {TelegramId})",
                    sub.Id, sub.User.TelegramId);
            }
        }

        await context.SaveChangesAsync(ct);
    }
}