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

    public class CrtShEntry
    {
        [JsonPropertyName("name_value")]
        public string? NameValue { get; set; }
    }

    public class SubdomainDiscoveryResponse
    {
        public string Domain { get; set; } = string.Empty;
        public int Count { get; set; }
        public string[] Subdomains { get; set; } = [];
    }

    /// <summary>
    /// Discovers subdomains for a given domain using Certificate Transparency logs (crt.sh).
    /// </summary>
    /// <param name="domain">The domain to discover subdomains for (e.g., example.com).</param>
    /// <param name="limit">Maximum number of subdomains to return (default: 100).</param>
    [HttpGet("subdomains")]
    public async Task<IActionResult> DiscoverSubdomains([FromQuery] string domain, [FromQuery] int limit = 100)
    {
        if (string.IsNullOrWhiteSpace(domain))
            return BadRequest(new { error = "Domain parameter is required." });

        // Basic domain validation
        domain = domain.Trim().ToLower();
        if (domain.Contains("://") || domain.Contains(' ') || !domain.Contains('.'))
            return BadRequest(new { error = "Invalid domain format." });

        try
        {
            var client = _httpClientFactory.CreateClient("crtSh");
            var url = $"https://crt.sh/?q=%25.{WebUtility.UrlEncode(domain)}&output=json";
            
            _logger.LogInformation("Querying crt.sh for subdomains of {Domain}: {Url}", domain, url);

            using var response = await client.GetAsync(url, HttpCompletionOption.ResponseContentRead);
            response.EnsureSuccessStatusCode();

            var json = await response.Content.ReadAsStringAsync();

            var entries = JsonSerializer.Deserialize<List<CrtShEntry>>(json);
            if (entries == null || entries.Count == 0)
            {
                return Ok(new SubdomainDiscoveryResponse
                {
                    Domain = domain,
                    Count = 0,
                    Subdomains = []
                });
            }

            var subdomains = new HashSet<string>();

            foreach (var entry in entries)
            {
                if (string.IsNullOrWhiteSpace(entry.NameValue))
                    continue;

                // Split multi-line certificate entries
                var parts = entry.NameValue.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                foreach (var part in parts)
                {
                    var clean = part.Trim().ToLower();

                    // Remove wildcard prefix (*.)
                    if (clean.StartsWith("*."))
                        clean = clean[2..];

                    // Ensure it ends with the target domain
                    if (!clean.EndsWith($".{domain}") && clean != domain)
                        continue;

                    subdomains.Add(clean);
                }
            }

            // Sort and limit results
            var sorted = subdomains
                .Where(s => s != domain) // exclude the root domain itself
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
            _logger.LogError(ex, "HTTP error querying crt.sh for domain {Domain}", domain);
            return StatusCode(502, new { error = "Failed to query certificate transparency logs.", detail = ex.Message });
        }
        catch (TaskCanceledException)
        {
            _logger.LogWarning("Request to crt.sh timed out for domain {Domain}", domain);
            return StatusCode(504, new { error = "Request to certificate transparency logs timed out." });
        }
        catch (JsonException ex)
        {
            _logger.LogError(ex, "Failed to parse crt.sh response for domain {Domain}", domain);
            return StatusCode(502, new { error = "Invalid response from certificate transparency logs." });
        }
    }
}