using Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Infrastructure.Data;

public class AppDbContextSeed
{
    public static async Task SeedAsync(AppDbContext context)
    {
        if (await context.GamingDomains.AnyAsync()) return;

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
        await context.SaveChangesAsync();
    }
}