# Gaming DNS Infrastructure

![Architecture](docs/architecture.png)

A complete mono-repo for managing gaming-optimized DNS resolution with a management panel, API, and Telegram bot.

## Project Structure

```
├── dns-server/        # CoreDNS + custom Go plugin
├── proxy-server/      # HAProxy TCP/HTTP load balancer
├── backend-api/       # ASP.NET Core Web API (Clean Architecture)
├── panel-frontend/    # React + Vite PWA dashboard
├── telegram-bot/      # Node.js Telegram bot (Telegraf)
└── infra/             # nftables, systemd, Docker configs
```

## Quick Start (Local Dev)

```bash
# Copy environment config
cp .env.example .env

# Start all services
docker compose up -d

# Check status
docker compose ps
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| CoreDNS | 53 | DNS server with gaming filter plugin |
| HAProxy | 80,443 | Load balancer / API gateway |
| Backend API | 8080 | ASP.NET Core Web API |
| Panel Frontend | 3000 | React PWA dashboard |
| Telegram Bot | 5000 | Bot health endpoint |
| Redis | 6379 | Cache & session store |
| SQL Server | 1433 | Primary database |

---

## 🚀 One-Line Quick Deployment

### Prerequisites

- A **Germany VPS** (Exit Node) — fresh Ubuntu 22.04/24.04 with root access.
- An **Iran VPS** (Edge Node) — fresh Ubuntu 22.04/24.04 with root access.
- Both servers must be able to reach each other over the internet.
- No manual key exchange needed — a pre-generated keypair is embedded in the scripts.

### Server 1 — Germany (Exit Node)

Run this on the **Germany VPS** as root:

```bash
curl -sSL https://raw.githubusercontent.com/your-org/your-repo/main/scripts/setup-germany.sh | bash
```

**Override keys via environment variables (optional):**
```bash
curl -sSL .../setup-germany.sh | WG_IRAN_PUBKEY="<custom>" WG_GER_PRIVKEY="<custom>" bash
```

This script will:
- Install `wireguard`, `sniproxy`, `iptables`, `curl`.
- Configure `sniproxy` to listen on port `443` with TLS, using `1.1.1.1` / `8.8.8.8` resolvers.
- Clean up any zombie `sniproxy` processes before starting the service.
- Enable IPv4 forwarding (persistent via `sysctl.conf`).
- Use the embedded Germany keypair (overridable via `WG_GER_PRIVKEY`) and Iran peer key (overridable via `WG_IRAN_PUBKEY`).
- Dynamically detect the default network interface for iptables MASQUERADE.
- Start and enable `wg-quick@wg0` and `sniproxy`.
- Run a self-check: confirms `wg0` is UP and port 443 is listening.

> [!IMPORTANT]
> **Zero key exchange needed** — the scripts use a pre-generated static keypair.
> If you need custom keys for production, set `WG_IRAN_PUBKEY` and `WG_GER_PRIVKEY` env vars.

---

### Server 2 — Iran (Edge Node / CoreDNS & HAProxy)

Run this on the **Iran VPS** as root, passing the Germany VPS public IP:

```bash
GERMANY_IP="x.x.x.x" curl -sSL https://raw.githubusercontent.com/your-org/your-repo/main/scripts/setup-iran.sh | bash
```

**Example:**
```bash
GERMANY_IP=1.2.3.4 curl -sSL https://raw.githubusercontent.com/your-org/your-repo/main/scripts/setup-iran.sh | bash
```

**Override keys via environment variables (optional):**
```bash
GERMANY_IP=1.2.3.4 WG_IRAN_PRIVKEY="<custom>" WG_GER_PUBKEY="<custom>" curl -sSL .../setup-iran.sh | bash
```

This script will:
- Validate the provided `GERMANY_IP` (must be a valid IPv4 address).
- Install `wireguard`, `curl`, `git`, `docker`, `docker-compose-plugin`.
- Use the embedded Iran keypair (overridable via `WG_IRAN_PRIVKEY`) and Germany peer key (overridable via `WG_GER_PUBKEY`).
- Configure WireGuard client to connect to `${GERMANY_IP}:51820` with `AllowedIPs = 10.10.0.1/32` and `PersistentKeepalive = 25`.
- Start and enable `wg-quick@wg0`, then verify tunnel ping to `10.10.0.1`.
- Clone (or pull) the repository and run `docker compose up -d`.
- Automatically run the full diagnostic suite ([`scripts/doctor.sh`](scripts/doctor.sh)).

---

### Post-Deployment Diagnostics

Run the diagnostic tool anytime from the Iran server:

```bash
./scripts/doctor.sh
```

This performs 5 health checks with colored output:
1. **Interface** — confirms `wg0` exists
2. **Handshake** — alerts if handshake is older than 180s (firewall hint)
3. **Tunnel Ping** — tests reachability of `10.10.0.1`
4. **SNI Proxy** — checks port 443 is open inside the tunnel
5. **End-to-End TLS** — validates HTTPS via HAProxy/CoreDNS

---

### Verification Steps

```bash
# Ping the Germany tunnel IP
ping -c 4 10.10.0.1

# Test DNS resolution through CoreDNS
curl -k https://10.10.0.1:443/dns-query?name=google.com

# Check WireGuard status on both servers
wg show
```

Expected output for `ping 10.10.0.1`:
```
64 bytes from 10.10.0.1: icmp_seq=1 ttl=64 time=XX ms
```

---

## Deployment

See [Deployment Guide](docs/deployment.md) for production setup.

## Architecture

The DNS flow:

```
Client → HAProxy:53 (DoH) → CoreDNS → Gaming Filter Plugin → Redis lookup → Forward/Resolve
```

Management flow:

```
Telegram Bot / Panel → Backend API → SQL Server + Redis sync → CoreDNS hot-reload