using System.Collections.Concurrent;
using System.IO;
using System.Net.Sockets;
using System.Text;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using StackExchange.Redis;

namespace Infrastructure.BackgroundServices;

/// <summary>
/// Background service that synchronizes the Redis <c>whitelist:ips</c> set
/// with HAProxy's in-memory ACL and the shared <c>whitelist.acl</c> file.
///
/// Operates in three modes:
/// 1. <b>Startup bulk sync</b> - reads all IPs from Redis, writes the ACL file,
///    and populates the HAProxy runtime ACL table.
/// 2. <b>Real-time event-driven</b> - subscribes to Redis keyspace notifications
///    on <c>whitelist:ips</c> set changes and pushes add/del commands via the
///    HAProxy runtime socket immediately.
/// 3. <b>Periodic reconciliation</b> - every 60 seconds, re-reads the Redis set
///    and diffs against the HAProxy in-memory ACL to correct any drift.
/// </summary>
public sealed class HaproxyAclSyncService : BackgroundService
{
    private readonly IConnectionMultiplexer _redis;
    private readonly ILogger<HaproxyAclSyncService> _logger;

    private const string AclFilePath = "/usr/local/etc/haproxy/whitelist.acl";
    private const string SocketPath = "/usr/local/etc/haproxy/admin.sock";
    private const string WhitelistKey = "whitelist:ips";
    private static readonly TimeSpan ReconciliationPeriod = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan SocketConnectTimeout = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan SocketSendTimeout = TimeSpan.FromSeconds(5);

    // Tracks IPs we believe are in the HAProxy in-memory ACL to avoid redundant calls.
    private readonly ConcurrentDictionary<string, byte> _syncedIps = new(StringComparer.OrdinalIgnoreCase);

    public HaproxyAclSyncService(IConnectionMultiplexer redis, ILogger<HaproxyAclSyncService> logger)
    {
        _redis = redis;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("HaproxyAclSyncService starting...");

        // 1. Initial bulk sync from Redis -> ACL file + HAProxy socket
        try
        {
            await FullSyncAsync(stoppingToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Initial full sync failed. Continuing with periodic sync.");
        }

        // 2. Subscribe to Redis keyspace notifications for the whitelist set
        var subscriber = _redis.GetSubscriber();
        var channel = new RedisChannel("__keyevent@0__:set", RedisChannel.PatternMode.Literal);
        var channelRem = new RedisChannel("__keyevent@0__:srem", RedisChannel.PatternMode.Literal);
        var channelDel = new RedisChannel("__keyevent@0__:del", RedisChannel.PatternMode.Literal);
        var channelExpired = new RedisChannel("__keyevent@0__:expired", RedisChannel.PatternMode.Literal);

        var keySetTask = subscriber.SubscribeAsync(channel, async (_, msg) =>
        {
            if (string.Equals(msg, WhitelistKey, StringComparison.OrdinalIgnoreCase))
                await HandleSetChangeAsync(stoppingToken);
        });

        var keyRemTask = subscriber.SubscribeAsync(channelRem, async (_, msg) =>
        {
            if (string.Equals(msg, WhitelistKey, StringComparison.OrdinalIgnoreCase))
                await HandleSetChangeAsync(stoppingToken);
        });

        var keyDelTask = subscriber.SubscribeAsync(channelDel, async (_, msg) =>
        {
            if (string.Equals(msg, WhitelistKey, StringComparison.OrdinalIgnoreCase))
                await HandleSetDeleteAsync(stoppingToken);
        });

        var keyExpiredTask = subscriber.SubscribeAsync(channelExpired, async (_, msg) =>
        {
            // When allowed_ips:{ip} expires, remove the IP from ACL.
            const string prefix = "allowed_ips:";
            var msgStr = msg.HasValue ? msg.ToString() : null;
            if (msgStr is not null && msgStr.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                var ip = msgStr[prefix.Length..];
                await RemoveIpFromAclAsync(ip, stoppingToken);
            }
        });

        // 2b. Subscribe to acl:sync pub/sub channel for instant signals from SubscriptionService
        var aclSyncChannel = new RedisChannel("acl:sync", RedisChannel.PatternMode.Literal);
        var aclSyncTask = subscriber.SubscribeAsync(aclSyncChannel, async (_, _) =>
        {
            _logger.LogDebug("Received acl:sync signal — performing immediate sync");
            try
            {
                await HandleSetChangeAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error handling acl:sync signal");
            }
        });

        await Task.WhenAll(keySetTask, keyRemTask, keyDelTask, keyExpiredTask, aclSyncTask);
        _logger.LogInformation("Subscribed to Redis keyspace notifications for {Key} and acl:sync channel", WhitelistKey);

        // 3. Periodic reconciliation loop
        try
        {
            await PeriodicReconcileAsync(stoppingToken);
        }
        catch (OperationCanceledException)
        {
            // graceful shutdown
        }

        _logger.LogInformation("HaproxyAclSyncService stopped.");
    }

    // ───────────────────────────── SYNC ENGINES ─────────────────────────────

    /// <summary>
    /// Full sync: read all IPs from Redis <c>whitelist:ips</c>, write the ACL file,
    /// and push every IP to the HAProxy runtime socket via <c>add acl</c> commands.
    /// </summary>
    private async Task FullSyncAsync(CancellationToken ct)
    {
        _logger.LogInformation("Performing full ACL sync from Redis...");

        var db = _redis.GetDatabase();
        var ips = await db.SetMembersAsync(WhitelistKey);
        var ipList = ips.Select(rv => (string)rv!).Where(ip => !string.IsNullOrWhiteSpace(ip)).ToArray();

        _logger.LogInformation("Found {Count} IP(s) in Redis {Key}", ipList.Length, WhitelistKey);

        // 1. Write ACL file
        await WriteAclFileAsync(ipList, ct);

        // 2. Clear and repopulate HAProxy in-memory ACL table via explicit file path.
        await ExecuteSocketCommandAsync($"clear acl {AclFilePath}", ct);

        foreach (var ip in ipList)
        {
            await ExecuteSocketCommandAsync($"add acl {AclFilePath} {ip}", ct);
        }

        // 3. Update local tracking
        _syncedIps.Clear();
        foreach (var ip in ipList)
        {
            _syncedIps.TryAdd(ip, 0);
        }

        _logger.LogInformation("Full ACL sync completed. {Count} IP(s) loaded.", ipList.Length);
    }

    /// <summary>
    /// Called when <c>SADD</c> or <c>SREM</c> is detected on <c>whitelist:ips</c>.
    /// Re-reads the set from Redis and diffs against our local tracking to
    /// apply only the changes to HAProxy.
    /// Also writes the ACL file to keep it consistent.
    /// </summary>
    private async Task HandleSetChangeAsync(CancellationToken ct)
    {
        try
        {
            var db = _redis.GetDatabase();
            var ips = await db.SetMembersAsync(WhitelistKey);
            var currentIps = ips.Select(rv => (string)rv!).Where(ip => !string.IsNullOrWhiteSpace(ip)).ToHashSet(StringComparer.OrdinalIgnoreCase);

            // IPs to add (in Redis but not in local tracking)
            foreach (var ip in currentIps)
            {
                if (_syncedIps.TryAdd(ip, 0))
                {
                    await AddIpToAclAsync(ip, ct);
                }
            }

            // IPs to remove (in local tracking but not in Redis)
            foreach (var (ip, _) in _syncedIps)
            {
                if (!currentIps.Contains(ip))
                {
                    await RemoveIpFromAclAsync(ip, ct);
                }
            }

            // Sync the ACL file to disk
            await WriteAclFileAsync([.. currentIps], ct);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error handling set change for {Key}", WhitelistKey);
        }
    }

    /// <summary>
    /// Called when the entire <c>whitelist:ips</c> key is deleted (DEL).
    /// Clears all IPs from the ACL.
    /// </summary>
    private async Task HandleSetDeleteAsync(CancellationToken ct)
    {
        _logger.LogWarning("{Key} was deleted. Clearing all ACL entries.", WhitelistKey);

        try
        {
            await ExecuteSocketCommandAsync($"clear acl {AclFilePath}", ct);
            await WriteAclFileAsync([], ct);
            _syncedIps.Clear();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error handling set delete for {Key}", WhitelistKey);
        }
    }

    /// <summary>
    /// Periodic reconciliation: every 60s, compare Redis set with HAProxy in-memory ACL
    /// and fix any drift.
    /// </summary>
    private async Task PeriodicReconcileAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(ReconciliationPeriod, ct);

            try
            {
                _logger.LogDebug("Running periodic ACL reconciliation...");

                var db = _redis.GetDatabase();
                var redisIps = await db.SetMembersAsync(WhitelistKey);
                var redisIpSet = redisIps
                    .Select(rv => (string)rv!)
                    .Where(ip => !string.IsNullOrWhiteSpace(ip))
                    .ToHashSet(StringComparer.OrdinalIgnoreCase);

                // Get current HAProxy in-memory ACL entries
                var haproxyIps = await GetCurrentAclEntriesAsync(ct);
                var haproxyIpSet = new HashSet<string>(haproxyIps, StringComparer.OrdinalIgnoreCase);

                // Add IPs that are in Redis but missing from HAProxy
                foreach (var ip in redisIpSet)
                {
                    if (!haproxyIpSet.Contains(ip))
                    {
                        _logger.LogWarning("Reconciliation: adding missing IP {Ip} to HAProxy ACL", ip);
                        await AddIpToAclAsync(ip, ct);
                    }
                }

                // Remove IPs that are in HAProxy but not in Redis
                foreach (var ip in haproxyIpSet)
                {
                    if (!redisIpSet.Contains(ip))
                    {
                        _logger.LogWarning("Reconciliation: removing stale IP {Ip} from HAProxy ACL", ip);
                        await RemoveIpFromAclAsync(ip, ct);
                    }
                }

                // Also sync the ACL file to stay consistent
                await WriteAclFileAsync([.. redisIpSet], ct);

                _logger.LogDebug("ACL reconciliation completed.");
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "Periodic ACL reconciliation failed.");
            }
        }
    }

    // ─────────────────────── ACL MUTATION HELPERS ───────────────────────

    private async Task AddIpToAclAsync(string ip, CancellationToken ct)
    {
        await ExecuteSocketCommandAsync($"add acl {AclFilePath} {ip}", ct);
        _syncedIps.TryAdd(ip, 0);
        _logger.LogDebug("Added IP {Ip} to HAProxy ACL (socket)", ip);
    }

    private async Task RemoveIpFromAclAsync(string ip, CancellationToken ct)
    {
        await ExecuteSocketCommandAsync($"del acl {AclFilePath} {ip}", ct);
        _syncedIps.TryRemove(ip, out _);
        _logger.LogDebug("Removed IP {Ip} from HAProxy ACL (socket)", ip);
    }

    /// <summary>
    /// Writes the ACL file used by HAProxy's <c>acl is_allowed_ip src -f ...</c> directive.
    /// The file is used both as a fallback and as the persistent source of truth on disk.
    /// </summary>
    private async Task WriteAclFileAsync(string[] ips, CancellationToken ct)
    {
        try
        {
            var content = string.Join(Environment.NewLine, ips) + Environment.NewLine;
            await File.WriteAllTextAsync(AclFilePath, content, Encoding.ASCII, ct);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to write ACL file at {Path}", AclFilePath);
        }
    }

    // ─────────────────────── HAproxy SOCKET I/O ───────────────────────

    /// <summary>
    /// Sends a command to the HAProxy admin UNIX socket and returns the response.
    /// Commands like <c>add acl /usr/local/etc/haproxy/whitelist.acl 1.2.3.4</c>,
    /// <c>del acl /usr/local/etc/haproxy/whitelist.acl 1.2.3.4</c>,
    /// <c>clear acl /usr/local/etc/haproxy/whitelist.acl</c>.
    /// </summary>
    private async Task<string> ExecuteSocketCommandAsync(string command, CancellationToken ct)
    {
        using var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
        var ep = new UnixDomainSocketEndPoint(SocketPath);

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(SocketConnectTimeout);

        try
        {
            await socket.ConnectAsync(ep, cts.Token);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Cannot connect to HAProxy socket at {Socket}: {Message}", SocketPath, ex.Message);
            throw;
        }

        // Send command terminated by newline
        var cmdBytes = Encoding.ASCII.GetBytes(command + "\n");
        using var sendCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        sendCts.CancelAfter(SocketSendTimeout);
        await socket.SendAsync(cmdBytes, SocketFlags.None, sendCts.Token);

        // Read response (HAproxy responds with empty line on success, or error)
        var buffer = new byte[4096];
        using var readCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        readCts.CancelAfter(SocketSendTimeout);

        var received = await socket.ReceiveAsync(buffer, SocketFlags.None, readCts.Token);
        var response = Encoding.ASCII.GetString(buffer, 0, received);

        _logger.LogTrace("HAProxy socket command '{Command}' -> '{Response}'", command, response.Trim());
        return response;
    }

    /// <summary>
    /// Reads the current entries from the HAProxy in-memory ACL table for the whitelist file.
    /// Used during reconciliation to diff against Redis.
    /// </summary>
    private async Task<List<string>> GetCurrentAclEntriesAsync(CancellationToken ct)
    {
        var raw = await ExecuteSocketCommandAsync($"show acl {AclFilePath}", ct);
        var entries = new List<string>();

        // show acl /path/to/whitelist.acl returns lines like:
        //   0x12345678 1.2.3.4
        //   ...
        var lines = raw.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        foreach (var line in lines)
        {
            if (line.Length == 0) continue;

            var firstSpace = line.IndexOf(' ');
            if (firstSpace < 0) continue;

            var value = line[(firstSpace + 1)..].Trim();
            if (value.Length > 0 && !value.Contains('#'))
            {
                entries.Add(value);
            }
        }

        return entries;
    }
}