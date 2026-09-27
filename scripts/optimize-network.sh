#!/usr/bin/env bash
# =============================================================================
# optimize-network.sh — System & Network Optimization for DNS / SNI Gaming
# =============================================================================
# Idempotent: safe to run multiple times.  Applies TCP BBR, low-latency tuning,
# buffer increases, iptables MSS clamping, UDP tuning, conntrack, QoS qdisc.
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
# UDP buffer defaults (critical for gaming / DNS)
# ----------------------------------------------------------------------
net.core.rmem_default = 262144
net.core.wmem_default = 262144

# ----------------------------------------------------------------------
# TCP auto-tuning buffer limits (min, default, max bytes)
# ----------------------------------------------------------------------
net.ipv4.tcp_rmem = 4096 87380 134217728
net.ipv4.tcp_wmem = 4096 65536 134217728

# ----------------------------------------------------------------------
# Enable TCP window scaling (RFC 1323) — almost always on by default
# ----------------------------------------------------------------------
net.ipv4.tcp_window_scaling = 1

# ----------------------------------------------------------------------
# Netdev / softirq tuning — more packets per interrupt
# ----------------------------------------------------------------------
net.core.netdev_budget = 600
net.core.netdev_budget_usecs = 8000
net.core.netdev_max_backlog = 5000

# ----------------------------------------------------------------------
# TCP MTU probing — avoid fragmentation over tunnels
# ----------------------------------------------------------------------
net.ipv4.tcp_mtu_probing = 1

# ----------------------------------------------------------------------
# Faster dead-connection detection
# ----------------------------------------------------------------------
net.ipv4.tcp_keepalive_time = 60
net.ipv4.tcp_keepalive_intvl = 10
net.ipv4.tcp_keepalive_probes = 3

# ----------------------------------------------------------------------
# Reduce TIME_WAIT impact
# ----------------------------------------------------------------------
net.ipv4.tcp_fin_timeout = 15

# ----------------------------------------------------------------------
# TCP NotSent Lowat — reduce send latency
# ----------------------------------------------------------------------
net.ipv4.tcp_notsent_lowat = 131072

# ----------------------------------------------------------------------
# Conntrack tuning — prevent table overflow under load
# ----------------------------------------------------------------------
net.netfilter.nf_conntrack_max = 262144
net.netfilter.nf_conntrack_tcp_timeout_established = 432000
net.netfilter.nf_conntrack_udp_timeout = 30
net.netfilter.nf_conntrack_udp_timeout_stream = 120
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
# Apply fq_codel qdisc on main interface
# --------------------------------------------------------------------------
MAIN_IFACE=$(ip -4 route show default | awk '{print $5}' | head -1)
if [[ -n "$MAIN_IFACE" ]]; then
    echo "[*] Setting fq_codel qdisc on ${MAIN_IFACE} ..."
    tc qdisc replace dev "${MAIN_IFACE}" root fq_codel 2>/dev/null || \
        echo "[!] Could not set fq_codel on ${MAIN_IFACE} (might be virtual interface)."
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