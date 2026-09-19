using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace Infrastructure.Services;

public class ZarinPalPaymentService
{
    private readonly HttpClient _httpClient;
    private readonly string _merchantId;
    private readonly ILogger<ZarinPalPaymentService> _logger;

    public ZarinPalPaymentService(HttpClient httpClient, ILogger<ZarinPalPaymentService> logger)
    {
        _httpClient = httpClient;
        _merchantId = Environment.GetEnvironmentVariable("ZARINPAL_MERCHANT_ID")
                      ?? "62e3e405-05ed-463b-84c5-ea10adbfa9c7";
        _logger = logger;
    }

    public async Task<(string? Authority, string? StartPayUrl)> RequestPaymentAsync(
        long amountTomans, string description, string callbackUrl)
    {
        try
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

            var response = await _httpClient.PostAsJsonAsync(
                "https://api.zarinpal.com/pg/v4/payment/request.json", requestBody);

            var json = await response.Content.ReadFromJsonAsync<ZarinPalRequestResponse>();

            if (json?.Data?.Authority != null && json.Data.Code == 100)
            {
                var startPayUrl = $"https://payment.zarinpal.com/pg/StartPay/{json.Data.Authority}";
                _logger.LogInformation("ZarinPal authority obtained: {Authority}", json.Data.Authority);
                return (json.Data.Authority, startPayUrl);
            }

            _logger.LogError("ZarinPal request failed: Code={Code}, Message={Msg}",
                json?.Data?.Code, json?.Errors?.Message);
            return (null, null);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "ZarinPal request exception");
            return (null, null);
        }
    }

    public async Task<long?> VerifyPaymentAsync(string authority, long amountTomans)
    {
        try
        {
            var requestBody = new
            {
                merchant_id = _merchantId,
                authority,
                amount = amountTomans * 10
            };

            var response = await _httpClient.PostAsJsonAsync(
                "https://api.zarinpal.com/pg/v4/payment/verify.json", requestBody);

            var json = await response.Content.ReadFromJsonAsync<ZarinPalVerifyResponse>();

            if (json?.Data != null && (json.Data.Code == 100 || json.Data.Code == 101))
            {
                _logger.LogInformation("ZarinPal verify success: Authority={Auth}, RefId={RefId}",
                    authority, json.Data.RefId);
                return json.Data.RefId;
            }

            _logger.LogError("ZarinPal verify failed: Code={Code}, Message={Msg}",
                json?.Data?.Code, json?.Errors?.Message);
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "ZarinPal verify exception");
            return null;
        }
    }
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