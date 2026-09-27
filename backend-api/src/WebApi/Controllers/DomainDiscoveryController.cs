using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace WebApi.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class DomainDiscoveryController : ControllerBase
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<DomainDiscoveryController> _logger;

    public DomainDiscoveryController(IHttpClientFactory httpClientFactory, ILogger<DomainDiscoveryController> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    public class SubdomainDiscoveryResponse
    {
        public string Domain { get; set; } = string.Empty;
        public int Count { get; set; }
        public string[] Subdomains { get; set; } = [];
    }

    /// <summary>
    /// Discovers subdomains for a given domain using HackerTarget API.
    /// </summary>
    [HttpGet("subdomains")]
    public async Task<IActionResult> DiscoverSubdomains([FromQuery] string domain, [FromQuery] int limit = 100)
    {
        if (string.IsNullOrWhiteSpace(domain))
            return BadRequest(new { error = "Domain parameter is required." });

        domain = domain.Trim().ToLower();
        if (domain.Contains("://") || domain.Contains(' ') || !domain.Contains('.'))
            return BadRequest(new { error = "Invalid domain format." });

        try
        {
            var subdomains = await TryHackerTargetAsync(domain);

            if (subdomains == null || subdomains.Count == 0)
            {
                return Ok(new SubdomainDiscoveryResponse
                {
                    Domain = domain,
                    Count = 0,
                    Subdomains = []
                });
            }

            var sorted = subdomains
                .Where(s => s != domain)
                .OrderBy(s => s)
                .Take(limit)
                .ToArray();

            return Ok(new SubdomainDiscoveryResponse
            {
                Domain = domain,
                Count = sorted.Length,
                Subdomains = sorted
            });
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "HTTP error querying HackerTarget for domain {Domain}", domain);
            return StatusCode(502, new { error = "Failed to query subdomain discovery service.", detail = ex.Message });
        }
        catch (TaskCanceledException)
        {
            _logger.LogWarning("Request to HackerTarget timed out for domain {Domain}", domain);
            return StatusCode(504, new { error = "Request to subdomain discovery service timed out." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unexpected error discovering subdomains for {Domain}", domain);
            return StatusCode(500, new { error = "Internal server error during subdomain discovery." });
        }
    }

    /// <summary>
    /// Queries HackerTarget hostsearch API which returns CSV: subdomain,ip
    /// </summary>
    private async Task<HashSet<string>?> TryHackerTargetAsync(string domain)
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        var client = _httpClientFactory.CreateClient("hackertarget");
        var url = $"https://api.hackertarget.com/hostsearch/?q={WebUtility.UrlEncode(domain)}";

        _logger.LogInformation("Querying HackerTarget for subdomains of {Domain}", domain);

        using var response = await client.GetAsync(url, HttpCompletionOption.ResponseContentRead, cts.Token);
        response.EnsureSuccessStatusCode();

        var body = await response.Content.ReadAsStringAsync(cts.Token);
        var subdomains = new HashSet<string>();

        foreach (var line in body.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var parts = line.Split(',');
            if (parts.Length == 0) continue;

            var clean = parts[0].Trim().ToLower();
            if (string.IsNullOrEmpty(clean)) continue;

            // Only keep subdomains that actually belong to this domain
            if (clean == domain || clean.EndsWith($".{domain}"))
                subdomains.Add(clean);
        }

        _logger.LogInformation("HackerTarget found {Count} subdomains for {Domain}", subdomains.Count, domain);
        return subdomains;
    }
}