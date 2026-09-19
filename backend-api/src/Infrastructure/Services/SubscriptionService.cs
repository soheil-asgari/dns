using System.Net;
using System.Net.Sockets;
using Application.Interfaces;
using Domain.Entities;
using Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Distributed;
using StackExchange.Redis;

namespace Infrastructure.Services;

public class SubscriptionService : ISubscriptionService
{
    private readonly AppDbContext _context;
    private readonly IDistributedCache _cache;
    private readonly IDatabase _redis;

    public SubscriptionService(AppDbContext context, IDistributedCache cache, IConnectionMultiplexer redis)
    {
        _context = context;
        _cache = cache;
        _redis = redis.GetDatabase();
    }

    public async Task<UserDto> GetOrCreateUserAsync(long telegramId, string? username, string? firstName)
    {
        var user = await _context.Users
            .Include(u => u.Subscriptions)
            .FirstOrDefaultAsync(u => u.TelegramId == telegramId);

        if (user != null)
        {
            var activeSub = user.Subscriptions
                .Where(s => s.IsActive && s.EndDate > DateTime.UtcNow)
                .OrderByDescending(s => s.EndDate)
                .Select(s => MapSubscriptionDto(s))
                .FirstOrDefault();

            return new UserDto
            {
                Id = user.Id,
                TelegramId = user.TelegramId,
                Username = user.Username,
                FirstName = user.FirstName,
                IsNewUser = false,
                ActiveSubscription = activeSub
            };
        }

        user = new User
        {
            Id = Guid.NewGuid(),
            TelegramId = telegramId,
            Username = username,
            FirstName = firstName,
            CreatedAt = DateTime.UtcNow
        };

        _context.Users.Add(user);
        await _context.SaveChangesAsync();

        return new UserDto
        {
            Id = user.Id,
            TelegramId = user.TelegramId,
            Username = user.Username,
            FirstName = user.FirstName,
            IsNewUser = true,
            ActiveSubscription = null
        };
    }

    public async Task<SubscriptionDto?> ProvisionTrialAsync(long telegramId)
    {
        var user = await _context.Users
            .Include(u => u.Subscriptions)
            .FirstOrDefaultAsync(u => u.TelegramId == telegramId);

        if (user == null) return null;

        // Check if trial was already used
        var hadTrial = user.Subscriptions.Any(s => s.Type == SubscriptionType.Trial24H);
        if (hadTrial) return null;

        var now = DateTime.UtcNow;
        var trial = new Subscription
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            Type = SubscriptionType.Trial24H,
            StartDate = now,
            EndDate = now.AddHours(24),
            IsActive = true
        };

        _context.Subscriptions.Add(trial);
        await _context.SaveChangesAsync();

        return MapSubscriptionDto(trial);
    }

    public async Task<SubscriptionStatusDto> GetSubscriptionStatusAsync(long telegramId)
    {
        var user = await _context.Users
            .Include(u => u.Subscriptions)
            .FirstOrDefaultAsync(u => u.TelegramId == telegramId);

        if (user == null)
        {
            return new SubscriptionStatusDto();
        }

        var allSubs = user.Subscriptions
            .OrderByDescending(s => s.StartDate)
            .Select(MapSubscriptionDto)
            .ToList();

        var activeSub = allSubs.FirstOrDefault(s => s.IsActive && !s.IsExpired);

        return new SubscriptionStatusDto
        {
            HasActiveSubscription = activeSub != null,
            CurrentSubscription = activeSub,
            History = allSubs
        };
    }

    public async Task<bool> RegisterIpAsync(long telegramId, string ipAddress)
    {
        // Validate IPv4
        if (!IPAddress.TryParse(ipAddress, out var parsedIp))
            return false;

        if (parsedIp.AddressFamily != AddressFamily.InterNetwork)
            return false;

        var user = await _context.Users
            .Include(u => u.Subscriptions)
            .FirstOrDefaultAsync(u => u.TelegramId == telegramId);

        if (user == null) return false;

        // Find active non-expired subscription
        var activeSub = user.Subscriptions
            .Where(s => s.IsActive && s.EndDate > DateTime.UtcNow)
            .OrderByDescending(s => s.EndDate)
            .FirstOrDefault();

        if (activeSub == null) return false;

        // Update RegisteredIp in SQL
        activeSub.RegisteredIp = ipAddress;
        await _context.SaveChangesAsync();

        // Write to Redis: SET allowed_ips:{ip} {userId} EX {remainingSeconds}
        var remainingSeconds = (int)(activeSub.EndDate - DateTime.UtcNow).TotalSeconds;
        var cacheKey = $"allowed_ips:{ipAddress}";
        await _cache.SetStringAsync(cacheKey, user.Id.ToString(), new DistributedCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(Math.Max(remainingSeconds, 1))
        });

        // Add IP to Redis Set: SADD whitelist:ips {ip}
        await _redis.SetAddAsync("whitelist:ips", ipAddress);

        // Set TTL on the set itself if it's new
        var setTtl = await _redis.KeyTimeToLiveAsync("whitelist:ips");
        if (setTtl == null)
        {
            await _redis.KeyExpireAsync("whitelist:ips", TimeSpan.FromSeconds(Math.Max(remainingSeconds, 60)));
        }

        return true;
    }

    public async Task<int> GetRemainingHoursAsync(long telegramId)
    {
        var user = await _context.Users
            .Include(u => u.Subscriptions)
            .FirstOrDefaultAsync(u => u.TelegramId == telegramId);

        if (user == null) return 0;

        var activeSub = user.Subscriptions
            .Where(s => s.IsActive && s.EndDate > DateTime.UtcNow)
            .OrderByDescending(s => s.EndDate)
            .FirstOrDefault();

        if (activeSub == null) return 0;

        return (int)Math.Ceiling((activeSub.EndDate - DateTime.UtcNow).TotalHours);
    }

    public async Task<TimeSpan> GetRemainingTimeAsync(long telegramId)
    {
        var user = await _context.Users
            .Include(u => u.Subscriptions)
            .FirstOrDefaultAsync(u => u.TelegramId == telegramId);

        if (user == null) return TimeSpan.Zero;

        var activeSub = user.Subscriptions
            .Where(s => s.IsActive && s.EndDate > DateTime.UtcNow)
            .OrderByDescending(s => s.EndDate)
            .FirstOrDefault();

        if (activeSub == null) return TimeSpan.Zero;

        return activeSub.EndDate - DateTime.UtcNow;
    }

    private static SubscriptionDto MapSubscriptionDto(Subscription s)
    {
        return new SubscriptionDto
        {
            Id = s.Id,
            Type = s.Type.ToString(),
            StartDate = s.StartDate,
            EndDate = s.EndDate,
            IsActive = s.IsActive,
            RegisteredIp = s.RegisteredIp
        };
    }
}