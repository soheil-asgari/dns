namespace Domain.Entities;

public class AdminUser
{
    public Guid Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string PasswordSalt { get; set; } = string.Empty;
    public string Role { get; set; } = "Admin";
    public string Permissions { get; set; } = "all"; // comma-separated: "postdns,postnews,users,all"
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}