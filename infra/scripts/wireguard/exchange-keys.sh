#!/bin/bash
# ============================================================
# WireGuard Key Exchange Orchestrator
# ============================================================
# Automates key exchange between Germany (server) and Iran (client)
# via SSH. No private keys ever leave the servers.
#
# Usage:
#   ./exchange-keys.sh -g <germany-host> -u <germany-ssh-user> \
#                      -p <germany-ssh-port> -i <iran-host> \
#                      -U <iran-ssh-user> -P <iran-ssh-port>
#
# Requirements:
#   - SSH key-based auth to both servers (from the runner)
#   - sudo (or root) access on both servers via SSH
#   - WireGuard scripts pre-deployed on each server
# ============================================================
set -euo pipefail

# --- Usage ----------------------------------------------------------------
usage() {
    cat <<EOF
Usage: $0 [OPTIONS]

Required:
  -g HOST    Germany server hostname/IP
  -u USER    Germany SSH user
  -p PORT    Germany SSH port
  -i HOST    Iran server hostname/IP
  -U USER    Iran SSH user
  -P PORT    Iran SSH port

Example:
  $0 \\
    -g 1.2.3.4 -u root -p 22 \\
    -i 5.6.7.8 -U root -P 22
EOF
    exit 1
}

# --- Parse arguments ------------------------------------------------------
while getopts "g:u:p:i:U:P:h" opt; do
    case "$opt" in
        g) GERMANY_HOST="$OPTARG" ;;
        u) GERMANY_SSH_USER="$OPTARG" ;;
        p) GERMANY_SSH_PORT="$OPTARG" ;;
        i) IRAN_HOST="$OPTARG" ;;
        U) IRAN_SSH_USER="$OPTARG" ;;
        P) IRAN_SSH_PORT="$OPTARG" ;;
        h) usage ;;
        *) usage ;;
    esac
done

if [ -z "${GERMANY_HOST:-}" ] || [ -z "${GERMANY_SSH_USER:-}" ] || [ -z "${GERMANY_SSH_PORT:-}" ] \
    || [ -z "${IRAN_HOST:-}" ] || [ -z "${IRAN_SSH_USER:-}" ] || [ -z "${IRAN_SSH_PORT:-}" ]; then
    usage
fi

# --- SSH helper -----------------------------------------------------------
germany() {
    ssh -o StrictHostKeyChecking=accept-new -p "$GERMANY_SSH_PORT" "${GERMANY_SSH_USER}@${GERMANY_HOST}" -- "$@"
}
iran() {
    ssh -o StrictHostKeyChecking=accept-new -p "$IRAN_SSH_PORT" "${IRAN_SSH_USER}@${IRAN_HOST}" -- "$@"
}

# --- Step 1: Setup Germany server if needed & fetch public key ------------
echo ""
echo "============================================================"
echo "  [1/5] Germany — setup & fetch public key"
echo "============================================================"

if germany test -f /etc/wireguard/wg0.conf; then
    echo "[*] wg0.conf already exists on Germany — skipping setup"
else
    echo "[*] Running setup-germany-server.sh on Germany..."
    GERMANY_SCRIPT_DIR="/root/wireguard-setup"
    germany mkdir -p "$GERMANY_SCRIPT_DIR"
    # Copy the local script up
    scp -q -P "$GERMANY_SSH_PORT" \
        "$(dirname "$0")/setup-germany-server.sh" \
        "${GERMANY_SSH_USER}@${GERMANY_HOST}:${GERMANY_SCRIPT_DIR}/"
    germany "cd $GERMANY_SCRIPT_DIR && bash setup-germany-server.sh"
fi

# Read Germany's public key
GERMANY_PUB_KEY=$(germany cat /etc/wireguard/keys/server.pub)
echo "[*] Germany public key: $GERMANY_PUB_KEY"

# Get Germany's tunnel IP (likely 10.10.0.1)
GERMANY_TUNNEL_IP="10.10.0.1"
echo "[*] Germany tunnel IP: $GERMANY_TUNNEL_IP"

# --- Step 2: Setup Iran client with Germany's public key ------------------
echo ""
echo "============================================================"
echo "  [2/5] Iran — setup client with Germany's public key"
echo "============================================================"

# Determine Germany's external endpoint IP
if [ "$GERMANY_HOST" = "localhost" ] || [ "$GERMANY_HOST" = "127.0.0.1" ]; then
    # Running orchestrator ON the Germany server — use its public IP
    GERMANY_ENDPOINT_IP=$(germany curl -s ifconfig.me 2>/dev/null || echo "$GERMANY_HOST")
else
    GERMANY_ENDPOINT_IP="$GERMANY_HOST"
fi
IRAN_ENDPOINT="${GERMANY_ENDPOINT_IP}:51820"

if iran test -f /etc/wireguard/wg0.conf; then
    echo "[*] wg0.conf already exists on Iran — updating PublicKey & Endpoint"
    iran "sed -i 's/^PublicKey = .*/PublicKey = ${GERMANY_PUB_KEY}/' /etc/wireguard/wg0.conf"
    iran "sed -i 's|^Endpoint = .*|Endpoint = ${IRAN_ENDPOINT}|' /etc/wireguard/wg0.conf"
else
    echo "[*] Running setup-iran-client.sh on Iran with env overrides..."
    IRAN_SCRIPT_DIR="/root/wireguard-setup"
    iran mkdir -p "$IRAN_SCRIPT_DIR"
    scp -q -P "$IRAN_SSH_PORT" \
        "$(dirname "$0")/setup-iran-client.sh" \
        "${IRAN_SSH_USER}@${IRAN_HOST}:${IRAN_SCRIPT_DIR}/"
    # Inject real values via env vars
    iran "cd $IRAN_SCRIPT_DIR && SERVER_ENDPOINT='${IRAN_ENDPOINT}' SERVER_PUBLIC_KEY='${GERMANY_PUB_KEY}' bash setup-iran-client.sh"
fi

# Read Iran's public key
IRAN_PUB_KEY=$(iran cat /etc/wireguard/keys/client.pub)
echo "[*] Iran public key: $IRAN_PUB_KEY"

# --- Step 3: Inject Iran's public key into Germany's wg0.conf -------------
echo ""
echo "============================================================"
echo "  [3/5] Germany — add Iran as Peer"
echo "============================================================"

# Check if Iran's peer section already exists
EXISTING_IRAN_KEY=$(germany "grep -oP '^PublicKey = \K.*' /etc/wireguard/wg0.conf 2>/dev/null || true")
if [ "$EXISTING_IRAN_KEY" = "$IRAN_PUB_KEY" ]; then
    echo "[*] Iran's public key is already set in Germany's wg0.conf — skipping"
else
    echo "[*] Updating Peer PublicKey in Germany's wg0.conf..."
    # Replace the placeholder or existing PublicKey in [Peer] section
    germany "sed -i '/^\[Peer\]/,/^$/ s/^#\?PublicKey = .*/PublicKey = ${IRAN_PUB_KEY}/' /etc/wireguard/wg0.conf"
fi

# --- Step 4: Restart wg-quick on both sides --------------------------------
echo ""
echo "============================================================"
echo "  [4/5] Restart wg-quick on both servers"
echo "============================================================"

echo "[*] Restarting wg-quick@wg0 on Germany..."
germany systemctl restart wg-quick@wg0

echo "[*] Restarting wg-quick@wg0 on Iran..."
iran systemctl restart wg-quick@wg0

# Brief wait for tunnel to establish
sleep 3

# --- Step 5: Verify connectivity with ping ---------------------------------
echo ""
echo "============================================================"
echo "  [5/5] Verify tunnel — ping from Iran to Germany (10.10.0.1)"
echo "============================================================"

PING_RESULT=$(iran ping -c 4 -W 5 10.10.0.1 2>&1 || true)
echo "$PING_RESULT"

if echo "$PING_RESULT" | grep -q "0% packet loss"; then
    echo ""
    echo "============================================================"
    echo "  SUCCESS — WireGuard tunnel is operational!"
    echo "============================================================"
    echo ""
    echo "  Germany public key:  $GERMANY_PUB_KEY"
    echo "  Iran public key:     $IRAN_PUB_KEY"
    echo "  Endpoint:            $IRAN_ENDPOINT"
    echo ""
    exit 0
else
    echo ""
    echo "============================================================"
    echo "  FAILURE — ping did not succeed"
    echo "============================================================"
    echo "  Check firewall / routing on both servers."
    echo "  Tunnel IPs: Germany=10.10.0.1  Iran=10.10.0.2"
    echo "============================================================"
    exit 1
fi