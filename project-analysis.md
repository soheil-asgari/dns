# پروژه DNS گیمینگ — تحلیل جامع، ضعف‌ها، کمبودها و پیشنهادات بهینه‌سازی

## فهرست مطالب
1. [Backend API (ASP.NET Core)](#1-backend-api-aspnet-core)
2. [DNS Server (CoreDNS + Go Plugin)](#2-dns-server-coredns--go-plugin)
3. [Proxy Server (HAProxy)](#3-proxy-server-haproxy)
4. [Panel Frontend (React/Vite)](#4-panel-frontend-reactvite)
5. [Telegram Bot (Node.js/Telegraf)](#5-telegram-bot-nodejstelegraf)
6. [Infrastructure & Scripts](#6-infrastructure--scripts)
7. [Docker & Deployment](#7-docker--deployment)
8. [امنیت (Security)](#8-امنیت-security)
9. [مانیتورینگ و Observability](#9-مانیتورینگ-و-observability)
10. [خلاصه و اولویت‌بندی](#10-خلاصه-و-اولویت‌بندی)

---

## 1. Backend API (ASP.NET Core)

### 1.1. Weaknesses & Gaps

#### [`Program.cs`](backend-api/src/WebApi/Program.cs)

| Issue | Severity | Description |
|-------|----------|-------------|
| **JWT Secret Key Hardcoded Fallback** | 🔴 Critical | [`var secretKey = jwtSettings["SecretKey"] ?? "DefaultSuperSecretKeyForDevelopment12345!"`](backend-api/src/WebApi/Program.cs:37) — Fallback key embedded in source code. If `appsettings.json` is misconfigured in production, this default key is used. |
| **CORS Policy "AllowAll" in Production** | 🔴 Critical | [`options.AddPolicy("AllowAll", policy => { policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader(); })`](backend-api/src/WebApi/Program.cs:88-90) — The `AllowAll` CORS policy is used in ALL environments, not just development. Combined with [`app.UseCors("AllowAll")`](backend-api/src/WebApi/Program.cs:106) which runs unconditionally. |
| **No Rate Limiting Middleware** | 🟠 High | No built-in rate limiting at the API level. Only HAProxy has basic rate limiting. A malicious client hitting the API directly (bypassing HAProxy) has no rate limits. |
| **No API Versioning** | 🟡 Medium | All routes use `/api/[controller]` without versioning (e.g., `/api/v1/...`). Breaking changes will be impossible to manage. |
| **No Request Validation Middleware** | 🟡 Medium | No global request validation or model state validation filter. Each controller handles validation manually and inconsistently. |
| **No Structured Logging Setup** | 🟡 Medium | Only default `ILogger` is used. No Serilog, Elasticsearch sink, or structured logging configured. |
| **Swagger Exposed in All Environments** | 🟠 High | [`if (app.Environment.IsDevelopment()) { app.UseSwagger(); app.UseSwaggerUI(); }`](backend-api/src/WebApi/Program.cs:100-103) — Correctly gated for dev, but actual `appsettings.json` doesn't include `ASPNETCORE_ENVIRONMENT` override validation. |
| **Background Service Manual Scoping** | 🟡 Medium | [`SubscriptionExpiryNotifierWorker`](backend-api/src/Infrastructure/BackgroundServices/SubscriptionExpiryNotifierWorker.cs) manually creates scopes. While this is correct, there's no error handling for scope disposal failures. |
| **No Request/Response Logging** | 🟢 Low | No middleware for logging incoming requests and outgoing responses for audit/debugging. |
| **SyncToRedisAsync Duplicate** | 🟡 Medium | Both [`SyncDnsToRedisAsync`](backend-api/src/Infrastructure/Services/DnsService.cs:103) and [`SyncToRedisAsync`](backend-api/src/Infrastructure/Services/DnsService.cs:119) exist with almost identical functionality. The first one only syncs GamingDomains, the second also includes DnsRecords. This is confusing and violates DRY. `SyncDnsToRedisAsync` appears to be dead code since only `SyncToRedisAsync` is called from `Program.cs` warmup. |
| **Hardcoded Database Password** | 🔴 Critical | [`"Server=sqlserver;Database=DnsServiceDb;User Id=sa;Password=YourStrong!Passw0rd;TrustServerCertificate=True"`](backend-api/src/WebApi/appsettings.json:9) — Hardcoded in both `appsettings.json` and `docker-compose.yml`. |
| **Default Admin Credentials** | 🔴 Critical | Default admin password [`"Admin@Secure123!"`](backend-api/src/Infrastructure/Data/AppDbContextSeed.cs:70) hardcoded in seed code. |

#### Controllers

| Issue | Severity | Location |
|-------|----------|----------|
| **Controller lacks [Authorize]** | 🟠 High | [`PaymentController`](backend-api/src/WebApi/Controllers/PaymentController.cs) has NO authorization attribute at controller level, making all payment endpoints public. |
| **Controller lacks [Authorize]** | 🟠 High | [`SubscriptionController`](backend-api/src/WebApi/Controllers/SubscriptionController.cs) has NO authorization attribute. Endpoints like `quick-register` and `register-ip` are public. While `quick-register` uses HMAC signing, `register-ip` has no auth. |
| **Controller lacks [Authorize]** | 🟠 High | [`IpController.DetectIp()`](backend-api/src/WebApi/Controllers/IpController.cs) is completely public with no rate limiting — can be abused for IP enumeration. |
| **SyncToRedis Endpoint Public** | 🟠 High | [`POST /api/dns/sync-redis`](backend-api/src/WebApi/Controllers/DnsController.cs:47) has `[AllowAnonymous]` — anyone can trigger a Redis sync, potentially causing performance issues. |
| **ZarinPal Merchant ID Hardcoded** | 🟠 High | [`_merchantId = Environment.GetEnvironmentVariable("ZARINPAL_MERCHANT_ID") ?? "62e3e405-..."`](backend-api/src/Infrastructure/Services/ZarinPalPaymentService.cs:49-50) — Fallback merchant ID hardcoded. |
| **HAProxy Stats Password** | 🟠 High | [`stats auth admin:password123`](proxy-server/haproxy.cfg:167) — Hardcoded weak password for HAProxy stats endpoint. |
| **No Input Validation on CRUD** | 🟡 Medium | `CreateRecord` and `UpdateRecord` in [`DnsController`](backend-api/src/WebApi/Controllers/DnsController.cs) accept raw `DnsRecord` objects without validation attributes or DTOs. |
| **DTOs defined inside Controllers** | 🟢 Low | [`BulkGamingDomainsRequest`](backend-api/src/WebApi/Controllers/DnsController.cs:85) and other request/response DTOs are defined inside controller files instead of a shared location. |

#### [`SubscriptionService`](backend-api/src/Infrastructure/Services/SubscriptionService.cs)

| Issue | Severity | Description |
|-------|----------|----------|
| **No Index on TelegramId** | 🟡 Medium | Multiple queries filter by `TelegramId` but there's no database index on `Users.TelegramId` for efficient lookup (there IS a unique index, but it covers the full column). Performance should be fine but worth noting. |
| **Race Condition in Trial Provisioning** | 🟡 Medium | [`ProvisionTrialAsync`](backend-api/src/Infrastructure/Services/SubscriptionService.cs:76-103) — There's a TOCTOU (time-of-check time-of-use) race condition: between checking `hadTrial` and adding the trial subscription, another concurrent request could also pass the check and create multiple trials. |
| **IP Registration Race Condition** | 🟡 Medium | [`RegisterIpAsync`](backend-api/src/Infrastructure/Services/SubscriptionService.cs:131-208) — The entire operation is not wrapped in a transaction. Between checking active subscription, evicting old IP, updating Redis, and saving to SQL, a concurrent request could cause inconsistency. |
| **No Subscription Expiry Cleanup** | 🟡 Medium | While `RegisterIpAsync` sets TTL on Redis keys, there's no background cleanup for expired subscriptions' IPs in nftables (if nftables is actually being used). The Redis TTL handles cache, but nftables rules persist. |

#### [`AppDbContextSeed`](backend-api/src/Infrastructure/Data/AppDbContextSeed.cs)

| Issue | Severity | Description |
|-------|----------|----------|
| **Only One Plan Seeded** | 🟢 Low | Only a single 30-day plan at 100,000 Tomans is seeded. No multiple plan tiers (weekly, 3-month, 6-month, yearly). |
| **Domains Not Sorted/Grouped** | 🟢 Low | Gaming domains in seed are listed arbitrarily without clear grouping by game/service category for better management. |

#### Entity/Architecture Issues

| Issue | Severity | Description |
|-------|----------|----------|
| **Missing GamingDomain Entity** | 🟡 Medium | [`DnsService.cs`](backend-api/src/Infrastructure/Services/DnsService.cs) references `GamingDomain` entity extensively, but the actual `GamingDomain.cs` file wasn't found in the entities directory. This entity should exist but was likely missed. |
| **Missing GamingDomainDto** | 🟡 Medium | [`DnsService.cs`](backend-api/src/Infrastructure/Services/DnsService.cs:86) uses `GamingDomainDto` which is not defined anywhere in the domain or application layers. |
| **Missing DnsResolutionResult** | 🟡 Medium | [`DnsService.cs`](backend-api/src/Infrastructure/Services/DnsService.cs:59) uses `DnsResolutionResult` which needs to be defined somewhere. |
| **Domain Entity Layer Is Empty** | 🟡 Medium | The [`Domain/Entities`](backend-api/src/Domain/Entities) directory contains entity files, but there are no domain interfaces, value objects, or domain services. The Domain layer is essentially just anemic data models (Entity Framework POCOs). |
| **Application Layer Is Minimal** | 🟡 Medium | The [`Application`](backend-api/src/Application) layer only has two interface files. No use-cases, DTOs, mappers, or business logic. |
| **No MediatR / CQRS Pattern** | 🟢 Low | Controllers directly call infrastructure services without any mediator pattern, making it hard to add cross-cutting concerns like logging, caching, or validation in a centralized way. |

### 1.2. Optimization Suggestions

1. **Move JWT secret, DB password, ZarinPal Merchant ID, and all secrets to user secrets / environment variables / vault** — Never use hardcoded fallback secrets in source code.
2. **Implement environment-specific CORS policies** — Restrict CORS in production to specific origins.
3. **Add API rate limiting middleware** — Use `AspNetCoreRateLimit` package or similar.
4. **Add API versioning via URL path** — `/api/v1/...` for future compatibility.
5. **Remove dead code** — `SyncDnsToRedisAsync` should be removed if not used.
6. **Add missing entity/DTO files** — `GamingDomain.cs`, `GamingDomainDto.cs`, `DnsResolutionResult.cs`.
7. **Secure all endpoints** — Add `[Authorize]` attribute or appropriate auth to ALL controllers.
8. **Remove `[AllowAnonymous]` from sync-redis endpoint**.
9. **Wrap `RegisterIpAsync` and `ProvisionTrialAsync` in database transactions** to prevent race conditions.
10. **Add structured logging** with Serilog + Seq/Elasticsearch.
11. **Implement MediatR / CQRS** for cleaner separation of concerns.
12. **Add FluentValidation** for request DTO validation.
13. **Use DTOs properly** — Separate request DTOs from entities, don't accept raw entities from API.

---

## 2. DNS Server (CoreDNS + Go Plugin)

### 2.1. Weaknesses & Gaps

#### [`Corefile`](dns-server/Corefile)

| Issue | Severity | Description |
|-------|----------|----------|
| **No TLS for DNS-over-HTTPS** | 🟡 Medium | CoreDNS only serves plain DNS on port 53. There's no DoH (DNS-over-HTTPS) endpoint configured. The architecture diagram mentions DoH but it's not implemented. |
| **Proxy IP Hardcoded** | 🟡 Medium | [`proxy_ip 185.226.119.97`](dns-server/Corefile:13) — The proxy IP is hardcoded in Corefile instead of being dynamic or environment-variable-driven. |
| **No upstream health checks** | 🟡 Medium | [`forward . 8.8.8.8 1.1.1.1 10.202.10.202`](dns-server/Corefile:27) — No health checks or `expire` tuning for upstream DNS servers. If 8.8.8.8 goes down, it's still tried. |
| **Iranian DNS hardcoded** | 🟢 Low | `10.202.10.202` is a specific Iranian DNS that may not always be accessible or could be a point of censorship/failure. |
| **No rate limiting on DNS queries** | 🟡 Medium | No `ratelimit` plugin configured, making the DNS server vulnerable to amplification attacks. |
| **No DNSSEC validation** | 🟢 Low | DNSSEC is not configured, which could allow DNS spoofing attacks. |
| **Cache prefetch may be too aggressive** | 🟢 Low | [`prefetch 5 10m 30%`](dns-server/Corefile:23) — Prefetching 30% of cached items every 10 minutes may cause unnecessary upstream queries. |

#### [`gaming_filter` Go Plugin](dns-server/plugin/gaming_filter/gaming_filter.go)

| Issue | Severity | Description |
|-------|----------|----------|
| **Redis Connection Without Auth** | 🟡 Medium | [`redis.NewClient(&redis.Options{Addr: redisAddr})`](dns-server/plugin/gaming_filter/gaming_filter.go:36-37) — No password, no TLS for Redis connection. In production with Redis exposed, this is a risk. |
| **No Circuit Breaker for Redis** | 🟡 Medium | If Redis goes down, `updateDomains` will keep logging errors and the plugin will retain the last known domain list. There's no fallback or circuit breaker. |
| **No Metrics / Prometheus Integration** | 🟡 Medium | The plugin doesn't expose any metrics (number of intercepted queries, Redis failures, domain list size, etc.) to CoreDNS's Prometheus endpoint. |
| **Memory Leak Risk** | 🟡 Medium | [`gf.gamingDomains = make(map[string]bool)`](dns-server/plugin/gaming_filter/gaming_filter.go:90) — Every refresh creates a new map without properly disposing the old one. While Go's GC handles this, it creates unnecessary allocation pressure. |
| **Subdomain Match Could Be Inefficient** | 🟡 Medium | [`isGamingDomain`](dns-server/plugin/gaming_filter/gaming_filter.go:133-146) iterates over ALL domains for subdomain suffix matching. With thousands of domains, this O(n) lookup per query could become a bottleneck. |
| **AAAA Record Not Handled** | 🟡 Medium | The plugin only returns A records. If a client requests AAAA (IPv6), the plugin falls through to the next plugin which may resolve to an IPv6 address, bypassing the proxy. |
| **ANY / Other Query Types Not Handled** | 🟡 Medium | Only `dns.TypeA` is handled. For `dns.TypeAAAA`, `dns.TypeCNAME`, or `dns.TypeANY`, the plugin passes through without interception. |
| **No Health Check Endpoint** | 🟢 Low | No dedicated health check logic for the plugin itself — relies entirely on CoreDNS's built-in health plugin. |
| **Test Coverage Is Basic** | 🟡 Medium | [`gaming_filter_test.go`](dns-server/plugin/gaming_filter/gaming_filter_test.go) — Only 3 tests. No tests for: Redis failure scenarios, concurrent access, empty domain list, invalid JSON, subdomain matching edge cases. |
| **go.mod Uses Old Go Version** | 🟢 Low | [`go 1.21`](dns-server/go.mod:3) — Go 1.21 is older. Current stable is Go 1.22+. |

#### [`plugin.cfg` & `generate.go`](dns-server/plugin.cfg)

| Issue | Severity | Description |
|-------|----------|----------|
| **No plugin.cfg file found** | 🟠 High | The file is referenced by `generate.go` but doesn't appear in the file listing. Without it, the custom plugin can't be compiled into CoreDNS properly. |
| **generate.go Is a Debug Tool** | 🟢 Low | `generate.go` only validates plugin.cfg format, it doesn't actually generate the plugin configuration. |

#### [`setup.go`](dns-server/plugin/gaming_filter/setup.go)

| Issue | Severity | Description |
|-------|----------|----------|
| **No Validation for proxy_ip** | 🟡 Medium | [`proxyIP = c.Val()`](dns-server/plugin/gaming_filter/setup.go:43) — No validation that the proxy IP is a valid IP address. If misconfigured, DNS will return garbage. |

### 2.2. Optimization Suggestions

1. **Add Domain Trie / Radix Tree** for O(1) subdomain matching instead of O(n) iteration.
2. **Handle AAAA and other record types** — Return the proxy IP for all query types to prevent IPv6 bypass.
3. **Add Redis connection with password and TLS support**.
4. **Add Prometheus counters** — Track intercepted queries, cache size, Redis errors.
5. **Add health check endpoint** in the plugin.
6. **Implement circuit breaker** for Redis — fall back to a local file-based domain list if Redis is down.
7. **Add DNSSEC validation** in Corefile.
8. **Add rate limiting** in Corefile.
9. **Create `plugin.cfg` file** for proper build integration.
10. **Add extensive unit tests** for edge cases (empty domains, Redis failures, concurrency).
11. **Move proxy IP** to environment variable with code default, not hardcoded in Corefile.
12. **Upgrade go.mod** to Go 1.22+.

---

## 3. Proxy Server (HAProxy)

### 3.1. Weaknesses & Gaps

#### [`haproxy.cfg`](proxy-server/haproxy.cfg)

| Issue | Severity | Description |
|-------|----------|----------|
| **No TLS on Port 443 Frontend** | 🟠 High | The main TCP frontend [`bind *:443`](proxy-server/haproxy.cfg:26) has NO SSL configuration. It's pure TCP passthrough. Combined with the DoH frontend which uses SSL, this means the main gaming traffic is NOT encrypted between the client and HAProxy. |
| **DoH Backend Points to CoreDNS Port 53** | 🟡 Medium | [`server dns1 coredns:53 check inter 5s fall 3 rise 2`](proxy-server/haproxy.cfg:145) — CoreDNS on port 53 serves plain DNS, not DoH. The DoH frontend on port 8053 with SSL terminates TLS but then forwards plain HTTP to CoreDNS on port 53 (DNS-over-TCP, not DoH). This is a protocol mismatch. |
| **HAProxy Auth Stats Password** | 🟠 High | [`stats auth admin:password123`](proxy-server/haproxy.cfg:167) — Weak hardcoded credentials. |
| **No access control on stats** | 🟠 High | Stats page has no IP restriction — accessible from anywhere if port 8404 is exposed. |
| **No backend for non-DNS, non-gaming traffic** | 🟡 Medium | The `backend_germany_http_as_https` sends ALL non-DNS traffic to Germany unconditionally, even traffic that isn't gaming-related. |
| **Redis not connected to HAProxy** | 🟢 Low | HAProxy has no stick-table peer synchronization across instances (not critical for single-instance). |
| **Timeout client is 1 hour** | 🟡 Medium | [`timeout client 1h`](proxy-server/haproxy.cfg:31) — Very long timeout. While this may be needed for gaming sessions, it risks resource exhaustion with many concurrent connections. |
| **No health check on Germany backend in TCP mode** | 🟡 Medium | The TCP backend [`backend_germany_sni`](proxy-server/haproxy.cfg:35-40) checks the server, but TCP mode health checks are limited compared to HTTP checks. |

### 3.2. Optimization Suggestions

1. **Add proper TLS termination** or at least document that it's TCP passthrough.
2. **Fix DoH backend** to properly proxy HTTPS → CoreDNS DoH endpoint (port 443 or 8053 with actual HTTP → DNS).
3. **Restrict HAProxy stats** to localhost or internal network only.
4. **Use environment variables** for sensitive values via Docker secrets or mounted files.
5. **Add SNI-based ACLs** for specific gaming services (Xbox, PlayStation, Steam, etc.) with dedicated backends for better routing granularity.
6. **Reduce default timeouts** and add connection limits per client IP.
7. **Add proper logging** with log-format including SNI information for debugging.

---

## 4. Panel Frontend (React/Vite)

### 4.1. Weaknesses & Gaps

#### Overall Structure

| Issue | Severity | Description |
|-------|----------|----------|
| **Zustand Store Has Mock Data** | 🟡 Medium | [`useDnsStore`](panel-frontend/src/store/dnsStore.ts) initializes with empty data, but the UI components use hardcoded mock values in several places, making it unclear what's real and what's placeholder. |
| **Dashboard Uses Only Mock Data** | 🟠 High | [`Dashboard.tsx`](panel-frontend/src/pages/Dashboard.tsx) — Stats like "12,847 total queries", "156 DNS records" are hardcoded mock data, not fetched from the API. The only real data is the gaming domains list. |
| **Analytics Page Is Pure Placeholder** | 🟠 High | [`Analytics.tsx`](panel-frontend/src/pages/Analytics.tsx) — Contains "Chart placeholder" and hardcoded "87% cache hit ratio". No real charts or data fetching. |
| **react-query Version** | 🟡 Medium | `react-query: ^3.39.3` is an old v3 version. Current is TanStack Query v5 with breaking changes and better features. |
| **No Error Boundaries** | 🟡 Medium | No React error boundaries to gracefully handle crashes in any page component. |
| **No Loading States** | 🟡 Medium | No skeleton loaders or proper loading indicators for data fetching. |
| **No Pagination** | 🟡 Medium | DNS records and gaming domains lists have no pagination. With potentially hundreds/thousands of domains, this will cause performance issues. |
| **No Search/Filter** | 🟡 Medium | No search or filter functionality for DNS records or gaming domains. |
| **Direct localStorage Access** | 🟡 Medium | [`localStorage.getItem('auth_token')`](panel-frontend/src/App.tsx:13) used directly in `ProtectedRoute` and [`api.ts`](panel-frontend/src/services/api.ts:11). The auth store should be the single source of truth. |
| **Token in localStorage** | 🟠 High | JWT token stored in `localStorage` makes it vulnerable to XSS attacks. `httpOnly` cookies are used by the backend but the frontend still reads from localStorage for the `Authorization` header. This is redundant and less secure. |
| **Auth Check on Every App Load** | 🟡 Medium | [`authStore.tsx`](panel-frontend/src/store/authStore.tsx:26-38) calls `/api/auth/me` on every app load. Could be optimized using token expiry check locally first. |
| **No Service Worker for PWA** | 🟡 Medium | While Vite PWA plugin is configured, there's no service worker logic for offline support. The PWA behaves like a regular web app. |
| **Missing TypeScript Strictness** | 🟢 Low | No strict TypeScript configuration evident — some `any` types used. |
| **No .env File Pattern** | 🟢 Low | No `.env` file or build-time environment variable configuration pattern for the frontend. |

#### [`App.tsx`](panel-frontend/src/App.tsx)

| Issue | Severity | Description |
|-------|----------|----------|
| **Hardcoded Admin Credential** | 🟢 Low | The placeholder text in Login.tsx uses actual credential-like values like "admin" and "password" as placeholders which could be confusing. |

### 4.2. Optimization Suggestions

1. **Replace mock data with real API calls** — Connect Dashboard stats and Analytics page to real backend endpoints.
2. **Implement proper analytics/charts** using recharts (already installed) with real data from CoreDNS prometheus metrics via the API.
3. **Upgrade react-query to TanStack Query v5**.
4. **Add pagination, search, and filtering** for DNS records and gaming domains.
5. **Use httpOnly cookies properly** — Remove localStorage token storage; rely on the cookie set by the backend. If needed for API calls, read from cookie not localStorage.
6. **Add error boundaries** and proper loading skeletons.
7. **Add service worker with caching strategy** for true PWA offline support.
8. **Add search/filter UI** for gaming domains and DNS records.
9. **Add proper environment variable handling** using Vite's `import.meta.env`.
10. **Fix the ProtectedRoute component** to use the auth store's token check, not direct localStorage access.

---

## 5. Telegram Bot (Node.js/Telegraf)

### 5.1. Weaknesses & Gaps

#### [`index.ts`](telegram-bot/src/index.ts)

| Issue | Severity | Description |
|-------|----------|----------|
| **Dynamic Redis Import** | 🟡 Medium | [`const { createClient } = await import('redis')`](telegram-bot/src/index.ts:136) — Dynamic import used presumably to avoid TypeScript compilation issues. This is fragile and the comment about `redis v2` suggests version compatibility uncertainty. |
| **Two Separate Redis Connections** | 🟡 Medium | The bot creates two separate Redis subscriber connections — one for bot token changes and one for notifications. These could be shared or use a single subscription with pattern matching. |
| **No Graceful Shutdown for Redis** | 🟡 Medium | No cleanup of Redis subscriptions on process exit. The `SIGINT`/`SIGTERM` handlers only stop the bot, not the Redis connections. |
| **Health Server Not Gracefully Shut Down** | 🟡 Medium | The HTTP health server has no close/shutdown handler on process exit. |
| **Type Assertion Bypasses TypeScript** | 🟡 Medium | [`const subscriber: any = createClient(...)`](telegram-bot/src/index.ts:138) and similar uses of `any` defeat TypeScript's type checking |
| **No Input Validation** | 🟡 Medium | No validation that `payload.telegramId` is a valid chat ID before calling `bot.telegram.sendMessage`. |
| **Payment Channel Notifications Limited** | 🟢 Low | The notification subscription covers `payment_success`, `ip_registered`, and `expiry_reminder` but no handling for `payment_failed` or `payment_pending`. |

#### [`commands/start.ts`](telegram-bot/src/commands/start.ts)

| Issue | Severity | Description |
|-------|----------|----------|
| **Massive File Size** | 🟡 Medium | At 524+ lines, this file handles too many responsibilities: start, help, keyboard handlers, subscription flow, payment flow, IP registration. |
| **No Rate Limiting on Input** | 🟡 Medium | User text input for IP registration has no rate limiting — a user could spam IP address submissions. |

#### [`commands/admin.ts`](telegram-bot/src/commands/admin.ts)

| Issue | Severity | Description |
|-------|----------|----------|
| **Admin Check Is Basic** | 🟡 Medium | Admin check is just a list of numeric IDs from env. No role-based permissions or database-backed admin verification. |
| **No Admin Logging** | 🟢 Low | Admin actions (sync, reload) are not logged for audit purposes. |

#### [`services/api.ts`](telegram-bot/src/services/api.ts)

| Issue | Severity | Description |
|-------|----------|----------|
| **Secret Hardcoded** | 🟠 High | [`HMAC_SECRET` fallback hardcoded](telegram-bot/src/services/api.ts:120) — Same fallback secret in bot and backend, defeats the purpose of having a secret. |
| **Portal URL Hardcoded** | 🟡 Medium | [`PORTAL_PUBLIC_URL` fallback hardcoded](telegram-bot/src/services/api.ts:122) to `https://dns.rhynoai.ir`. |
| **TypeScript Any Types** | 🟡 Medium | Several `as any` type assertions throughout the bot code. |

#### Telegram Bot General Issues

| Issue | Severity | Description |
|-------|----------|----------|
| **session-redux package** | 🟡 Medium | Using `telegraf-session-redis` which is a community package with uncertain maintenance. Telegraf v4 has built-in session support with various stores. |
| **No Error Rate Monitoring** | 🟡 Medium | No monitoring or alerting for bot failures, message delivery failures, or API errors. |
| **No Keyboard State Management** | 🟢 Low | Persistent keyboard state isn't managed — after certain actions the keyboard may not be shown again until the user sends `/start`. |

### 5.2. Optimization Suggestions

1. **Refactor start.ts** into smaller, focused files per feature (subscription, payment, IP registration, guide).
2. **Use a single Redis connection** with multiple subscriptions via pub/sub pattern matching.
3. **Add proper cleanup** for Redis connections and HTTP server on shutdown.
4. **Replace `any` types** with proper TypeScript interfaces.
5. **Add HMAC secret validation** — Ensure the secret is provided via environment variable, not hardcoded.
6. **Add input validation and rate limiting** for user text input.
7. **Add admin action logging** to the database.
8. **Upgrade to Telegraf v4 session** instead of third-party `telegraf-session-redis`.
9. **Add payment_failed notification** handling.

---

## 6. Infrastructure & Scripts

### 6.1. Weaknesses & Gaps

#### [`nftables/dns-filter.nft`](infra/nftables/dns-filter.nft)

| Issue | Severity | Description |
|-------|----------|----------|
| **No Dynamic IP Set for Authorized Users** | 🟠 High | The architecture mentions a dynamic `allowed_ips` set for nftables but the current config has NO such set. ALL IPs can access port 53 (TCP/UDP), not just subscribed users. |
| **Interface Names Hardcoded** | 🟡 Medium | [`iif docker0 oif eth0`](infra/nftables/dns-filter.nft:44) — `docker0` and `eth0` are hardcoded. Different servers may use different interface names (`ensX`, `enpXsY`). |
| **No IPv6 Rules** | 🟡 Medium | Only IPv4 (inet family) rules. No IPv6 firewall configuration. |
| **Gaming Traffic Optimization May Be Misconfigured** | 🟢 Low | The `gaming` table marks packets with DSCP CS4 (`0x20`), but this requires the network infrastructure to actually honor DSCP markings (most cloud providers strip them). |

#### [`scripts/doctor.sh`](scripts/doctor.sh)

| Issue | Severity | Description |
|-------|----------|----------|
| **No Check for Docker Services** | 🟡 Medium | The script doesn't check if Docker containers (CoreDNS, HAProxy, backend API, etc.) are running. |
| **No Check for Redis Connectivity** | 🟡 Medium | No check for Redis being reachable and responsive. |
| **No Check for Database Connectivity** | 🟡 Medium | No check for SQL Server being reachable. |
| **No Check for Certificate Expiry** | 🟡 Medium | SSL/TLS certificate expiry is not checked. |
| **No JSON Output** | 🟢 Low | Only colored human-readable output. No machine-parseable JSON output for integration with monitoring systems. |
| **No Automatic Remediation** | 🟢 Low | Only identifies problems, doesn't attempt to fix them. |

#### [`scripts/setup-germany.sh`](scripts/setup-germany.sh) & [`scripts/setup-iran.sh`](scripts/setup-iran.sh)

| Issue | Severity | Description |
|-------|----------|----------|
| **Not Reviewed** | 🟠 High | These scripts weren't fully examined but from the README they appear to use pre-generated hardcoded WireGuard keypairs. This is a significant security concern for production. |

#### WireGuard Scripts (`infra/scripts/wireguard/`)

| Issue | Severity | Description |
|-------|----------|----------|
| **Pre-generated Static Keys** | 🔴 Critical | README explicitly states "Zero key exchange needed — the scripts use a pre-generated static keypair." This means EVERY deployment uses the same keys — a massive security risk. |
| **No Key Rotation** | 🟡 Medium | No mechanism for periodic key rotation. |

#### `systemd/` Service Files

| Issue | Severity | Description |
|-------|----------|----------|
| **Not Reviewed** | 🟡 Medium | Service files weren't examined but likely have standard configurations that could be optimized for reliability (Restart=always, proper dependencies, etc.). |

### 6.2. Optimization Suggestions

1. **Implement dynamic nftables set** for `allowed_ips` populated by the backend API when users register IPs.
2. **Use interface name detection** instead of hardcoding `docker0`/`eth0`.
3. **Add IPv6 rules** to nftables.
4. **Enhance doctor.sh** with Docker container checks, Redis ping, SQL Server connectivity, certificate expiry, and JSON output option.
5. **Generate unique WireGuard keys per deployment** — Remove pre-generated keys from scripts.
6. **Add key rotation capability** to WireGuard setup.
7. **Document firewall requirements** clearly for cloud providers.

---

## 7. Docker & Deployment

### 7.1. Weaknesses & Gaps

#### [`docker-compose.yml`](docker-compose.yml)

| Issue | Severity | Description |
|-------|----------|----------|
| **Production Password in Dev Compose** | 🔴 Critical | [`SA_PASSWORD: "YourStrong!Passw0rd"`](docker-compose.yml:142) — Production-weak password exposed in docker-compose. Also hardcoded in connection strings. |
| **No `.env` File Integration** | 🟠 High | Only `BOT_TOKEN` and `ADMIN_IDS` use `${VAR:-default}` syntax. The DB password, Redis config, and other settings use hardcoded values with no environment variable override. |
| **SQL Server Developer Edition** | 🟡 Medium | [`MSSQL_PID: Developer`](docker-compose.yml:143) — Developer edition has limitations (10GB database size, no production license). |
| **No Volume for CoreDNS Config** | 🟡 Medium | CoreDNS config is mounted read-only (`:ro`), but there's no persistent volume for CoreDNS data or metrics. |
| **CoreDNS Exposes Prometheus Without Protection** | 🟢 Low | Port 9153 is exposed to the host without authentication. |
| **No Container Resource Limits** | 🟡 Medium | No memory/CPU limits for most containers (except in `docker-compose.prod.yml`). |
| **Telegram Bot Health Endpoint Exposed** | 🟢 Low | Bot exposes health check on port 5000 but this is mapped to the host. |
| **No Logging Driver Configuration** | 🟡 Medium | No Docker logging driver configured (json-file default, no log rotation or size limits). |

#### [`docker-compose.prod.yml`](docker-compose.prod.yml)

| Issue | Severity | Description |
|-------|----------|----------|
| **Incomplete Production Config** | 🔴 Critical | This file is significantly incomplete — missing SQL Server, Backend API, Panel Frontend, and Telegram Bot services. Only CoreDNS, HAProxy, and Redis are defined. It cannot be used for actual production deployment. |
| **Missing Secret Management** | 🟠 High | No Docker secrets or environment variable management for production. |
| **CoreDNS Uses `latest` Tag** | 🟠 High | [`image: coredns/coredns:latest`](docker-compose.prod.yml:7) — Using `latest` tag is dangerous for production. Should pin specific version. |
| **HAProxy Uses `2.8-alpine` Tag** | 🟡 Medium | Should pin to specific patch version like `2.8.4-alpine`. |
| **No Health Checks** | 🟡 Medium | No Docker health checks configured for any production services. |
| **No Network Configuration** | 🟡 Medium | No custom network defined; services will use the default bridge network. |

#### General Docker Issues

| Issue | Severity | Description |
|-------|----------|----------|
| **No `.dockerignore` for backend-api** | 🟡 Medium | No `.dockerignore` file for the backend-api to prevent sending unnecessary files to the Docker build context. |
| **No Multi-stage Builds Optimized** | 🟡 Medium | Dockerfiles need review for build cache optimization. |
| **No Image Tagging Strategy** | 🟡 Medium | No semantic versioning or git-based image tagging strategy. |

### 7.2. Optimization Suggestions

1. **Externalize ALL configuration** through environment variables and a proper `.env` file — no hardcoded passwords or secrets.
2. **Complete the production docker-compose** with all services.
3. **Use Docker secrets** for sensitive data (DB password, JWT secret, API keys).
4. **Pin specific versions** for all Docker images, never `latest`.
5. **Add resource limits** to all containers.
6. **Configure Docker logging driver** with rotation (e.g., `local` or `json-file` with max-size).
7. **Add health checks** to all services.
8. **Add `.dockerignore`** for backend-api.
9. **Implement multi-stage builds** with proper caching.
10. **Add image tagging strategy** — use `${GIT_COMMIT_SHA}` or semantic versioning.

---

## 8. امنیت (Security)

### Summary of Critical Security Issues

| # | Issue | Location | Severity |
|---|-------|----------|----------|
| 1 | **Hardcoded DB password** | `appsettings.json`, `docker-compose.yml` | 🔴 Critical |
| 2 | **Hardcoded JWT secret fallback** | `Program.cs` | 🔴 Critical |
| 3 | **Hardcoded ZarinPal merchant ID** | `ZarinPalPaymentService.cs` | 🔴 Critical |
| 4 | **CORS AllowAll in production** | `Program.cs` | 🔴 Critical |
| 5 | **Pre-generated WireGuard keys** | `scripts/` | 🔴 Critical |
| 6 | **HAProxy stats weak password** | `haproxy.cfg` | 🔴 Critical |
| 7 | **Public endpoints without auth** | Multiple controllers | 🟠 High |
| 8 | **Token in localStorage** | Frontend | 🟠 High |
| 9 | **HMAC secret hardcoded** | Bot + Backend | 🟠 High |
| 10 | **Default admin password in code** | `AppDbContextSeed.cs` | 🔴 Critical |

### Key Security Improvements

1. **Use a secrets manager** (Vault, Azure Key Vault, or Docker secrets) for ALL secrets.
2. **Implement proper RBAC** — Different roles for admin, support, and read-only users.
3. **Add rate limiting** at the API gateway (HAProxy) AND application level.
4. **Add audit logging** — Log all admin actions, payment events, and configuration changes.
5. **Implement HTTPS everywhere** — Even for internal services, use TLS where possible.
6. **Add Content Security Policy** (CSP) headers to the frontend.
7. **Use httpOnly cookies only** — Remove localStorage token usage.
8. **Add SQL injection prevention** — Currently using EF Core which parameterizes queries, but should verify all raw SQL paths.
9. **Add security headers middleware** — X-Frame-Options, X-Content-Type-Options, etc.
10. **Implement proper key rotation** for JWT signing keys and WireGuard keys.

---

## 9. مانیتورینگ و Observability

### Current State & Gaps

| Aspect | Current State | Gap |
|--------|--------------|-----|
| **Metrics** | Only CoreDNS Prometheus on port 9153 | No metrics from backend API, HAProxy, Telegram bot, or infrastructure |
| **Logging** | Basic console logging | No centralized log aggregation, no structured logging, no log retention policy |
| **Tracing** | Not implemented | No distributed tracing (OpenTelemetry, Jaeger) |
| **Alerting** | Hardcoded in doctor.sh | No automated alerting (Telegram alert for critical failures, PagerDuty, etc.) |
| **Health Checks** | Only a single `/health` endpoint | No detailed component health (DB connectivity, Redis, external services) |
| **Uptime Monitoring** | doctor.sh manual | No automated external uptime monitoring for the DNS service |
| **Dashboard** | Analytics page is placeholder | No real-time operational dashboard |

### Optimization Suggestions

1. **Add Prometheus metrics to backend API** (request count, latency, error rate, active subscriptions).
2. **Add Prometheus metrics to HAProxy** (already has stats endpoint, expose via Prometheus exporter).
3. **Add Prometheus metrics to Telegram bot** (message count, error rate, latency).
4. **Deploy Prometheus + Grafana stack** for metrics visualization.
5. **Add structured logging** (Serilog → Seq/Elasticsearch) to backend API.
6. **Add centralized log aggregation** — Docker logging driver → Loki or Elasticsearch.
7. **Set up automated alerts** — Telegram bot alerts when services go down, certificate expires, etc.
8. **Add distributed tracing** with OpenTelemetry.
9. **Enhance health checks** — Per-component health (API, DB, Redis, CoreDNS reachability).
10. **Add synthetic monitoring** — External service that periodically queries the DNS service and reports availability.

---

## 10. خلاصه و اولویت‌بندی

### فوری (حالا باید درست شود) — Security Criticals

1. **Externalize all secrets** — DB password, JWT secret, ZarinPal merchant ID, HMAC secret
2. **Generate unique WireGuard keys per deployment** — Remove pre-generated keys
3. **Fix CORS policy** — Restrict in production
4. **Secure unauthenticated API endpoints** — Add authorization to Payment, Subscription, Ip controllers
5. **Remove hardcoded credentials** — HAProxy stats, default admin password, etc.

### کوتاه‌مدت (هفته آینده)

6. **Complete production docker-compose.yml** with all services and proper configuration
7. **Add rate limiting** at API level (middleware) and DNS level
8. **Implement proper monitoring** — Prometheus + Grafana for metrics
9. **Fix CoreDNS plugin** — Handle AAAA/ANY, use trie for domain matching, add metrics
10. **Implement dynamic nftables** for allowed IPs
11. **Replace mock data in frontend** with real API data, implement charts
12. **Refactor Telegram bot** — Split start.ts, fix Redis connections, proper types

### میان‌مدت (ماه آینده)

13. **Implement CQRS/MediatR** pattern in backend API
14. **Add API versioning**
15. **Add proper PWA support** with service worker
16. **Implement pagination and search** in frontend
17. **Add structured logging** with Serilog
18. **Add distributed tracing**
19. **Implement automated key rotation** for JWT and WireGuard
20. **Add CI/CD pipeline** for automated testing and deployment

### بلندمدت (آینده)

21. **Migrate to PostgreSQL** for better performance and open-source compliance (optional)
22. **Add horizontal scaling** for CoreDNS and backend API
23. **Implement DNS-over-HTTPS (DoH) and DNS-over-TLS (DoT)** endpoints
24. **Add Windows client** for automatic IP registration
25. **Implement automated domain discovery** background service (mentioned in blueprint but not implemented)
26. **Add comprehensive test coverage** across all components
27. **Create proper documentation** with architecture diagrams and deployment guides
28. **Implement disaster recovery** and backup strategy

---

> **توجه:** این تحلیل بر اساس کد موجود در تاریخ ۲۰ سپتامبر ۲۰۲۶ انجام شده است. برخی از فایل‌ها ممکن است در نسخه‌های بعدی تغییر کرده باشند.