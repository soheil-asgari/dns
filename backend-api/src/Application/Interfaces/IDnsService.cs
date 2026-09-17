namespace Application.Interfaces;

public interface IDnsService
{
    Task<DnsResolutionResult> ResolveDomainAsync(string domain);
    Task<List<GamingDomainDto>> GetGamingDomainsAsync();
    Task SyncDnsToRedisAsync();
}

public class DnsResolutionResult
{
    public string Domain { get; set; } = string.Empty;
    public string? CustomIp { get; set; }
    public string ResolvedIp { get; set; } = string.Empty;
    public bool IsGamingDomain { get; set; }
}

public class GamingDomainDto
{
    public Guid Id { get; set; }
    public string Domain { get; set; } = string.Empty;
    public string GameName { get; set; } = string.Empty;
    public string? CustomIp { get; set; }
    public int Priority { get; set; }
    public bool IsActive { get; set; }
}