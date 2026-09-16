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
PostUp = nft add rule ip filter FORWARD iifname ${SERVER_INTERFACE} accept
PostDown = nft delete rule ip filter FORWARD iifname ${SERVER_INTERFACE} accept 2>/dev/null || true

# Iran DNS (WireGuard client)
[Peer]
# PublicKey = <paste-iran-client-public-key-here>
# After first run, copy the Client Public Key printed below into this line.
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
echo "  Germany-Exit Server  —  Public Key  (share with Iran)"
echo "============================================================"
echo ""
echo "  $SERVER_PUB_KEY"
echo ""
echo "============================================================"
echo "  1. Copy the key above."
echo "  2. Paste it into your Iran server's wg0.conf [Peer] section."
echo "  3. Then on Iran run: systemctl restart wg-quick@wg0"
echo ""
echo "  Waiting for Iran peer connection ... (netstat -tulpn | grep 51820)"
echo "============================================================"