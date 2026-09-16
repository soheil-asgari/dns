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
        var domains = await _context.GamingDomains
            .Where(g => g.IsActive)
            .Select(g => g.Domain)
            .ToListAsync();

        var json = JsonSerializer.Serialize(domains);
        await _cache.SetStringAsync("gaming:domains", json, new DistributedCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(1)
        });
    }
}