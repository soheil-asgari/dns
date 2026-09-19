using Application.Interfaces;
using Domain.Entities;
using Infrastructure.Data;
using Infrastructure.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StackExchange.Redis;
using System.Text.Json;

namespace WebApi.Controllers;

[ApiController]
[Route("api/payment")]
public class PaymentController : ControllerBase
{
    private readonly AppDbContext _context;
    private readonly ZarinPalPaymentService _zarinPal;
    private readonly IConnectionMultiplexer _redis;
    private readonly ILogger<PaymentController> _logger;

    public PaymentController(AppDbContext context, ZarinPalPaymentService zarinPal,
        IConnectionMultiplexer redis, ILogger<PaymentController> logger)
    {
        _context = context;
        _zarinPal = zarinPal;
        _redis = redis;
        _logger = logger;
    }

    /// <summary>
    /// Get active plans list.
    /// </summary>
    [HttpGet("plans")]
    public async Task<IActionResult> GetPlans()
    {
        var plans = await _context.Plans
            .Where(p => p.IsActive)
            .OrderBy(p => p.Price)
            .Select(p => new
            {
                p.Id,
                p.Title,
                p.Price,
                p.DurationDays
            })
            .ToListAsync();

        return Ok(new { plans });
    }

    /// <summary>
    /// Validate discount code and return discounted price.
    /// </summary>
    [HttpPost("apply-discount")]
    public async Task<IActionResult> ApplyDiscount([FromBody] ApplyDiscountRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Code))
            return BadRequest(new { error = "کد تخفیف الزامی است" });

        var plan = await _context.Plans.FindAsync(request.PlanId);
        if (plan == null || !plan.IsActive)
            return BadRequest(new { error = "پلن یافت نشد" });

        var code = request.Code.Trim().ToUpperInvariant();
        var discount = await _context.DiscountCodes
            .FirstOrDefaultAsync(d => d.Code == code && d.IsActive);

        if (discount == null)
            return BadRequest(new { error = "کد تخفیف نامعتبر است" });

        if (discount.ExpireAt.HasValue && discount.ExpireAt < DateTime.UtcNow)
            return BadRequest(new { error = "کد تخفیف منقضی شده است" });

        if (discount.UsedCount >= discount.MaxUses)
            return BadRequest(new { error = "کد تخفیف به حداکثر استفاده رسیده است" });

        var discountedPrice = plan.Price - (plan.Price * discount.Percent / 100);

        return Ok(new
        {
            discountId = discount.Id,
            originalPrice = plan.Price,
            discountedPrice,
            percent = discount.Percent,
            code = discount.Code
        });
    }

    /// <summary>
    /// Create transaction and get ZarinPal payment URL.
    /// </summary>
    [HttpPost("checkout")]
    public async Task<IActionResult> Checkout([FromBody] CheckoutRequest request)
    {
        if (request.TelegramId == 0)
            return BadRequest(new { error = "TelegramId is required" });
        if (request.PlanId == Guid.Empty)
            return BadRequest(new { error = "PlanId is required" });

        var user = await _context.Users.FirstOrDefaultAsync(u => u.TelegramId == request.TelegramId);
        if (user == null)
            return BadRequest(new { error = "کاربر یافت نشد" });

        var plan = await _context.Plans.FindAsync(request.PlanId);
        if (plan == null || !plan.IsActive)
            return BadRequest(new { error = "پلن یافت نشد" });

        long finalAmount = plan.Price;
        Guid? discountCodeId = null;

        if (!string.IsNullOrWhiteSpace(request.DiscountCode))
        {
            var code = request.DiscountCode.Trim().ToUpperInvariant();
            var discount = await _context.DiscountCodes
                .FirstOrDefaultAsync(d => d.Code == code && d.IsActive);

            if (discount == null)
                return BadRequest(new { error = "کد تخفیف نامعتبر است" });

            if (discount.ExpireAt.HasValue && discount.ExpireAt < DateTime.UtcNow)
                return BadRequest(new { error = "کد تخفیف منقضی شده است" });

            if (discount.UsedCount >= discount.MaxUses)
                return BadRequest(new { error = "کد تخفیف به حداکثر استفاده رسیده است" });

            finalAmount = plan.Price - (plan.Price * discount.Percent / 100);
            discountCodeId = discount.Id;
        }

        var callbackUrl = "https://dns.rhynoai.ir/api/payment/callback";

        var (authority, startPayUrl) = await _zarinPal.RequestPaymentAsync(
            finalAmount, $"خرید اشتراک: {plan.Title}", callbackUrl);

        if (string.IsNullOrEmpty(authority) || string.IsNullOrEmpty(startPayUrl))
            return StatusCode(502, new { error = "خطا در اتصال به درگاه پرداخت" });

        var transaction = new PaymentTransaction
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            TelegramId = request.TelegramId,
            PlanId = plan.Id,
            DiscountCodeId = discountCodeId,
            Amount = finalAmount,
            Authority = authority,
            Status = PaymentStatus.Pending,
            CreatedAt = DateTime.UtcNow
        };

        _context.PaymentTransactions.Add(transaction);

        // Increment discount usage if applied
        if (discountCodeId.HasValue)
        {
            var discount = await _context.DiscountCodes.FindAsync(discountCodeId.Value);
            if (discount != null)
            {
                discount.UsedCount++;
            }
        }

        await _context.SaveChangesAsync();

        return Ok(new
        {
            paymentUrl = startPayUrl,
            authority,
            transactionId = transaction.Id,
            amount = finalAmount
        });
    }

    /// <summary>
    /// ZarinPal callback endpoint.
    /// </summary>
    [HttpGet("callback")]
    public async Task<IActionResult> Callback([FromQuery] string authority, [FromQuery] string status)
    {
        if (string.IsNullOrEmpty(authority))
            return Content("پارامتر Authority یافت نشد", "text/html");

        var transaction = await _context.PaymentTransactions
            .Include(t => t.Plan)
            .Include(t => t.User)
            .FirstOrDefaultAsync(t => t.Authority == authority);

        if (transaction == null)
            return Content("تراکنش یافت نشد", "text/html");

        if (status != "OK")
        {
            transaction.Status = PaymentStatus.Failed;
            await _context.SaveChangesAsync();
            return Content(FailureHtml(), "text/html; charset=utf-8");
        }

        // Verify with ZarinPal
        var refId = await _zarinPal.VerifyPaymentAsync(authority, transaction.Amount);

        if (refId == null)
        {
            transaction.Status = PaymentStatus.Failed;
            await _context.SaveChangesAsync();
            return Content(FailureHtml(), "text/html; charset=utf-8");
        }

        // Success: update transaction
        transaction.Status = PaymentStatus.Success;
        transaction.RefId = refId;
        transaction.VerifiedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync();

        // Extend or create subscription
        var userId = transaction.UserId;
        var plan = transaction.Plan;

        var subscription = await _context.Subscriptions
            .Where(s => s.UserId == userId && s.IsActive && s.EndDate > DateTime.UtcNow)
            .OrderByDescending(s => s.EndDate)
            .FirstOrDefaultAsync();

        Subscription newSub;
        if (subscription != null)
        {
            // Extend existing subscription
            subscription.EndDate = subscription.EndDate.AddDays(plan.DurationDays);
            subscription.IsActive = true;
            newSub = subscription;
        }
        else
        {
            // Create new subscription
            newSub = new Subscription
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                Type = SubscriptionType.PaidMonthly,
                StartDate = DateTime.UtcNow,
                EndDate = DateTime.UtcNow.AddDays(plan.DurationDays),
                IsActive = true
            };
            _context.Subscriptions.Add(newSub);
        }

        await _context.SaveChangesAsync();

        // Update Redis TTL for registered IP if exists
        var regIp = newSub.RegisteredIp;
        if (!string.IsNullOrWhiteSpace(regIp))
        {
            var db = _redis.GetDatabase();
            var remainingSeconds = (int)(newSub.EndDate - DateTime.UtcNow).TotalSeconds;
            if (remainingSeconds > 0)
            {
                await db.KeyExpireAsync($"allowed_ips:{regIp}", TimeSpan.FromSeconds(remainingSeconds));
                await db.KeyExpireAsync("whitelist:ips", TimeSpan.FromSeconds(remainingSeconds));
            }
        }

        // Notify user via Telegram bot (relay to Redis pub/sub)
        try
        {
            var notifyPayload = JsonSerializer.Serialize(new
            {
                telegramId = transaction.TelegramId,
                refId = refId,
                amount = transaction.Amount,
                planTitle = plan.Title,
                endDate = newSub.EndDate,
                type = "payment_success"
            });
            var sub = _redis.GetSubscriber();
            await sub.PublishAsync(RedisChannel.Literal("payment:notify"), notifyPayload);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to publish payment notification to Redis");
        }

        return Content(SuccessHtml(refId!.Value, newSub.EndDate), "text/html; charset=utf-8");
    }

    private static string SuccessHtml(long refId, DateTime endDate)
    {
        var persianDate = endDate.ToString("yyyy/MM/dd HH:mm");
        return $@"<!DOCTYPE html>
<html lang=""fa"" dir=""rtl"">
<head>
<meta charset=""UTF-8"">
<meta name=""viewport"" content=""width=device-width, initial-scale=1.0"">
<title>پرداخت موفق</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;700;900&display=swap');
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    font-family: 'Vazirmatn', sans-serif;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(ellipse at top, #1a1a2e 0%, #16213e 50%, #0f0f1a 100%);
    padding: 20px;
  }}
  .glass-card {{
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 24px;
    padding: 48px 40px;
    max-width: 480px;
    width: 100%;
    text-align: center;
    box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  }}
  .icon {{ font-size: 72px; margin-bottom: 16px; }}
  h1 {{
    color: #4ade80;
    font-size: 24px;
    font-weight: 900;
    margin-bottom: 8px;
  }}
  .subtitle {{ color: rgba(255,255,255,0.6); font-size: 14px; margin-bottom: 32px; }}
  .info-grid {{
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 32px;
  }}
  .info-row {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 12px;
    padding: 14px 20px;
  }}
  .info-label {{ color: rgba(255,255,255,0.5); font-size: 13px; }}
  .info-value {{ color: #fff; font-weight: 700; font-size: 15px; direction: ltr; }}
  .badge {{
    display: inline-block;
    background: rgba(74, 222, 128, 0.15);
    color: #4ade80;
    padding: 6px 16px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 700;
    margin-top: 8px;
  }}
  .btn-return {{
    display: inline-block;
    margin-top: 24px;
    padding: 14px 36px;
    background: linear-gradient(135deg, #4ade80, #22c55e);
    color: #0f0f1a;
    font-weight: 700;
    font-size: 15px;
    border: none;
    border-radius: 12px;
    cursor: pointer;
    text-decoration: none;
    transition: transform 0.2s, box-shadow 0.2s;
  }}
  .btn-return:hover {{ transform: translateY(-2px); box-shadow: 0 8px 25px rgba(74, 222, 128, 0.3); }}
</style>
</head>
<body>
<div class=""glass-card"">
  <div class=""icon"">✅</div>
  <h1>پرداخت شما با موفقیت انجام شد!</h1>
  <p class=""subtitle"">اشتراک شما تمدید گردید</p>
  <div class=""info-grid"">
    <div class=""info-row"">
      <span class=""info-label"">کد پیگیری</span>
      <span class=""info-value"">{refId}</span>
    </div>
    <div class=""info-row"">
      <span class=""info-label"">تاریخ انقضا</span>
      <span class=""info-value"">{persianDate}</span>
    </div>
  </div>
  <div class=""badge"">✅ اشتراک شما تا تاریخ {persianDate} تمدید گردید.</div>
  <a class=""btn-return"" href=""https://t.me/rhyno_dns_bot"">بازگشت به ربات</a>
</div>
</body>
</html>";
    }

    private static string FailureHtml()
    {
        return @"<!DOCTYPE html>
<html lang=""fa"" dir=""rtl"">
<head>
<meta charset=""UTF-8"">
<meta name=""viewport"" content=""width=device-width, initial-scale=1.0"">
<title>پرداخت ناموفق</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;700;900&display=swap');
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    font-family: 'Vazirmatn', sans-serif;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(ellipse at top, #1a1a2e 0%, #16213e 50%, #0f0f1a 100%);
    padding: 20px;
  }}
  .glass-card {{
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 24px;
    padding: 48px 40px;
    max-width: 420px;
    width: 100%;
    text-align: center;
    box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  }}
  .icon {{ font-size: 72px; margin-bottom: 16px; }}
  h1 {{ color: #f87171; font-size: 24px; font-weight: 900; margin-bottom: 8px; }}
  p {{ color: rgba(255,255,255,0.6); font-size: 14px; margin-bottom: 24px; }}
  .btn-return {{
    display: inline-block;
    margin-top: 8px;
    padding: 14px 36px;
    background: linear-gradient(135deg, #f87171, #ef4444);
    color: #fff;
    font-weight: 700;
    font-size: 15px;
    border: none;
    border-radius: 12px;
    cursor: pointer;
    text-decoration: none;
    transition: transform 0.2s, box-shadow 0.2s;
  }}
  .btn-return:hover {{ transform: translateY(-2px); box-shadow: 0 8px 25px rgba(248, 113, 113, 0.3); }}
</style>
</head>
<body>
<div class=""glass-card"">
  <div class=""icon"">❌</div>
  <h1>پرداخت ناموفق بود یا توسط کاربر لغو شد</h1>
  <p>در صورت کسر وجه، مبلغ ظرف ۲۴ ساعت به حساب شما بازگردانده خواهد شد.</p>
  <a class=""btn-return"" href=""https://t.me/rhyno_dns_bot"">بازگشت به ربات</a>
</div>
</body>
</html>";
    }
}

public class ApplyDiscountRequest
{
    public string Code { get; set; } = string.Empty;
    public Guid PlanId { get; set; }
}

public class CheckoutRequest
{
    public long TelegramId { get; set; }
    public Guid PlanId { get; set; }
    public string? DiscountCode { get; set; }
}