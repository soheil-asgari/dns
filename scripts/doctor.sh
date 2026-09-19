#!/bin/bash
# ============================================================
# doctor.sh — Health-check & Root-Cause Diagnostic Tool
#
# Checks:
#   1. [Interface]  - wg0 exists
#   2. [Handshake]  - latest handshake ≤ 180s
#   3. [Tunnel Ping] - 10.10.0.1 reachable
#   4. [SNI Proxy]  - 10.10.0.1:443 open
#   5. [End-to-End TLS] - curl via local proxy
# ============================================================
set -euo pipefail

# --- Colors ----------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASS="${GREEN}[PASS]${NC}"
WARN="${YELLOW}[WARN]${NC}"
FAIL="${RED}[FAIL]${NC}"

echo ""
echo "============================================================"
echo "  🩺 DNS Infrastructure Doctor (doctor.sh)"
echo "============================================================"
echo ""

# --- Check 1: Interface ----------------------------------------------------
echo "--- Check 1 [Interface] ---"
if ip link show wg0 &>/dev/null; then
    echo -e "${PASS} wg0 interface exists and is UP"
else
    echo -e "${FAIL} wg0 interface not found!"
    echo "  → Run: systemctl enable --now wg-quick@wg0"
    echo "  → Check: /etc/wireguard/wg0.conf for syntax errors"
fi
echo ""

# --- Check 2: Handshake ----------------------------------------------------
echo "--- Check 2 [Handshake] ---"
HANDSHAKE=$(wg show wg0 latest-handshakes 2>/dev/null | awk '{print $2}')
if [ -z "${HANDSHAKE}" ] || [ "${HANDSHAKE}" = "0" ]; then
    echo -e "${FAIL} Handshake failed! No handshake recorded."
    echo "  → Root cause: Check if UDP port 51820 is open in foreign VPS cloud firewall."
    echo "  → Verify: nc -zv ${GERMANY_IP:-<germany-ip>} 51820"
    echo "  → Verify both peers have correct PublicKey in /etc/wireguard/wg0.conf"
elif [ $(date +%s) -gt $((HANDSHAKE + 180)) ]; then
    echo -e "${FAIL} Handshake older than 180s! Last: $(date -d @${HANDSHAKE} '+%H:%M:%S' 2>/dev/null || echo 'unknown')"
    echo "  → Root cause: Check if UDP port 51820 is open in foreign VPS cloud firewall."
    echo "  → Check: systemctl status wg-quick@wg0"
else
    echo -e "${PASS} Handshake is current (within 180s)"
fi
echo ""

# --- Check 3: Tunnel Ping --------------------------------------------------
echo "--- Check 3 [Tunnel Ping] ---"
if ping -c 2 -W 3 10.10.0.1 &>/dev/null; then
    echo -e "${PASS} Tunnel ping to 10.10.0.1 successful"
else
    echo -e "${FAIL} Packet loss inside tunnel! Cannot reach 10.10.0.1"
    echo "  → Root cause: Check MTU or IP forwarding."
    echo "  → On Germany: sysctl net.ipv4.ip_forward=1"
    echo "  → Try: ping -c 2 -M do -s 1200 10.10.0.1 (MTU test)"
fi
echo ""

# --- Check 4: SNI Proxy Listener -------------------------------------------
echo "--- Check 4 [SNI Proxy Listener] ---"
if command -v nc &>/dev/null; then
    if nc -zv -w 3 10.10.0.1 443 &>/dev/null; then
        echo -e "${PASS} Germany port 443 (sniproxy) is reachable via tunnel"
    else
        echo -e "${FAIL} Germany port 443 is closed via tunnel"
        echo "  → Root cause: Restart sniproxy on Germany server."
        echo "  → Run on Germany: systemctl restart sniproxy"
        echo "  → Check: systemctl status sniproxy"
        echo "  → Check: ss -tlnp | grep 443"
    fi
else
    echo -e "${WARN} nc (netcat) not installed — skipping port check"
    echo "  → Install: apt-get install -y netcat-openbsd"
fi
echo ""

# --- Check 5: End-to-End TLS ----------------------------------------------
echo "--- Check 5 [End-to-End TLS] ---"
if command -v curl &>/dev/null; then
    if curl -sSf -m 5 -o /dev/null -w "%{http_code}" \
        "https://epicgames.com" \
        --resolve "epicgames.com:443:127.0.0.1" \
        --connect-timeout 5 &>/dev/null; then
        echo -e "${PASS} End-to-end TLS via local proxy succeeded"
    else
        echo -e "${FAIL} End-to-end TLS via local proxy FAILED"
        echo "  → Root cause: Inspect HAProxy logs for SNI routing issues."
        echo "  → Check: docker compose logs haproxy | tail -20"
        echo "  → Check: curl -v https://epicgames.com --resolve epicgames.com:443:127.0.0.1"
    fi
else
    echo -e "${WARN} curl not installed — skipping TLS check"
fi
echo ""

echo "============================================================"
echo "  Diagnostics Complete"
echo "============================================================"
echo ""