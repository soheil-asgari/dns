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