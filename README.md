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

## 🚀 One-Line Quick Deployment

### Prerequisites

- A **Germany VPS** (Exit Node) — fresh Ubuntu 22.04/24.04 with root access.
- An **Iran VPS** (Edge Node) — fresh Ubuntu 22.04/24.04 with root access.
- Both servers must be able to reach each other over the internet.

### Server 1 — Germany (Exit Node)

Run this on the **Germany VPS** as root:

```bash
curl -sSL https://raw.githubusercontent.com/your-org/your-repo/main/scripts/setup-germany.sh | bash
```

This script will:
- Install `wireguard`, `sniproxy`, `iptables`, `curl`.
- Configure `sniproxy` to listen on port `443` with TLS, using `1.1.1.1` / `8.8.8.8` resolvers.
- Enable IPv4 forwarding (persistent via `sysctl.conf`).
- Generate a WireGuard keypair and configure the server (`10.10.0.1/24`, port `51820`).
- Dynamically detect the default network interface for iptables MASQUERADE.
- Start and enable `wg-quick@wg0` and `sniproxy`.

> [!IMPORTANT]
> After the script completes, **copy the displayed server public key**. You will need it for the Iran server.

---

### Server 2 — Iran (Edge Node / CoreDNS & HAProxy)

Run this on the **Iran VPS** as root, passing the Germany VPS public IP:

```bash
curl -sSL https://raw.githubusercontent.com/your-org/your-repo/main/scripts/setup-iran.sh | GERMANY_IP=<GERMANY_VPS_PUBLIC_IP> bash
```

**Example:**
```bash
curl -sSL https://raw.githubusercontent.com/your-org/your-repo/main/scripts/setup-iran.sh | GERMANY_IP=1.2.3.4 bash
```

This script will:
- Validate the provided `GERMANY_IP` (must be a valid IPv4 address).
- Install `wireguard`, `curl`, `git`, `docker`, `docker-compose-plugin`.
- Generate a WireGuard client keypair and configure `10.10.0.2/24`.
- Connect to the Germany server endpoint `${GERMANY_IP}:51820` with `PersistentKeepalive = 25`.
- Start and enable `wg-quick@wg0`, then verify tunnel ping to `10.10.0.1`.
- Clone (or pull) the repository and run `docker compose up -d`.

> [!IMPORTANT]
> After both scripts complete, **exchange public keys**:
> 1. On the Germany server, edit `/etc/wireguard/wg0.conf` and set `[Peer] PublicKey` to the Iran client's public key.
> 2. On the Iran server, edit `/etc/wireguard/wg0.conf` and set `[Peer] PublicKey` to the Germany server's public key.
> 3. Restart WireGuard on both: `systemctl restart wg-quick@wg0`

---

### Verification Steps

After key exchange and restart, verify the tunnel from the Iran server:

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