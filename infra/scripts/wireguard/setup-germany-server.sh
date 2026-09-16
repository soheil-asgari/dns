#!/bin/bash
# ============================================================
# WireGuard Server Setup — Germany (Hetzner) — Role: germany-exit
# Subnet: 10.10.0.0/24 | Server IP: 10.10.0.1 | Port: 51820/udp
# ============================================================
set -euo pipefail

# --- Configuration ---------------------------------------------------------
SERVER_PRIVATE_DIR="/etc/wireguard/keys"
SERVER_CONFIG="/etc/wireguard/wg0.conf"
SERVER_INTERFACE="wg0"
WG_PORT=51820
WG_SUBNET="10.10.0.1/24"
CLIENT_ALLOWED_IPS="10.10.0.2/32"

# --- Prerequisites ---------------------------------------------------------
echo "[*] Installing WireGuard..."
apt-get update -qq
apt-get install -y -qq wireguard qrencode

# --- Key generation (NEVER committed) -------------------------------------
echo "[*] Generating server keypair..."
mkdir -p "$SERVER_PRIVATE_DIR"
chmod 700 "$SERVER_PRIVATE_DIR"

wg genkey | tee "${SERVER_PRIVATE_DIR}/server.key" | wg pubkey > "${SERVER_PRIVATE_DIR}/server.pub"
chmod 600 "${SERVER_PRIVATE_DIR}/server.key"

SERVER_PRIV_KEY=$(cat "${SERVER_PRIVATE_DIR}/server.key")
SERVER_PUB_KEY=$(cat "${SERVER_PRIVATE_DIR}/server.pub")

# --- wg0.conf (server mode) ------------------------------------------------
echo "[*] Writing $SERVER_CONFIG ..."
cat > "$SERVER_CONFIG" <<-EOF
[Interface]
Address = ${WG_SUBNET}
ListenPort = ${WG_PORT}
PrivateKey = ${SERVER_PRIV_KEY}
SaveConfig = false

# ip-forwarding is handled by infra/nftables/dns-filter.nft or sysctl
PostUp = sysctl -w net.ipv4.ip_forward=1
PostUp = sysctl -w net.ipv6.conf.all.forwarding=1
PostUp = nft add table ip filter 2>/dev/null; nft add chain ip filter FORWARD { type filter hook forward priority 0 \; } 2>/dev/null; nft add rule ip filter FORWARD iifname ${SERVER_INTERFACE} accept
PostDown = nft delete rule ip filter FORWARD iifname ${SERVER_INTERFACE} accept 2>/dev/null || true

# Iran DNS (WireGuard client)
[Peer]
# PublicKey = <paste-iran-client-public-key-here>
# After first run, copy the Client Public Key printed below into this line.
# NOTE: AllowedIPs intentionally limited to /32 for split-tunnel operation.
# Only traffic destined to the Iran client's tunnel IP goes through WireGuard;
# all other traffic (apt, system updates, etc.) uses the server's local internet.
# Do NOT change to 0.0.0.0/0 unless you intend a full-VPN topology.
AllowedIPs = ${CLIENT_ALLOWED_IPS}
EOF

chmod 600 "$SERVER_CONFIG"

# --- Enable & start --------------------------------------------------------
echo "[*] Enabling and starting wg-quick@${SERVER_INTERFACE}..."
systemctl enable wg-quick@${SERVER_INTERFACE}
systemctl start wg-quick@${SERVER_INTERFACE}

# ===========================================================================
# IMPORTANT — Manual key exchange
# ===========================================================================
echo ""
echo "============================================================"
echo "  Germany-Exit Server Setup Complete"
echo "============================================================"
echo ""
echo "  Server Public Key:  $SERVER_PUB_KEY"
echo ""
echo "  Key files:"
echo "    Private key: ${SERVER_PRIVATE_DIR}/server.key"
echo "    Public key:  ${SERVER_PRIVATE_DIR}/server.pub"
echo ""
echo "  Config: $SERVER_CONFIG"
echo "============================================================"