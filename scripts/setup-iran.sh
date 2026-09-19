#!/bin/bash
# ============================================================
# Automated Setup — Iran (Edge Node / CoreDNS & HAProxy)
# Requires: GERMANY_IP env var (the public IP of the Germany VPS)
# Installs: wireguard, curl, git, docker, docker-compose-plugin
# Configures WireGuard client and deploys docker compose stack
# Zero-touch: embedded default keypair, overridable via env vars
# Automatically runs doctor.sh diagnostics on completion
# ============================================================
set -euo pipefail

# --- Embedded Default Keypair (Iran Client) ---------------------------------
# Override any of these via environment variables:
DEFAULT_IRAN_PRIVKEY="OPit2CZi+x6fZYLKd0OeUiyMB+7/sP8oFV6q9JNc5EU="
DEFAULT_IRAN_PUBKEY="/PO1DDkGj5duyWI1TRSn6soUvh2kEiD7Ipj3lxgkr3s="
DEFAULT_GER_PUBKEY="9cqugEj7G9hw8VVbU/3yx5WkTZJ3GKOPsiOwdgoDVjQ="

IRAN_PRIVKEY="${WG_IRAN_PRIVKEY:-$DEFAULT_IRAN_PRIVKEY}"
GER_PUBKEY="${WG_GER_PUBKEY:-$DEFAULT_GER_PUBKEY}"
# --------------------------------------------------------------------------

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

# --- WireGuard client configuration -----------------------------------------
echo "[*] Writing ${WG_CONF}..."
mkdir -p "${WG_DIR}"
cat > "${WG_CONF}" <<-EOF
[Interface]
Address = ${CLIENT_ADDR}
PrivateKey = ${IRAN_PRIVKEY}
ListenPort = ${WG_PORT}

[Peer]
PublicKey = ${GER_PUBKEY}
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

# --- Run diagnostic suite --------------------------------------------------
echo ""
echo "============================================================"
echo "  Running Full Diagnostic Suite (doctor.sh)..."
echo "============================================================"
echo ""

DOCTOR_PATH="${PROJECT_ROOT}/scripts/doctor.sh"
if [ -f "${DOCTOR_PATH}" ]; then
    bash "${DOCTOR_PATH}"
else
    echo "[!] doctor.sh not found at ${DOCTOR_PATH}"
    echo "    You can run it later from the scripts directory."
fi

# --- Summary ---------------------------------------------------------------
echo ""
echo "============================================================"
echo "  Iran Edge Node — Setup Complete"
echo "============================================================"
echo ""
echo "  Client Private Key: ${IRAN_PRIVKEY}"
echo "  Client Public Key:  ${DEFAULT_IRAN_PUBKEY}"
echo "  Germany Peer Public: ${GER_PUBKEY}"
echo "  Tunnel IP:          ${CLIENT_ADDR}"
echo "  Germany Endpoint:   ${GERMANY_IP}:${WG_PORT}"
echo "============================================================"