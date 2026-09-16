namespace Domain.Entities;

public class DnsRecord
{
    public Guid Id { get; set; }
    public string Domain { get; set; } = string.Empty;
    public string RecordType { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
    public int Ttl { get; set; } = 300;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}

public class GamingDomain
{
    public Guid Id { get; set; }
    public string Domain { get; set; } = string.Empty;
    public string GameName { get; set; } = string.Empty;
    public string? CustomIp { get; set; }
    public int Priority { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class ProxyRule
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string SourcePattern { get; set; } = string.Empty;
    public string Destination { get; set; } = string.Empty;
    public int Port { get; set; }
    public string Protocol { get; set; } = "tcp";
    public bool IsActive { get; set; } = true;
    public int Priority { get; set; }
}