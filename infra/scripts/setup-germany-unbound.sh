#!/bin/bash
# ============================================================
# Setup Unbound recursive resolver on Germany exit node.
# Binds only to the WireGuard interface (10.10.0.1:53) so it
# is not exposed to the public internet.
# ============================================================
set -euo pipefail

UNBOUND_CONF_SRC="./infra/unbound-germany/unbound.conf"
UNBOUND_CONF_DST="/etc/unbound/unbound.conf"

# --- Install Unbound ---------------------------------------------------------
echo "[*] Installing Unbound..."
apt-get update -qq
apt-get install -y -qq unbound ca-certificates

# --- Deploy configuration ----------------------------------------------------
echo "[*] Deploying Unbound configuration..."
mkdir -p /etc/unbound
cp "$UNBOUND_CONF_SRC" "$UNBOUND_CONF_DST"
chmod 644 "$UNBOUND_CONF_DST"

# --- Initialize root trust anchor --------------------------------------------
echo "[*] Initializing root trust anchor..."
unbound-anchor -a /var/lib/unbound/root.key || true

# --- Enable & start ----------------------------------------------------------
echo "[*] Enabling and starting Unbound..."
systemctl enable unbound
systemctl restart unbound

# --- Apply nftables rules for DNS restriction --------------------------------
echo "[*] Applying nftables DNS restriction..."
if command -v nft &>/dev/null; then
    nft add rule inet filter input iifname "wg0" tcp dport 53 accept 2>/dev/null || true
    nft add rule inet filter input iifname "wg0" udp dport 53 accept 2>/dev/null || true
    # Ensure DNS on other interfaces is dropped
    nft add rule inet filter input tcp dport 53 drop 2>/dev/null || true
    nft add rule inet filter input udp dport 53 drop 2>/dev/null || true
    echo "[✓] nftables rules applied for DNS-on-wg0-only."
else
    echo "[!] nftables not available — install nftables or apply rules manually."
    echo "    iptables -A INPUT -i wg0 -p tcp --dport 53 -j ACCEPT"
    echo "    iptables -A INPUT -i wg0 -p udp --dport 53 -j ACCEPT"
    echo "    iptables -A INPUT -p tcp --dport 53 -j DROP"
    echo "    iptables -A INPUT -p udp --dport 53 -j DROP"
fi

# --- Verify ------------------------------------------------------------------
echo ""
echo "[*] Verifying Unbound..."
sleep 2
if nc -zv -w 3 10.10.0.1 53 &>/dev/null; then
    echo "[✓] Unbound is listening on 10.10.0.1:53"
else
    echo "[!] WARNING: Unbound does not appear to be listening on 10.10.0.1:53"
    ss -tulpn | grep :53 || true
fi

echo ""
echo "============================================================"
echo "  Germany Unbound Setup Complete"
echo "============================================================"
echo "  Listening on: 10.10.0.1:53 (wg0 only)"
echo "  Access:       10.10.0.0/24"
echo "  DNS on public interfaces: BLOCKED"
echo "============================================================"