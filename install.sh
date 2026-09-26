#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

# Ensure script is run as root
if [ "$EUID" -ne 0 ]; then
  echo "[-] Error: This script must be run as root."
  exit 1
fi

echo "===================================================="
echo "    Anti-Censorship & Gaming Acceleration Stack     "
echo "        Automated Deployment & Routing Setup        "
echo "===================================================="

# 1. Gather User Inputs
read -p "[?] Enter your Primary Public IP address: " PRIMARY_IP
if [ -z "$PRIMARY_IP" ]; then
  echo "[-] Primary IP cannot be empty."
  exit 1
fi

read -p "[?] Does the server have a Second Public IP? (y/N): " HAS_SECOND_IP
SECONDARY_IP=""
if [[ "$HAS_SECOND_IP" =~ ^[Yy]$ ]]; then
  read -p "[?] Enter your Second Public IP address: " SECONDARY_IP
fi

# Default WireGuard peer IP
WG_PEER_IP="10.10.0.1"
read -p "[?] Enter WireGuard Peer IP [Default: $WG_PEER_IP]: " INPUT_WG_IP
WG_PEER_IP="${INPUT_WG_IP:-$WG_PEER_IP}"

# Detect primary network interface
DEFAULT_IFACE=$(ip -4 route show default | awk '{print $5}' | head -n1)
read -p "[?] Enter primary network interface [Detected: $DEFAULT_IFACE]: " INPUT_IFACE
PRIMARY_IFACE="${INPUT_IFACE:-$DEFAULT_IFACE}"

echo "[+] Configuration accepted:"
echo "    - Primary IP: $PRIMARY_IP (Interface: $PRIMARY_IFACE)"
if [ -n "$SECONDARY_IP" ]; then
  echo "    - Secondary IP: $SECONDARY_IP"
fi
echo "    - WireGuard Peer: $WG_PEER_IP"

# 2. Install Prerequisites
echo "[+] Updating system and installing dependencies (docker, iptables, iproute2)..."
apt-get update -y
apt-get install -y curl ufw iptables iproute2 docker.io docker-compose-v2 git

# 3. Setup Directory Structure
INSTALL_DIR="/root/dns"
mkdir -p "$INSTALL_DIR/dns-server"
mkdir -p "$INSTALL_DIR/proxy-server"
cd "$INSTALL_DIR"

# 4. Configure Policy Routing & Mangles
echo "[+] Configuring advanced policy routing and iptables mangle rules..."

# Add custom route tables if not present
if ! grep -q "rt_primary" /etc/iproute2/rt_tables; then
  echo "200 rt_primary" >> /etc/iproute2/rt_tables
fi
if [ -n "$SECONDARY_IP" ]; then
  if ! grep -q "rt_secondary" /etc/iproute2/rt_tables; then
    echo "201 rt_secondary" >> /etc/iproute2/rt_tables
  fi
fi

# Get default gateway
DEFAULT_GW=$(ip -4 route show default | awk '{print $3}' | head -n1)

# Configure routing tables and rules
ip route flush table rt_primary || true
ip route add default via "$DEFAULT_GW" dev "$PRIMARY_IFACE" table rt_primary
ip rule add from "$PRIMARY_IP" table rt_primary 32765 || true
ip rule add fwmark 0x3e table rt_primary 32766 || true

if [ -n "$SECONDARY_IP" ]; then
  ip route flush table rt_secondary || true
  ip route add default via "$DEFAULT_GW" dev "$PRIMARY_IFACE" table rt_secondary
  ip rule add from "$SECONDARY_IP" table rt_secondary 32764 || true
  ip rule add fwmark 0x61 table rt_secondary 32763 || true
fi

# Configure iptables mangle rules for symmetric bidirectional routing (Ports 53, 80, 443)
iptables -t mangle -F PREROUTING || true
iptables -t mangle -A PREROUTING -p udp --dport 53 -j CONNMARK --set-xmark 0x3e/0xffffffff
iptables -t mangle -A PREROUTING -p tcp --dport 53 -j CONNMARK --set-xmark 0x3e/0xffffffff
iptables -t mangle -A PREROUTING -p tcp --dport 80 -j CONNMARK --set-xmark 0x3e/0xffffffff
iptables -t mangle -A PREROUTING -p tcp --dport 443 -j CONNMARK --set-xmark 0x3e/0xffffffff

if [ -n "$SECONDARY_IP" ]; then
  iptables -t mangle -A PREROUTING -i "$PRIMARY_IFACE" -p udp --dport 53 -j CONNMARK --set-xmark 0x61/0xffffffff
  iptables -t mangle -A PREROUTING -i "$PRIMARY_IFACE" -p tcp --dport 53 -j CONNMARK --set-xmark 0x61/0xffffffff
fi

iptables -t mangle -A PREROUTING -s 172.16.0.0/12 -m connmark --mark 0x3e -j CONNMARK --restore-mark
iptables -t mangle -A FORWARD -p tcp -m tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu

# 5. Create CoreDNS Configuration
echo "[+] Writing CoreDNS configuration..."
cat << 'EOF' > "$INSTALL_DIR/dns-server/Corefile"
.:53 {
    health
    prometheus :9153
    errors

    gaming_filter {
        redis_addr redis:6379
        refresh_interval 5s
        proxy_ip PRIMARY_IP_PLACEHOLDER
    }

    cache 3600 {
        success 3600
        denial 60
        prefetch 10 2m 10%
    }

    forward . 8.8.8.8 1.1.1.1 9.9.9.9 {
        policy round_robin
        max_concurrent 4000
        expire 10s
    }
}

.:8053 {
    whoami
}
EOF
sed -i "s/PRIMARY_IP_PLACEHOLDER/$PRIMARY_IP/g" "$INSTALL_DIR/dns-server/Corefile"

# 6. Create HAProxy Configuration
echo "[+] Writing HAProxy configuration..."
cat << 'EOF' > "$INSTALL_DIR/proxy-server/haproxy.cfg"
global
    log /dev/log local0
    log /dev/log local1 notice
    maxconn 50000
    user haproxy
    group haproxy
    daemon

defaults
    log global
    mode tcp
    option tcplog
    option dontlognull
    timeout connect 5s
    timeout client 1h
    timeout server 1h

resolvers docker
    nameserver dns 127.0.0.1:53

frontend https_sni_passthrough
    bind *:443
    mode tcp
    tcp-request inspect-delay 5s
    tcp-request content accept if { req_ssl_hello_type 1 }
    default_backend backend_germany_sni

backend backend_germany_sni
    mode tcp
    balance roundrobin
    server germany_peer WG_PEER_IP_PLACEHOLDER:443 check resolvers docker init-addr last,libc,none

frontend dns_rhynoai
    bind *:80
    mode http
    default_backend backend_germany_http_as_https

backend backend_germany_http_as_https
    mode http
    timeout server 1h
    timeout tunnel 1h
    http-request set-header Host %[req.hdr(host)]
    server germany_ssl WG_PEER_IP_PLACEHOLDER:443 ssl verify none sni req.hdr(host),field(1,:) resolvers docker init-addr last,libc,none
EOF
sed -i "s/WG_PEER_IP_PLACEHOLDER/$WG_PEER_IP/g" "$INSTALL_DIR/proxy-server/haproxy.cfg"

# 7. Create Docker Compose File
echo "[+] Writing Docker Compose manifest..."
cat << 'EOF' > "$INSTALL_DIR/docker-compose.yml"
services:
  redis:
    image: redis:alpine
    container_name: dns-infra-redis-1
    restart: always
    command: redis-server --bind 127.0.0.1 --port 6379
    networks:
      - net

  coredns:
    image: coredns/coredns:latest
    container_name: dns-infra-coredns-1
    restart: always
    volumes:
      - ./dns-server:/root/dns-server
    command: -conf /root/dns-server/Corefile
    depends_on:
      - redis
    ports:
      - "53:53/udp"
      - "53:53/tcp"
    networks:
      - net

  haproxy:
    image: haproxy:alpine
    container_name: dns-infra-haproxy-1
    restart: always
    volumes:
      - ./proxy-server/haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - coredns
    networks:
      - net

networks:
  net:
    driver: bridge
EOF

# 8. Start Services and Populate Redis with Domains
echo "[+] Starting Docker containers..."
docker compose up -d

echo "[+] Waiting for Redis to initialize..."
sleep 3

echo "[+] Populating Redis with optimized anti-censorship and gaming domains..."
DOMAINS_JSON='["gemini.google.com","cod.cdn.activision.com","atvi-cdn.callofduty.com","cdn.callofduty.com","manifest.callofduty.com","auth.callofduty.com","profile.callofduty.com","uno.atvi.com","cod-assets.cdn.callofduty.com","prod.cdni.callofduty.com","telescope.callofduty.com","ingest.datax.activision.com","objectstore-cloud-prod-sat.egcp.demonware.net","user-consent.prod.demonware.net","delivery.mp.microsoft.com","dl.delivery.mp.microsoft.com","titlestorage.xboxlive.com","blob.core.windows.net","titlestorageeus20101.blob.core.windows.net","displaycatalog.mp.microsoft.com","licensing.mp.microsoft.com","payment.microsoft.com","purchase.mp.microsoft.com","billing.microsoft.com","xbl-status.live.com","battle.net","blizzard.com","battlenet.com","us.patch.battle.net","eu.patch.battle.net","discord.com","discordapp.com","discord.gg","steampowered.com","steamcommunity.com","epicgames.com","ea.com","ubisoft.com","riotgames.com"]'

docker compose exec -T redis redis-cli HSET DNSgaming:domains data "$DOMAINS_JSON"

echo "[+] Restarting CoreDNS to load domains..."
docker compose restart coredns

echo "===================================================="
echo "    Installation Completed Successfully!            "
echo "===================================================="
echo "    - Primary IP configured: $PRIMARY_IP"
if [ -n "$SECONDARY_IP" ]; then
  echo "    - Secondary IP configured: $SECONDARY_IP"
fi
echo "    - CoreDNS, Redis, and HAProxy are running."
echo "    - All routing rules and mangle marks are active."
echo "===================================================="