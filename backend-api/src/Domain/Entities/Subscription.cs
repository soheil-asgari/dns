namespace Domain.Entities;

public enum SubscriptionType
{
    Trial24H = 0,
    PaidMonthly = 1,
    PaidQuarterly = 2,
    PaidYearly = 3
}

public class Subscription
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public SubscriptionType Type { get; set; }
    public DateTime StartDate { get; set; } = DateTime.UtcNow;
    public DateTime EndDate { get; set; }
    public bool IsActive { get; set; } = true;
    public string? RegisteredIp { get; set; }

    public User User { get; set; } = null!;
}