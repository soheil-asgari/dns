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

    [HttpGet("records")]
    public async Task<IActionResult> GetRecords()
    {
        var records = await _dnsService.GetRecordsAsync();
        return Ok(records);
    }

    [HttpPost("records")]
    public async Task<IActionResult> CreateRecord([FromBody] DnsRecord record)
    {
        var created = await _dnsService.CreateRecordAsync(record);
        return CreatedAtAction(nameof(GetRecords), new { id = created.Id }, created);
    }

    [HttpPut("records/{id:guid}")]
    public async Task<IActionResult> UpdateRecord(Guid id, [FromBody] DnsRecord record)
    {
        var updated = await _dnsService.UpdateRecordAsync(id, record);
        if (updated == null) return NotFound();
        return Ok(updated);
    }

    [HttpDelete("records/{id:guid}")]
    public async Task<IActionResult> DeleteRecord(Guid id)
    {
        var deleted = await _dnsService.DeleteRecordAsync(id);
        if (!deleted) return NotFound();
        return NoContent();
    }
}