using Application.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace WebApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class IpController : ControllerBase
{
    /// <summary>
    /// Detects and returns the client's public IP address.
    /// Considers X-Forwarded-For and X-Real-IP proxy headers.
    /// </summary>
    [HttpGet("detect")]
    public IActionResult DetectIp()
    {
        var forwardedFor = HttpContext.Request.Headers["X-Forwarded-For"].FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(forwardedFor))
        {
            var ip = forwardedFor.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(ip))
                return Ok(new IpDetectionResponse { Ip = ip });
        }

        var realIp = HttpContext.Request.Headers["X-Real-IP"].FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(realIp))
            return Ok(new IpDetectionResponse { Ip = realIp });

        var remoteIp = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "0.0.0.0";
        return Ok(new IpDetectionResponse { Ip = remoteIp });
    }
}