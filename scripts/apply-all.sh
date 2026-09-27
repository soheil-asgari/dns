#!/usr/bin/env bash
# =============================================================================
# apply-all.sh — Apply remaining optimizations (PBR already fixed separately)
# =============================================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "[!] Must be run as root." >&2
    exit 1
fi

echo ""
echo "=========================================="
echo "STEP 2: Kernel Optimization (sysctl)"
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

# rp_filter - loose mode for dual-NIC
net.ipv4.conf.all.rp_filter = 2
net.ipv4.conf.default.rp_filter = 2
net.ipv4.conf.eth1.rp_filter = 2
net.ipv4.conf.eth2.rp_filter = 2
SYSCTL_EOF

sysctl -p /etc/sysctl.d/99-dns-gaming-optimizations.conf
echo "[*] sysctl settings applied"

echo ""
echo "=========================================="
echo "STEP 3: Traffic Control - fq_codel"
echo "=========================================="

tc qdisc replace dev eth1 root fq_codel 2>/dev/null && echo "[*] fq_codel on eth1" || echo "[!] fq_codel on eth1 skipped"
tc qdisc replace dev eth2 root fq_codel 2>/dev/null && echo "[*] fq_codel on eth2" || echo "[!] fq_codel on eth2 skipped"

# Copy and enable systemd service
cp /root/dns/infra/systemd/tc-qdisc.service /etc/systemd/system/tc-qdisc.service
systemctl daemon-reload
systemctl enable tc-qdisc.service
systemctl restart tc-qdisc.service
echo "[*] tc-qdisc service enabled"

echo ""
echo "=========================================="
echo "STEP 4: Validate and apply nftables"
echo "=========================================="

nft -c -f /root/dns/infra/nftables/dns-filter.nft && echo "[*] nftables config valid" || echo "[!] nftables validation FAILED"
nft -f /root/dns/infra/nftables/dns-filter.nft && echo "[*] nftables rules applied" || echo "[!] nftables apply FAILED"

echo ""
echo "=========================================="
echo "STEP 5: Docker log rotation"
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
echo "[*] Docker log rotation configured"

echo ""
echo "=========================================="
echo "STEP 6: UFW - allow SSH 2222"
echo "=========================================="

ufw allow 2222/tcp 2>/dev/null || true
ufw --force enable 2>/dev/null || true
echo "[*] UFW configured"

echo ""
echo "=========================================="
echo "VERIFICATION"
echo "=========================================="

echo ""
echo "--- Routing rules ---"
ip rule show

echo ""
echo "--- Route table 101 ---"
ip route show table 101 2>/dev/null || echo "(empty)"

echo ""
echo "--- Route table 102 ---"
ip route show table 102 2>/dev/null || echo "(empty)"

echo ""
echo "--- qdisc ---"
tc qdisc show dev eth1 2>/dev/null || echo "eth1 not found"
tc qdisc show dev eth2 2>/dev/null || echo "eth2 not found"

echo ""
echo "--- sysctl ---"
sysctl net.ipv4.tcp_congestion_control
sysctl net.ipv4.conf.all.rp_filter
sysctl net.ipv4.conf.eth1.rp_filter
sysctl net.ipv4.conf.eth2.rp_filter

echo ""
echo "[✔] All optimizations applied."
echo "Next: docker compose up -d to reload containers"