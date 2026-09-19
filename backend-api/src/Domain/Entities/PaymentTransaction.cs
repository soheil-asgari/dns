namespace Domain.Entities;

public enum PaymentStatus
{
    Pending = 0,
    Success = 1,
    Failed = 2
}

public class PaymentTransaction
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public long TelegramId { get; set; }
    public Guid PlanId { get; set; }
    public Guid? DiscountCodeId { get; set; }
    public long Amount { get; set; } // Tomans
    public string? Authority { get; set; }
    public long? RefId { get; set; }
    public PaymentStatus Status { get; set; } = PaymentStatus.Pending;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? VerifiedAt { get; set; }

    public User User { get; set; } = null!;
    public Plan Plan { get; set; } = null!;
    public DiscountCode? DiscountCode { get; set; }
}