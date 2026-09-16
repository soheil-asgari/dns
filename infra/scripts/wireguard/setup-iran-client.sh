#!/bin/bash
# ============================================================
# WireGuard Client Setup — Iran — Role: iran-dns
# Connects to Germany (Hetzner) WireGuard server
# Subnet: 10.10.0.0/24 | Client IP: 10.10.0.2 | Port: 51820/udp
# ============================================================
set -euo pipefail

# --- Configuration — EDIT THESE BEFORE RUNNING ----------------------------
SERVER_ENDPOINT="CHANGE_TO_GERMANY_SERVER_IP:51820"
SERVER_PUBLIC_KEY="CHANGE_TO_GERMANY_SERVER_PUBLIC_KEY"
# --------------------------------------------------------------------------

PRIVATE_DIR="/etc/wireguard/keys"
CLIENT_CONFIG="/etc/wireguard/wg0.conf"
CLIENT_INTERFACE="wg0"
WG_PORT=51820
CLIENT_ADDRESS="10.10.0.2/24"
SERVER_TUNNEL_IP="10.10.0.1"
ALLOWED_IPS="0.0.0.0/0, ::/0"

# --- Prerequisites ---------------------------------------------------------
echo "[*] Installing WireGuard..."
apt-get update -qq
apt-get install -y -qq wireguard

# --- Key generation (NEVER committed) -------------------------------------
echo "[*] Generating client keypair..."
mkdir -p "$PRIVATE_DIR"
chmod 700 "$PRIVATE_DIR"

wg genkey | tee "${PRIVATE_DIR}/client.key" | wg pubkey > "${PRIVATE_DIR}/client.pub"
chmod 600 "${PRIVATE_DIR}/client.key"

CLIENT_PRIV_KEY=$(cat "${PRIVATE_DIR}/client.key")
CLIENT_PUB_KEY=$(cat "${PRIVATE_DIR}/client.pub")

# --- wg0.conf (client mode) ------------------------------------------------
echo "[*] Writing $CLIENT_CONFIG ..."
cat > "$CLIENT_CONFIG" <<-EOF
[Interface]
Address = ${CLIENT_ADDRESS}
PrivateKey = ${CLIENT_PRIV_KEY}
ListenPort = ${WG_PORT}

# Route all traffic through Germany (the DNS server decides what to forward)
# If you only need the tunnel for DNS / gaming, restrict AllowedIPs later.
PostUp = sysctl -w net.ipv4.ip_forward=1

[Peer]
PublicKey = ${SERVER_PUBLIC_KEY}
Endpoint = ${SERVER_ENDPOINT}
AllowedIPs = ${ALLOWED_IPS}
PersistentKeepalive = 25
EOF

chmod 600 "$CLIENT_CONFIG"

# --- Enable & start --------------------------------------------------------
echo "[*] Enabling and starting wg-quick@${CLIENT_INTERFACE}..."
systemctl enable wg-quick@${CLIENT_INTERFACE}
systemctl start wg-quick@${CLIENT_INTERFACE}

# ===========================================================================
# IMPORTANT — Manual key exchange
# ===========================================================================
echo ""
echo "============================================================"
echo "  Iran-DNS Client  —  Public Key  (share with Germany)"
echo "============================================================"
echo ""
echo "  $CLIENT_PUB_KEY"
echo ""
echo "============================================================"
echo "  1. Copy the key above."
echo "  2. Paste it into your Germany server's wg0.conf [Peer] section."
echo "  3. On Germany run: systemctl restart wg-quick@wg0"
echo ""
echo "  Then verify the tunnel with: ping ${SERVER_TUNNEL_IP}"
echo "============================================================"