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
                new() { Domain = "playstation.com", GameName = "PlayStation Network", CustomIp = null, Priority = 1 },
                new() { Domain = "xbox.com", GameName = "Xbox Live", CustomIp = null, Priority = 1 },
                new() { Domain = "steampowered.com", GameName = "Steam", CustomIp = null, Priority = 2 },
                new() { Domain = "epicgames.com", GameName = "Epic Games", CustomIp = null, Priority = 2 },
                new() { Domain = "battle.net", GameName = "Blizzard Battle.net", CustomIp = null, Priority = 2 },
                new() { Domain = "ea.com", GameName = "EA Games", CustomIp = null, Priority = 3 },
                new() { Domain = "ubisoft.com", GameName = "Ubisoft", CustomIp = null, Priority = 3 },
                new() { Domain = "riotgames.com", GameName = "Riot Games", CustomIp = null, Priority = 2 },
                new() { Domain = "discord.com", GameName = "Discord", CustomIp = null, Priority = 1 },
                new() { Domain = "twitch.tv", GameName = "Twitch", CustomIp = null, Priority = 3 },
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
            var passwordHash = HashPassword("Admin@Secure123!", passwordSalt);

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