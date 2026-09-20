using System.Net;
using System.Net.Http.Json;
using System.Security.Authentication;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace Infrastructure.Services;

public class ZarinPalPaymentService
{
    private const string PrimaryRequestUrl = "https://payment.zarinpal.com/pg/v4/payment/request.json";
    private const string FallbackRequestUrl = "https://api.zarinpal.com/pg/v4/payment/request.json";
    private const string PrimaryVerifyUrl = "https://payment.zarinpal.com/pg/v4/payment/verify.json";
    private const string FallbackVerifyUrl = "https://api.zarinpal.com/pg/v4/payment/verify.json";
    private const string StartPayUrlTemplate = "https://payment.zarinpal.com/pg/StartPay/{0}";

    // Realistic browser User-Agent to avoid ZarinPal WAF dropping the TLS handshake.
    private const string DefaultUserAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(15);

    private readonly string _merchantId;
    private readonly ILogger<ZarinPalPaymentService> _logger;

    public ZarinPalPaymentService(ILogger<ZarinPalPaymentService> logger)
    {
        _merchantId = Environment.GetEnvironmentVariable("ZARINPAL_MERCHANT_ID")
                      ?? "62e3e405-05ed-463b-84c5-ea10adbfa9c7";
        _logger = logger;
    }

    public async Task<(string? Authority, string? StartPayUrl)> RequestPaymentAsync(
        long amountTomans, string description, string callbackUrl)
    {
        var requestBody = new
        {
            merchant_id = _merchantId,
            amount = amountTomans * 10, // Convert Tomans to Rials
            currency = "IRT",
            description,
            callback_url = callbackUrl
        };

        _logger.LogInformation("ZarinPal request: Amount={Amount} Rials, Desc={Desc}", amountTomans * 10, description);

        var (json, url) = await PostWithFallbackAsync<ZarinPalRequestResponse>(requestBody, PrimaryRequestUrl, FallbackRequestUrl);

        if (json?.Data?.Authority != null && json.Data.Code == 100)
        {
            var startPayUrl = string.Format(StartPayUrlTemplate, json.Data.Authority);
            _logger.LogInformation("ZarinPal authority obtained from {Host}: {Authority}", GetHost(url), json.Data.Authority);
            return (json.Data.Authority, startPayUrl);
        }

        _logger.LogError("ZarinPal request failed (via {Host}): Code={Code}, Message={Msg}",
            GetHost(url), json?.Data?.Code, json?.Errors?.Message);
        return (null, null);
    }

    public async Task<long?> VerifyPaymentAsync(string authority, long amountTomans)
    {
        var requestBody = new
        {
            merchant_id = _merchantId,
            authority,
            amount = amountTomans * 10
        };

        var (json, url) = await PostWithFallbackAsync<ZarinPalVerifyResponse>(requestBody, PrimaryVerifyUrl, FallbackVerifyUrl);

        if (json?.Data != null && (json.Data.Code == 100 || json.Data.Code == 101))
        {
            _logger.LogInformation("ZarinPal verify success (via {Host}): Authority={Auth}, RefId={RefId}",
                GetHost(url), authority, json.Data.RefId);
            return json.Data.RefId;
        }

        _logger.LogError("ZarinPal verify failed (via {Host}): Code={Code}, Message={Msg}",
            GetHost(url), json?.Data?.Code, json?.Errors?.Message);
        return null;
    }

    /// <summary>
    /// Posts JSON to the primary endpoint; if the request fails (network/TLS/WAF drop),
    /// retries once against the fallback host. Non-success HTTP statuses with a valid
    /// ZarinPal error payload are returned so callers can inspect the details.
    /// </summary>
    private async Task<(T? Response, string UrlUsed)> PostWithFallbackAsync<T>(
        object requestBody, string primaryUrl, string fallbackUrl)
        where T : class
    {
        var (response, exception, url) = await TryPostAsync<T>(requestBody, primaryUrl);
        if (exception == null)
            return (response, url);

        _logger.LogWarning(exception, "ZarinPal primary endpoint failed ({Host}), retrying fallback ({FallbackHost})",
            GetHost(primaryUrl), GetHost(fallbackUrl));

        (response, exception, url) = await TryPostAsync<T>(requestBody, fallbackUrl);
        if (exception != null)
            return (null, url);

        return (response, url);
    }

    private async Task<(T? Response, Exception? Exception, string Url)> TryPostAsync<T>(object requestBody, string url)
        where T : class
    {
        try
        {
            using var client = CreateClient();
            using var response = await client.PostAsJsonAsync(url, requestBody);

            // Successful handshake but gateway-level errors: parse body which carries ZarinPal details.
            if (!response.IsSuccessStatusCode && (int)response.StatusCode >= 500)
            {
                _logger.LogWarning("ZarinPal {Host} returned HTTP {Status}", GetHost(url), (int)response.StatusCode);
                return (null, new HttpRequestException($"ZarinPal returned HTTP {(int)response.StatusCode}"), url);
            }

            var json = await response.Content.ReadFromJsonAsync<T>();
            return (json, null, url);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "ZarinPal request to {Host} threw: {Message}", GetHost(url), ex.Message);
            return (null, ex, url);
        }
    }

    private HttpClient CreateClient()
    {
        var handler = new SocketsHttpHandler
        {
            // ZarinPal WAF can drop bare handshakes; allow both TLS 1.2 and TLS 1.3.
            SslOptions = new System.Net.Security.SslClientAuthenticationOptions
            {
                EnabledSslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13
            },
            PooledConnectionLifetime = TimeSpan.FromMinutes(5),
            ConnectTimeout = TimeSpan.FromSeconds(10),
            AllowAutoRedirect = true,
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate
        };

        var client = new HttpClient(handler)
        {
            Timeout = RequestTimeout
        };

        client.DefaultRequestHeaders.UserAgent.ParseAdd(DefaultUserAgent);
        client.DefaultRequestHeaders.Accept.ParseAdd("application/json");

        return client;
    }

    private static string? GetHost(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) ? uri.Host : url;
}

public class ZarinPalRequestData
{
    [JsonPropertyName("code")]
    public int Code { get; set; }

    [JsonPropertyName("message")]
    public string? Message { get; set; }

    [JsonPropertyName("authority")]
    public string? Authority { get; set; }

    [JsonPropertyName("fee_type")]
    public string? FeeType { get; set; }

    [JsonPropertyName("fee")]
    public long? Fee { get; set; }
}

public class ZarinPalRequestResponse
{
    [JsonPropertyName("data")]
    public ZarinPalRequestData? Data { get; set; }

    [JsonPropertyName("errors")]
    public ZarinPalError? Errors { get; set; }
}

public class ZarinPalVerifyData
{
    [JsonPropertyName("code")]
    public int Code { get; set; }

    [JsonPropertyName("message")]
    public string? Message { get; set; }

    [JsonPropertyName("card_hash")]
    public string? CardHash { get; set; }

    [JsonPropertyName("card_pan")]
    public string? CardPan { get; set; }

    [JsonPropertyName("ref_id")]
    public long RefId { get; set; }

    [JsonPropertyName("fee_type")]
    public string? FeeType { get; set; }

    [JsonPropertyName("fee")]
    public long? Fee { get; set; }
}

public class ZarinPalVerifyResponse
{
    [JsonPropertyName("data")]
    public ZarinPalVerifyData? Data { get; set; }

    [JsonPropertyName("errors")]
    public ZarinPalError? Errors { get; set; }
}

public class ZarinPalError
{
    [JsonPropertyName("code")]
    public int Code { get; set; }

    [JsonPropertyName("message")]
    public string? Message { get; set; }
}