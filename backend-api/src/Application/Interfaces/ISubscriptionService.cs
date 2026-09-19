using Domain.Entities;

namespace Application.Interfaces;

public interface ISubscriptionService
{
    Task<UserDto> GetOrCreateUserAsync(long telegramId, string? username, string? firstName);
    Task<SubscriptionDto?> ProvisionTrialAsync(long telegramId);
    Task<SubscriptionStatusDto> GetSubscriptionStatusAsync(long telegramId);
    Task<bool> RegisterIpAsync(long telegramId, string ipAddress);
    Task<int> GetRemainingHoursAsync(long telegramId);
}

public class UserDto
{
    public Guid Id { get; set; }
    public long TelegramId { get; set; }
    public string? Username { get; set; }
    public string? FirstName { get; set; }
    public bool IsNewUser { get; set; }
    public SubscriptionDto? ActiveSubscription { get; set; }
}

public class SubscriptionDto
{
    public Guid Id { get; set; }
    public string Type { get; set; } = string.Empty;
    public DateTime StartDate { get; set; }
    public DateTime EndDate { get; set; }
    public bool IsActive { get; set; }
    public string? RegisteredIp { get; set; }
    public TimeSpan RemainingTime => EndDate - DateTime.UtcNow;
    public bool IsExpired => RemainingTime.TotalSeconds <= 0;
}

public class SubscriptionStatusDto
{
    public bool HasActiveSubscription { get; set; }
    public SubscriptionDto? CurrentSubscription { get; set; }
    public List<SubscriptionDto> History { get; set; } = new();
}

public class RegisterIpRequest
{
    public long TelegramId { get; set; }
    public string IpAddress { get; set; } = string.Empty;
}

public class RegisterIpResponse
{
    public bool Success { get; set; }
    public string Message { get; set; } = string.Empty;
    public string? RegisteredIp { get; set; }
}

public class IpDetectionResponse
{
    public string Ip { get; set; } = string.Empty;
    public string? Country { get; set; }
    public bool IsRegistered { get; set; }
}