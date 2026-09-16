# proxy-server

HAProxy configuration for TCP/HTTP load balancing across backend services.

## Structure

- `haproxy.cfg` - Main HAProxy configuration
- `Dockerfile` - HAProxy container build

## Services Proxied

- `backend-api` → ASP.NET Core Web API (port 8080)
- `panel-frontend` → React SPA (port 3000)
- `telegram-bot` → Bot webhook (port 5000)