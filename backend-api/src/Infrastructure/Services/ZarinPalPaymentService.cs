using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace Infrastructure.Services;

/// <summary>
/// ZarinPal v4 REST API client.
/// Matches the official v4 request/verify JSON schemas and includes a
/// WAF/TLS resilience layer: browser-like User-Agent, TLS 1.2|1.3 only,
/// short timeout and an automatic one-shot fallback to api.zarinpal.com
/// when the primary host resets the connection (Connection reset by peer).
/// </summary>
public class ZarinPalPaymentService
{
    private const string PrimaryRequestUrl = "https://payment.zarinpal.com/pg/v4/payment/request.json";
    private const string FallbackRequestUrl = "https://api.zarinpal.com/pg/v4/payment/request.json";
    private const string PrimaryVerifyUrl = "https://payment.zarinpal.com/pg/v4/payment/verify.json";
    private const string FallbackVerifyUrl = "https://api.zarinpal.com/pg/v4/payment/verify.json";
    private const string StartPayUrlTemplate = "https://payment.zarinpal.com/pg/StartPay/{0}";

    // Mandatory browser-like User-Agent to avoid the ZarinPal WAF dropping the TLS handshake (104).
    private const string DefaultUserAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

    private const int SuccessCode = 100;
    private const int AlreadyVerifiedCode = 101;

    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(15);

    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    // Shared client (connection pooled) configured with a WAF-friendly TLS stack.
    private static readonly HttpClient Client = CreateClient();

    private readonly string _merchantId;
    private readonly ILogger<ZarinPalPaymentService> _logger;

    public ZarinPalPaymentService(ILogger<ZarinPalPaymentService> logger)
    {
        _merchantId = Environment.GetEnvironmentVariable("ZARINPAL_MERCHANT_ID")
                      ?? "62e3e405-05ed-463b-84c5-ea10adbfa9c7";
        _logger = logger;
    }

    /// <summary>
    /// Creates a payment request on ZarinPal v4 and returns the authority +
    /// the StartPay redirect URL when the gateway accepts the payment.
    /// </summary>
    public async Task<(string? Authority, string? StartPayUrl)> RequestPaymentAsync(
        long amountTomans, string description, string callbackUrl,
        string? mobile = null, string? email = null)
    {
        var amountRials = amountTomans * 10; // Convert Tomans to Rials.

        var requestBody = new ZarinPalPaymentRequest
        {
            MerchantId = _merchantId,
            Amount = amountRials,
            Currency = "IRT",
            Description = description,
            CallbackUrl = callbackUrl,
            Metadata = mobile is null && email is null
                ? null
                : new ZarinPalPaymentMetadata { Mobile = mobile, Email = email }
        };

        _logger.LogInformation("ZarinPal request: Amount={Amount} Rials, Desc={Desc}", amountRials, description);

        var (json, url) = await PostWithFallbackAsync<ZarinPalRequestResponse>(requestBody, PrimaryRequestUrl, FallbackRequestUrl);

        if (json?.Data is { Code: SuccessCode, Authority: not null } data)
        {
            var startPayUrl = string.Format(StartPayUrlTemplate, data.Authority);
            _logger.LogInformation("ZarinPal authority obtained from {Host}: {Authority}", GetHost(url), data.Authority);
            return (data.Authority, startPayUrl);
        }

        LogGatewayErrors("request", url, json?.Data?.Code, json?.Errors);
        return (null, null);
    }

    /// <summary>
    /// Verifies a payment on ZarinPal v4. Succeeds when the gateway reports
    /// code 100 (first verification) or 101 (already verified).
    /// </summary>
    public async Task<ZarinPalVerifyResult?> VerifyPaymentAsync(string authority, long amountTomans)
    {
        var requestBody = new ZarinPalVerifyRequest
        {
            MerchantId = _merchantId,
            Amount = amountTomans * 10,
            Authority = authority
        };

        var (json, url) = await PostWithFallbackAsync<ZarinPalVerifyResponse>(requestBody, PrimaryVerifyUrl, FallbackVerifyUrl);

        if (json?.Data is { Code: SuccessCode or AlreadyVerifiedCode } data)
        {
            _logger.LogInformation("ZarinPal verify success (via {Host}): Authority={Auth}, RefId={RefId}, CardPan={CardPan}",
                GetHost(url), authority, data.RefId, MaskCardPan(data.CardPan));
            return new ZarinPalVerifyResult(data.RefId, data.CardPan, data.CardHash, data.Fee);
        }

        LogGatewayErrors("verify", url, json?.Data?.Code, json?.Errors);
        return null;
    }

    /// <summary>
    /// Posts JSON to the primary endpoint; if the request fails with a
    /// connection-level exception (HttpRequestException / SocketException /
    /// timeout — typical of WAF TLS resets), it retries exactly once against
    /// the fallback host. Gateway-level error payloads are passed through so
    /// callers can inspect the details.
    /// </summary>
    private async Task<(T? Response, string UrlUsed)> PostWithFallbackAsync<T>(
        object requestBody, string primaryUrl, string fallbackUrl)
        where T : class
    {
        var (response, exception, url) = await TryPostAsync<T>(requestBody, primaryUrl);
        if (exception == null)
            return (response, url);

        if (!IsRetriable(exception))
        {
            _logger.LogWarning(exception, "ZarinPal request to {Host} failed with a non-retriable error", GetHost(primaryUrl));
            return (null, url);
        }

        _logger.LogWarning(exception, "ZarinPal primary endpoint failed ({Host}), retrying fallback ({FallbackHost})",
            GetHost(primaryUrl), GetHost(fallbackUrl));

        (response, exception, url) = await TryPostAsync<T>(requestBody, fallbackUrl);
        if (exception != null)
        {
            _logger.LogError(exception, "ZarinPal fallback endpoint also failed ({Host})", GetHost(fallbackUrl));
            return (null, url);
        }

        return (response, url);
    }

    private async Task<(T? Response, Exception? Exception, string Url)> TryPostAsync<T>(object requestBody, string url)
        where T : class
    {
        try
        {
            using var response = await Client.PostAsJsonAsync(url, requestBody, SerializerOptions);

            var body = await response.Content.ReadAsStringAsync();

            T? json = null;
            if (!string.IsNullOrWhiteSpace(body))
            {
                try
                {
                    json = JsonSerializer.Deserialize<T>(body, SerializerOptions);
                }
                catch (JsonException ex)
                {
                    _logger.LogWarning(ex, "ZarinPal {Host} returned a non-JSON body (HTTP {Status}): {Body}",
                        GetHost(url), (int)response.StatusCode, Truncate(body));
                }
            }

            // No parseable payload and a gateway/server error: treat as a transport failure
            // so the caller can fall back to the alternate host.
            if (json == null && (int)response.StatusCode >= 500)
            {
                var ex = new HttpRequestException(
                    $"ZarinPal {GetHost(url)} returned HTTP {(int)response.StatusCode}: {Truncate(body)}");
                _logger.LogWarning(ex, "ZarinPal {Host} returned HTTP {Status}", GetHost(url), (int)response.StatusCode);
                return (null, ex, url);
            }

            return (json, null, url);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "ZarinPal request to {Host} threw: {Message}", GetHost(url), ex.Message);
            return (null, ex, url);
        }
    }

    private static bool IsRetriable(Exception exception) =>
        exception is HttpRequestException
        or SocketException
        or TaskCanceledException
        or TimeoutException;

    private static HttpClient CreateClient()
    {
        var handler = new SocketsHttpHandler
        {
            // Restrict to TLS 1.2 and TLS 1.3; prevents WAF rejecting legacy handshakes.
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

    private void LogGatewayErrors(string operation, string url, int? code, IReadOnlyList<ZarinPalError>? errors)
    {
        _logger.LogError("ZarinPal {Operation} failed (via {Host}): Code={Code}",
            operation, GetHost(url), code);

        if (errors is null || errors.Count == 0)
            return;

        foreach (var error in errors)
        {
            _logger.LogError("ZarinPal validation error: code={Code}, message={Message}",
                error.Code, error.Message);
        }
    }

    private static string MaskCardPan(string? cardPan) =>
        string.IsNullOrEmpty(cardPan) || cardPan.Length < 8
            ? cardPan ?? "(none)"
            : $"{cardPan[..6]}******{cardPan[^4..]}";

    private static string? GetHost(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) ? uri.Host : url;

    private static string Truncate(string value, int maxLength = 500) =>
        value.Length <= maxLength ? value : value[..maxLength] + "...";
}

/// <summary>Request payload for POST /pg/v4/payment/request.json.</summary>
public class ZarinPalPaymentRequest
{
    [JsonPropertyName("merchant_id")]
    public string MerchantId { get; set; } = string.Empty;

    [JsonPropertyName("amount")]
    public long Amount { get; set; }

    [JsonPropertyName("currency")]
    public string Currency { get; set; } = "IRT";

    [JsonPropertyName("description")]
    public string Description { get; set; } = string.Empty;

    [JsonPropertyName("callback_url")]
    public string CallbackUrl { get; set; } = string.Empty;

    [JsonPropertyName("metadata")]
    public ZarinPalPaymentMetadata? Metadata { get; set; }
}

public class ZarinPalPaymentMetadata
{
    [JsonPropertyName("mobile")]
    public string? Mobile { get; set; }

    [JsonPropertyName("email")]
    public string? Email { get; set; }
}

/// <summary>Request payload for POST /pg/v4/payment/verify.json.</summary>
public class ZarinPalVerifyRequest
{
    [JsonPropertyName("merchant_id")]
    public string MerchantId { get; set; } = string.Empty;

    [JsonPropertyName("amount")]
    public long Amount { get; set; }

    [JsonPropertyName("authority")]
    public string Authority { get; set; } = string.Empty;
}

/// <summary>Parsed result of a successful verification.</summary>
public sealed record ZarinPalVerifyResult(long RefId, string? CardPan, string? CardHash, long? Fee);

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
    [JsonConverter(typeof(ZarinPalErrorsConverter))]
    public List<ZarinPalError>? Errors { get; set; }
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
    [JsonConverter(typeof(ZarinPalErrorsConverter))]
    public List<ZarinPalError>? Errors { get; set; }
}

public class ZarinPalError
{
    [JsonPropertyName("code")]
    public int Code { get; set; }

    [JsonPropertyName("message")]
    public string? Message { get; set; }
}

/// <summary>
/// ZarinPal v4 reports errors either as a single error object or as an error
/// array; this converter accepts both shapes and normalizes to a list.
/// </summary>
public class ZarinPalErrorsConverter : JsonConverter<List<ZarinPalError>>
{
    public override List<ZarinPalError>? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
            return null;

        if (reader.TokenType == JsonTokenType.StartArray)
            return JsonSerializer.Deserialize<List<ZarinPalError>>(ref reader, options);

        if (reader.TokenType == JsonTokenType.StartObject)
        {
            var item = JsonSerializer.Deserialize<ZarinPalError>(ref reader, options);
            return item is null ? null : [item];
        }

        throw new JsonException($"Unexpected token {reader.TokenType} for ZarinPal errors.");
    }

    public override void Write(Utf8JsonWriter writer, List<ZarinPalError> value, JsonSerializerOptions options)
        => JsonSerializer.Serialize(writer, value, options);
}