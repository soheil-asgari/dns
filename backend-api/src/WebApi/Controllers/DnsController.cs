using Application.Interfaces;
using Domain.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace WebApi.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class DnsController : ControllerBase
{
    private readonly IDnsService _dnsService;
    private readonly ILogger<DnsController> _logger;

    public DnsController(IDnsService dnsService, ILogger<DnsController> logger)
    {
        _dnsService = dnsService;
        _logger = logger;
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

    [HttpPost("gaming-domains/bulk")]
    public async Task<IActionResult> CreateBulkGamingDomains([FromBody] BulkGamingDomainsRequest request)
    {
        if (request.Domains == null || request.Domains.Count == 0)
            return BadRequest(new { error = "Domains list is required." });

        await _dnsService.CreateBulkGamingDomainsAsync(request.Domains, request.GameName ?? "Discovered");
        return Ok(new { message = $"Added {request.Domains.Count} gaming domains and synced to Redis." });
    }

    [AllowAnonymous]
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
    public async Task<IActionResult> CreateRecord([FromBody] DnsRecord record, CancellationToken cancellationToken)
    {
        var created = await _dnsService.CreateRecordAsync(record);
        try
        {
            await _dnsService.SyncToRedisAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Redis sync failed after creating DNS record {Domain}", record.Domain);
        }
        return CreatedAtAction(nameof(GetRecords), new { id = created.Id }, created);
    }

    [HttpPut("records/{id:guid}")]
    public async Task<IActionResult> UpdateRecord(Guid id, [FromBody] DnsRecord record, CancellationToken cancellationToken)
    {
        var updated = await _dnsService.UpdateRecordAsync(id, record);
        if (updated == null) return NotFound();
        try
        {
            await _dnsService.SyncToRedisAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Redis sync failed after updating DNS record {Id}", id);
        }
        return Ok(updated);
    }

    [HttpDelete("records/{id:guid}")]
    public async Task<IActionResult> DeleteRecord(Guid id, CancellationToken cancellationToken)
    {
        var deleted = await _dnsService.DeleteRecordAsync(id);
        if (!deleted) return NotFound();
        try
        {
            await _dnsService.SyncToRedisAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Redis sync failed after deleting DNS record {Id}", id);
        }
        return NoContent();
    }
}

public class BulkGamingDomainsRequest
{
    public List<string> Domains { get; set; } = [];
    public string? GameName { get; set; }
}