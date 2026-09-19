namespace Domain.Entities;

public class DiscountCode
{
    public Guid Id { get; set; }
    public string Code { get; set; } = string.Empty; // Uppercase, e.g. "RHYNO50"
    public int Percent { get; set; } // 0-100
    public int MaxUses { get; set; }
    public int UsedCount { get; set; }
    public DateTime? ExpireAt { get; set; }
    public bool IsActive { get; set; } = true;
}