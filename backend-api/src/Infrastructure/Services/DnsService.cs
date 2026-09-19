using Application.Interfaces;
using Domain.Entities;
using Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using StackExchange.Redis;
using System.Text.Json;

namespace Infrastructure.Services;

public class DnsService : IDnsService
{
    private readonly AppDbContext _context;
    private readonly IDatabase _redisDb;

    public DnsService(AppDbContext context, IConnectionMultiplexer redis)
    {
        _context = context;
        _redisDb = redis.GetDatabase();
    }

    public async Task CreateBulkGamingDomainsAsync(List<string> domains, string gameName = "Discovered")
    {
        var existingDomains = await _context.GamingDomains
            .Where(g => g.IsActive)
            .Select(g => g.Domain.ToLower().Trim())
            .ToListAsync();

        var existingSet = new HashSet<string>(existingDomains);

        var newDomains = new List<GamingDomain>();
        foreach (var domain in domains)
        {
            var clean = domain.ToLower().Trim();
            if (!existingSet.Contains(clean))
            {
                newDomains.Add(new GamingDomain
                {
                    Id = Guid.NewGuid(),
                    Domain = clean,
                    GameName = gameName,
                    Priority = 5,
                    IsActive = true,
                    CreatedAt = DateTime.UtcNow
                });
                existingSet.Add(clean);
            }
        }

        if (newDomains.Count > 0)
        {
            _context.GamingDomains.AddRange(newDomains);
            await _context.SaveChangesAsync();
        }

        // Auto-sync to Redis after bulk insert
        await SyncDnsToRedisAsync();
    }

    public async Task<DnsResolutionResult> ResolveDomainAsync(string domain)
    {
        var gamingDomain = await _context.GamingDomains
            .FirstOrDefaultAsync(g => g.Domain == domain && g.IsActive);

        if (gamingDomain == null)
        {
            return new DnsResolutionResult
            {
                Domain = domain,
                IsGamingDomain = false
            };
        }

        return new DnsResolutionResult
        {
            Domain = domain,
            CustomIp = gamingDomain.CustomIp,
            IsGamingDomain = true
        };
    }

    public async Task<List<GamingDomainDto>> GetGamingDomainsAsync()
    {
        return await _context.GamingDomains
            .Where(g => g.IsActive)
            .OrderBy(g => g.Priority)
            .Select(g => new GamingDomainDto
            {
                Id = g.Id,
                Domain = g.Domain,
                GameName = g.GameName,
                CustomIp = g.CustomIp,
                Priority = g.Priority,
                IsActive = g.IsActive
            })
            .ToListAsync();
    }

    /// <summary>
    /// Writes a plain JSON array of domain strings to Redis.
    /// The gaming_filter plugin expects field "data" under key "DNSgaming:domains"
    /// containing a JSON array: ["dom1", "dom2", ...]
    /// </summary>
    public async Task SyncDnsToRedisAsync()
    {
        var gamingDomains = await _context.GamingDomains
            .Where(g => g.IsActive)
            .Select(g => g.Domain.ToLower().Trim())
            .ToListAsync();

        var jsonPayload = JsonSerializer.Serialize(gamingDomains);
        await _redisDb.HashSetAsync("DNSgaming:domains", "data", jsonPayload);
    }

    /// <summary>
    /// Writes a plain JSON array of combined domains (gaming + DNS records) to Redis.
    /// The gaming_filter plugin expects field "data" under key "DNSgaming:domains"
    /// containing a JSON array: ["dom1", "dom2", ...]
    /// </summary>
    public async Task SyncToRedisAsync(CancellationToken cancellationToken = default)
    {
        // Fetch all active gaming domains
        var gamingDomains = await _context.GamingDomains
            .Where(g => g.IsActive)
            .Select(g => g.Domain.ToLower().Trim())
            .ToListAsync(cancellationToken);

        // Fetch all active 'A' record domains from DnsRecords
        var dnsRecordDomains = await _context.DnsRecords
            .Where(r => r.IsActive && r.RecordType == "A")
            .Select(r => r.Domain.ToLower().Trim())
            .ToListAsync(cancellationToken);

        // Combine, deduplicate using OrdinalIgnoreCase
        var combined = gamingDomains
            .Concat(dnsRecordDomains)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        // Write a plain JSON array to match gaming_filter's expected format
        var jsonPayload = JsonSerializer.Serialize(combined);
        await _redisDb.HashSetAsync("DNSgaming:domains", "data", jsonPayload);
    }

    public async Task<List<DnsRecord>> GetRecordsAsync()
    {
        return await _context.DnsRecords
            .OrderByDescending(r => r.CreatedAt)
            .ToListAsync();
    }

    public async Task<DnsRecord> CreateRecordAsync(DnsRecord record)
    {
        record.Id = Guid.NewGuid();
        record.CreatedAt = DateTime.UtcNow;
        _context.DnsRecords.Add(record);
        await _context.SaveChangesAsync();
        await SyncToRedisAsync();
        return record;
    }

    public async Task<DnsRecord?> UpdateRecordAsync(Guid id, DnsRecord record)
    {
        var existing = await _context.DnsRecords.FindAsync(id);
        if (existing == null) return null;

        existing.Domain = record.Domain;
        existing.RecordType = record.RecordType;
        existing.Value = record.Value;
        existing.Ttl = record.Ttl;
        existing.IsActive = record.IsActive;
        existing.UpdatedAt = DateTime.UtcNow;

        await _context.SaveChangesAsync();
        await SyncToRedisAsync();
        return existing;
    }

    public async Task<bool> DeleteRecordAsync(Guid id)
    {
        var existing = await _context.DnsRecords.FindAsync(id);
        if (existing == null) return false;

        _context.DnsRecords.Remove(existing);
        await _context.SaveChangesAsync();
        await SyncToRedisAsync();
        return true;
    }
}