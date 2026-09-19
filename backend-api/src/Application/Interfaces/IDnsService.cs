using Domain.Entities;

namespace Application.Interfaces;

public interface IDnsService
{
    // Gaming domains
    Task<DnsResolutionResult> ResolveDomainAsync(string domain);
    Task<List<GamingDomainDto>> GetGamingDomainsAsync();
    Task SyncDnsToRedisAsync();
    Task SyncToRedisAsync(CancellationToken cancellationToken = default);
    Task CreateBulkGamingDomainsAsync(List<string> domains, string gameName = "Discovered");

    // DNS Records CRUD
    Task<List<DnsRecord>> GetRecordsAsync();
    Task<DnsRecord> CreateRecordAsync(DnsRecord record);
    Task<DnsRecord?> UpdateRecordAsync(Guid id, DnsRecord record);
    Task<bool> DeleteRecordAsync(Guid id);
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