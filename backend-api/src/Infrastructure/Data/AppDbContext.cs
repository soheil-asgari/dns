using Microsoft.EntityFrameworkCore;
using Domain.Entities;

namespace Infrastructure.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<DnsRecord> DnsRecords { get; set; } = null!;
    public DbSet<GamingDomain> GamingDomains { get; set; } = null!;
    public DbSet<ProxyRule> ProxyRules { get; set; } = null!;
}