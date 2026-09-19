using Application.Interfaces;
using Domain.Entities;
using Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Distributed;
using System.Text.Json;

namespace Infrastructure.Services;

public class DnsService : IDnsService
{
    private readonly AppDbContext _context;
    private readonly IDistributedCache _cache;

    public DnsService(AppDbContext context, IDistributedCache cache)
    {
        _context = context;
        _cache = cache;
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

    public async Task SyncDnsToRedisAsync()
    {
        var gamingDomains = await _context.GamingDomains
            .Where(g => g.IsActive)
            .Select(g => g.Domain)
            .ToListAsync();

        var dnsRecordDomains = await _context.DnsRecords
            .Where(r => r.IsActive)
            .Select(r => r.Domain)
            .ToListAsync();

        var allDomains = gamingDomains.Concat(dnsRecordDomains).Distinct().ToList();

        var json = JsonSerializer.Serialize(allDomains);
        await _cache.SetStringAsync("gaming:domains", json, new DistributedCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(1)
        });
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
        return existing;
    }

    public async Task<bool> DeleteRecordAsync(Guid id)
    {
        var existing = await _context.DnsRecords.FindAsync(id);
        if (existing == null) return false;

        _context.DnsRecords.Remove(existing);
        await _context.SaveChangesAsync();
        return true;
    }
}