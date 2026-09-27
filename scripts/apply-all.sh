#!/usr/bin/env bash
# =============================================================================
# apply-all.sh — Idempotent full-stack network + DNS + dual-NIC PBR deploy
# =============================================================================
# Usage: sudo ./apply-all.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "[!] Must be run as root." >&2
    exit 1
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

echo ""
echo "=========================================="
echo "STEP 1: Bring up eth1"
echo "=========================================="
ip link set eth1 up 2>/dev/null && echo "[*] eth1 is up" || echo "[*] eth1 already up or not present"

echo ""
echo "=========================================="
echo "STEP 2: Policy-Based Routing (PBR)"
echo "=========================================="

# Table 101 — eth1 (185.226.117.62)
ip route add 185.226.116.0/22 dev eth1 src 185.226.117.62 table 101 2>/dev/null || true
ip route add default via 185.226.116.1 dev eth1 table 101 2>/dev/null || true
ip rule add from 185.226.117.62 lookup 101 2>/dev/null || true

# Table 102 — eth2 (185.226.119.97)
ip route add 185.226.116.0/22 dev eth2 src 185.226.119.97 table 102 2>/dev/null || true
ip route add default via 185.226.116.1 dev eth2 table 102 2>/dev/null || true
ip rule add from 185.226.119.97 lookup 102 2>/dev/null || true

echo "[*] PBR tables 101 (eth1) and 102 (eth2) configured"

echo ""
echo "=========================================="
echo "STEP 3: sysctl — Kernel Optimizations (12GB RAM)"
echo "=========================================="

cat > /etc/sysctl.d/99-dns-gaming-optimizations.conf << 'SYSCTL_EOF'
# TCP BBR Congestion Control
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr

# Low-latency TCP tuning
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_tw_reuse = 1

# Socket buffer maximums (128MB)
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728

# UDP buffer defaults
net.core.rmem_default = 262144
net.core.wmem_default = 262144

# TCP auto-tuning buffers
net.ipv4.tcp_rmem = 4096 87380 134217728
net.ipv4.tcp_wmem = 4096 65536 134217728

net.ipv4.tcp_window_scaling = 1

# Netdev / softirq tuning
net.core.netdev_budget = 600
net.core.netdev_budget_usecs = 8000
net.core.netdev_max_backlog = 10000

# TCP MTU probing
net.ipv4.tcp_mtu_probing = 1

# Faster dead-connection detection
net.ipv4.tcp_keepalive_time = 60
net.ipv4.tcp_keepalive_intvl = 10
net.ipv4.tcp_keepalive_probes = 3

# Reduce TIME_WAIT impact
net.ipv4.tcp_fin_timeout = 15

# NotSent Lowat
net.ipv4.tcp_notsent_lowat = 131072

# Conntrack tuning
net.netfilter.nf_conntrack_max = 262144
net.netfilter.nf_conntrack_tcp_timeout_established = 432000
net.netfilter.nf_conntrack_udp_timeout = 30
net.netfilter.nf_conntrack_udp_timeout_stream = 120

# rp_filter — loose mode for dual-NIC
net.ipv4.conf.all.rp_filter = 2
net.ipv4.conf.default.rp_filter = 2
net.ipv4.conf.eth1.rp_filter = 2
net.ipv4.conf.eth2.rp_filter = 2
SYSCTL_EOF

sysctl -p /etc/sysctl.d/99-dns-gaming-optimizations.conf
echo "[*] sysctl settings applied"

echo ""
echo "=========================================="
echo "STEP 4: Traffic Control — fq_codel"
echo "=========================================="

tc qdisc replace dev eth1 root fq_codel 2>/dev/null && echo "[*] fq_codel on eth1" || echo "[!] fq_codel on eth1 skipped"
tc qdisc replace dev eth2 root fq_codel 2>/dev/null && echo "[*] fq_codel on eth2" || echo "[!] fq_codel on eth2 skipped"

echo ""
echo "=========================================="
echo "STEP 5: systemd services — tc-qdisc + pbr-routes"
echo "=========================================="

# tc-qdisc.service
cp -f "${REPO_DIR}/infra/systemd/tc-qdisc.service" /etc/systemd/system/tc-qdisc.service
systemctl daemon-reload
systemctl enable tc-qdisc.service
systemctl restart tc-qdisc.service
echo "[*] tc-qdisc.service enabled"

# pbr-routes.service
cp -f "${REPO_DIR}/infra/systemd/pbr-routes.service" /etc/systemd/system/pbr-routes.service
systemctl daemon-reload
systemctl enable pbr-routes.service
systemctl restart pbr-routes.service
echo "[*] pbr-routes.service enabled"

echo ""
echo "=========================================="
echo "STEP 6: Validate & apply nftables"
echo "=========================================="

nft -c -f "${REPO_DIR}/infra/nftables/dns-filter.nft" && echo "[*] nftables config valid" || {
    echo "[!] nftables validation FAILED — check dns-filter.nft syntax" >&2
    exit 1
}
nft -f "${REPO_DIR}/infra/nftables/dns-filter.nft" && echo "[*] nftables rules applied" || {
    echo "[!] nftables apply FAILED" >&2
    exit 1
}

echo ""
echo "=========================================="
echo "STEP 7: Docker log rotation"
echo "=========================================="

cat > /etc/docker/daemon.json << 'DOCKER_EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "30m",
    "max-file": 3
  },
  "iptables": false
}
DOCKER_EOF

systemctl restart docker 2>/dev/null || true
echo "[*] Docker log rotation configured (max-size: 30m, max-file: 3)"

echo ""
echo "=========================================="
echo "STEP 8: Docker compose — restart containers"
echo "=========================================="

docker compose up -d 2>/dev/null || docker-compose up -d 2>/dev/null || echo "[!] docker compose not available — skip"
echo "[*] Containers restarted with updated configs"

echo ""
echo "=========================================="
echo "VERIFICATION SUMMARY"
echo "=========================================="

echo ""
echo "--- BBR ---"
sysctl net.ipv4.tcp_congestion_control

echo ""
echo "--- qdisc ---"
tc qdisc show dev eth1 2>/dev/null | head -3 || echo "eth1 not found"
tc qdisc show dev eth2 2>/dev/null | head -3 || echo "eth2 not found"

echo ""
echo "--- PBR rules ---"
ip rule show | grep -E "lookup (10[12])" || echo "no PBR rules found"

echo ""
echo "--- Route table 101 (eth1) ---"
ip route show table 101 2>/dev/null || echo "(empty)"

echo ""
echo "--- Route table 102 (eth2) ---"
ip route show table 102 2>/dev/null || echo "(empty)"

echo ""
echo "--- Containers ---"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "docker not available"

echo ""
echo "[✔] All optimizations applied successfully."