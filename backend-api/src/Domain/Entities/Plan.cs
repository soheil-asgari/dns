namespace Domain.Entities;

public class Plan
{
    public Guid Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public long Price { get; set; } // Tomans
    public int DurationDays { get; set; }
    public bool IsActive { get; set; } = true;
}