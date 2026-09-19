#!/bin/bash
# ============================================================
# Automated Setup — Iran (Edge Node / CoreDNS & HAProxy)
# Requires: GERMANY_IP env var (the public IP of the Germany VPS)
# Installs: wireguard, curl, git, docker, docker-compose-plugin
# Configures WireGuard client and deploys docker compose stack
# ============================================================
set -euo pipefail

# --- Validate GERMANY_IP ---------------------------------------------------
if [ -z "${GERMANY_IP:-}" ]; then
    echo "ERROR: GERMANY_IP environment variable is not set."
    echo "Usage: GERMANY_IP=<germany-vps-ip> bash $0"
    exit 1
fi

# Basic IP validation (IPv4)
if ! [[ "${GERMANY_IP}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "ERROR: GERMANY_IP='${GERMANY_IP}' is not a valid IPv4 address."
    exit 1
fi

echo "[*] GERMANY_IP validated: ${GERMANY_IP}"

# --- Configuration ---------------------------------------------------------
WG_DIR="/etc/wireguard"
WG_CONF="${WG_DIR}/wg0.conf"
WG_PORT=51820
CLIENT_ADDR="10.10.0.2/24"
SERVER_TUNNEL_IP="10.10.0.1"
ALLOWED_IPS="10.10.0.1/32"
PERSISTENT_KEEPALIVE=25
# Optionally override the Germany server's public key via env var
SERVER_PUBLIC_KEY="${GERMANY_PUB_KEY:-}"
# --------------------------------------------------------------------------

# --- Install dependencies --------------------------------------------------
echo "[*] Installing wireguard, curl, git..."
apt-get update -qq
apt-get install -y -qq wireguard curl git

# --- Install Docker if not present -----------------------------------------
if ! command -v docker &>/dev/null; then
    echo "[*] Installing Docker..."
    curl -fsSL https://get.docker.com | sh
fi

# --- Install docker-compose-plugin if not present --------------------------
if ! docker compose version &>/dev/null; then
    echo "[*] Installing docker-compose-plugin..."
    apt-get install -y -qq docker-compose-plugin
fi

# --- WireGuard client keypair ----------------------------------------------
echo "[*] Generating WireGuard client keypair..."
mkdir -p "${WG_DIR}/keys"
chmod 700 "${WG_DIR}/keys"

wg genkey | tee "${WG_DIR}/keys/client.key" | wg pubkey > "${WG_DIR}/keys/client.pub"
chmod 600 "${WG_DIR}/keys/client.key"

CLIENT_PRIV_KEY=$(cat "${WG_DIR}/keys/client.key")

# --- WireGuard client configuration -----------------------------------------
echo "[*] Writing ${WG_CONF}..."
cat > "${WG_CONF}" <<-EOF
[Interface]
Address = ${CLIENT_ADDR}
PrivateKey = ${CLIENT_PRIV_KEY}
ListenPort = ${WG_PORT}

[Peer]
PublicKey = ${SERVER_PUBLIC_KEY}
Endpoint = ${GERMANY_IP}:${WG_PORT}
AllowedIPs = ${ALLOWED_IPS}
PersistentKeepalive = ${PERSISTENT_KEEPALIVE}
EOF

chmod 600 "${WG_CONF}"

# --- Enable & start WireGuard ----------------------------------------------
echo "[*] Enabling and starting wg-quick@wg0..."
systemctl enable wg-quick@wg0
systemctl start wg-quick@wg0

# --- Verify tunnel ---------------------------------------------------------
echo "[*] Verifying tunnel to 10.10.0.1..."
for i in 1 2 3 4 5; do
    if ping -c 1 -W 2 "${SERVER_TUNNEL_IP}" &>/dev/null; then
        echo "[✓] Tunnel is UP — ping to ${SERVER_TUNNEL_IP} succeeded."
        break
    fi
    if [ "$i" -eq 5 ]; then
        echo "[!] WARNING: Could not reach ${SERVER_TUNNEL_IP}. Check keys and firewall."
    fi
    sleep 2
done

# --- Deploy docker compose stack -------------------------------------------
PROJECT_ROOT="/opt/dns-infra"
mkdir -p "${PROJECT_ROOT}"

if [ -d "${PROJECT_ROOT}/.git" ]; then
    echo "[*] Pulling latest from repo..."
    cd "${PROJECT_ROOT}" && git pull
else
    echo "[*] Cloning repo into ${PROJECT_ROOT}..."
    git clone https://github.com/your-org/your-repo.git "${PROJECT_ROOT}"
    cd "${PROJECT_ROOT}"
fi

echo "[*] Starting Docker Compose stack..."
cd "${PROJECT_ROOT}"
docker compose pull
docker compose up -d

# --- Summary ---------------------------------------------------------------
echo ""
echo "============================================================"
echo "  Iran Edge Node — Setup Complete"
echo "============================================================"
echo ""
echo "  Client Public Key: $(cat ${WG_DIR}/keys/client.pub)"
echo "  Tunnel IP:         ${CLIENT_ADDR}"
echo ""
echo "  NEXT STEP: Update ${WG_CONF} [Peer] PublicKey"
echo "  with the Germany server's public key, then:"
echo "    systemctl restart wg-quick@wg0"
echo ""
echo "  Also add the Iran client public key to the Germany"
echo "  server's ${WG_CONF} [Peer] PublicKey."
echo "============================================================"