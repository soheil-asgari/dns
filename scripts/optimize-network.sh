#!/usr/bin/env bash
# =============================================================================
# optimize-network.sh — System & Network Optimization for DNS / SNI Gaming
# =============================================================================
# Idempotent: safe to run multiple times.  Applies TCP BBR, low-latency tuning,
# buffer increases, and iptables MSS clamping for WireGuard traffic.
# =============================================================================

set -euo pipefail

# --- Only root can apply sysctl & iptables rules ---
if [[ $EUID -ne 0 ]]; then
    echo "[!] This script must be run as root (or via sudo)." >&2
    exit 1
fi

SYSCTL_FILE="/etc/sysctl.d/99-dns-gaming-optimizations.conf"

echo "[*] Writing sysctl overrides to ${SYSCTL_FILE} ..."

cat > "${SYSCTL_FILE}" << 'SYSCTL_EOF'
# ----------------------------------------------------------------------
# TCP BBR Congestion Control (requires kernel >= 4.9)
# ----------------------------------------------------------------------
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr

# ----------------------------------------------------------------------
# Low-latency TCP tuning
# ----------------------------------------------------------------------
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_tw_reuse = 1

# ----------------------------------------------------------------------
# Socket receive/send buffer maximums (bytes)
# ----------------------------------------------------------------------
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728

# ----------------------------------------------------------------------
# TCP auto-tuning buffer limits (min, default, max bytes)
# ----------------------------------------------------------------------
net.ipv4.tcp_rmem = 4096 87380 134217728
net.ipv4.tcp_wmem = 4096 65536 134217728

# ----------------------------------------------------------------------
# Enable TCP window scaling (RFC 1323) — almost always on by default
# ----------------------------------------------------------------------
net.ipv4.tcp_window_scaling = 1
SYSCTL_EOF

echo "[*] Applying sysctl settings ..."
sysctl -p "${SYSCTL_FILE}"

# --------------------------------------------------------------------------
# iptables MSS Clamping for WireGuard forwarded traffic
# Clamp TCP MSS to path MTU to avoid fragmentation over the tunnel
# --------------------------------------------------------------------------
echo "[*] Applying iptables MSS clamping for WireGuard forward chain ..."
iptables -t mangle -C FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null \
    || iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu

echo "[*] Persisting iptables rules ..."
# Try iptables-persistent; fall back to iptables-save if the service is unavailable
if command -v netfilter-persistent &>/dev/null; then
    netfilter-persistent save
elif command -v iptables-save &>/dev/null; then
    mkdir -p /etc/iptables
    iptables-save > /etc/iptables/rules.v4 2>/dev/null || true
fi

# --------------------------------------------------------------------------
# Verify BBR is active
# --------------------------------------------------------------------------
echo "[*] Verifying congestion control algorithm ..."
CC_ALGO=$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || echo "unknown")
if [[ "${CC_ALGO}" == "bbr" ]]; then
    echo "[✔] BBR is active (congestion_control = ${CC_ALGO})."
else
    echo "[!] BBR was not set (current = ${CC_ALGO}). Kernel may not support it." >&2
fi

echo ""
echo "[✔] All optimisations applied successfully."
exit 0