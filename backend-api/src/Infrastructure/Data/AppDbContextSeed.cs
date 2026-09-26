using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Domain.Entities;

namespace Infrastructure.Data;

public class AppDbContextSeed
{
    public static async Task SeedAsync(AppDbContext context)
    {
        // Seed gaming domains if empty
        if (!await context.GamingDomains.AnyAsync())
        {
            var gamingDomains = new List<GamingDomain>
            {
                // Call of Duty / Activision (HTTP/HTTPS only — no UDP game-server domains)
                new() { Domain = "cod.cdn.activision.com", GameName = "Call of Duty CDN", CustomIp = null, Priority = 1 },
                new() { Domain = "atvi-cdn.callofduty.com", GameName = "Activision CDN", CustomIp = null, Priority = 1 },
                new() { Domain = "cdn.callofduty.com", GameName = "Call of Duty CDN", CustomIp = null, Priority = 1 },
                new() { Domain = "manifest.callofduty.com", GameName = "Call of Duty Manifest", CustomIp = null, Priority = 1 },
                new() { Domain = "auth.callofduty.com", GameName = "Call of Duty Auth", CustomIp = null, Priority = 1 },
                new() { Domain = "profile.callofduty.com", GameName = "Call of Duty Profile", CustomIp = null, Priority = 1 },
                new() { Domain = "uno.atvi.com", GameName = "Activision Uno", CustomIp = null, Priority = 1 },

                // AI services
                new() { Domain = "gemini.google.com", GameName = "Google Gemini", CustomIp = null, Priority = 1 },
                new() { Domain = "proactivebackend-pa.googleapis.com", GameName = "Google AI Backend", CustomIp = null, Priority = 1 },
                new() { Domain = "alkalimakersuite-pa.googleapis.com", GameName = "Google AI Makersuite", CustomIp = null, Priority = 1 },
                new() { Domain = "generativelanguage.googleapis.com", GameName = "Google Generative AI", CustomIp = null, Priority = 1 },

                // Platform services (TCP:443 only)
                new() { Domain = "discord.com", GameName = "Discord", CustomIp = null, Priority = 1 },
                new() { Domain = "discordapp.com", GameName = "Discord App", CustomIp = null, Priority = 1 },
                new() { Domain = "discord.gg", GameName = "Discord GG", CustomIp = null, Priority = 1 },
                new() { Domain = "battle.net", GameName = "Blizzard Battle.net", CustomIp = null, Priority = 2 },
                new() { Domain = "blizzard.com", GameName = "Blizzard", CustomIp = null, Priority = 2 },
                new() { Domain = "battlenet.com", GameName = "Battle.net", CustomIp = null, Priority = 2 },
                new() { Domain = "steampowered.com", GameName = "Steam", CustomIp = null, Priority = 2 },
                new() { Domain = "steamcommunity.com", GameName = "Steam Community", CustomIp = null, Priority = 2 },
                new() { Domain = "xboxlive.com", GameName = "Xbox Live", CustomIp = null, Priority = 1 },
                new() { Domain = "playfabapi.com", GameName = "PlayFab API", CustomIp = null, Priority = 1 },

                // Call of Duty patch validation & asset store
                new() { Domain = "cod-assets.cdn.callofduty.com", GameName = "Call of Duty Asset CDN", CustomIp = null, Priority = 1 },
                new() { Domain = "prod.cdni.callofduty.com", GameName = "Call of Duty CDNi", CustomIp = null, Priority = 1 },
                new() { Domain = "telescope.callofduty.com", GameName = "Call of Duty Telescope Telemetry", CustomIp = null, Priority = 1 },
                new() { Domain = "ingest.datax.activision.com", GameName = "Activision DataX Ingest", CustomIp = null, Priority = 1 },
                new() { Domain = "objectstore-cloud-prod-sat.egcp.demonware.net", GameName = "Demonware Object Store", CustomIp = null, Priority = 1 },
                new() { Domain = "user-consent.prod.demonware.net", GameName = "Demonware User Consent", CustomIp = null, Priority = 1 },
            };
            context.GamingDomains.AddRange(gamingDomains);
        }

        // Seed default plans if empty
        if (!await context.Plans.AnyAsync())
        {
            context.Plans.Add(new Plan
            {
                Title = "اشتراک ۱ ماهه (۳۰ روز)",
                Price = 100000,
                DurationDays = 30,
                IsActive = true
            });
        }

        // Seed default admin user if not present
        if (!await context.AdminUsers.AnyAsync(u => u.Username == "admin"))
        {
            var passwordSalt = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
            var passwordHash = HashPassword("soheil1371", passwordSalt);

            context.AdminUsers.Add(new AdminUser
            {
                Id = Guid.NewGuid(),
                Username = "admin",
                PasswordHash = passwordHash,
                PasswordSalt = passwordSalt,
                Role = "Admin"
            });
        }

        await context.SaveChangesAsync();
    }

    public static string HashPassword(string password, string salt)
    {
        var saltBytes = Convert.FromHexString(salt);
        var pbkdf2 = new Rfc2898DeriveBytes(password, saltBytes, 100_000, HashAlgorithmName.SHA256);
        return Convert.ToHexString(pbkdf2.GetBytes(64));
    }
}