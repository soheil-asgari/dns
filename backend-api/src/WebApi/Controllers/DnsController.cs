using Application.Interfaces;
using Domain.Entities;
using Microsoft.AspNetCore.Mvc;

namespace WebApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class DnsController : ControllerBase
{
    private readonly IDnsService _dnsService;

    public DnsController(IDnsService dnsService)
    {
        _dnsService = dnsService;
    }

    [HttpGet("resolve/{domain}")]
    public async Task<IActionResult> Resolve(string domain)
    {
        var result = await _dnsService.ResolveDomainAsync(domain);
        return Ok(result);
    }

    [HttpGet("gaming-domains")]
    public async Task<IActionResult> GetGamingDomains()
    {
        var domains = await _dnsService.GetGamingDomainsAsync();
        return Ok(domains);
    }

    [HttpPost("sync-redis")]
    public async Task<IActionResult> SyncToRedis()
    {
        await _dnsService.SyncDnsToRedisAsync();
        return Ok(new { message = "DNS data synced to Redis" });
    }
}