#!/bin/bash
# ============================================================
# Automated Setup — Germany (Exit Node / VPS)
# Installs: wireguard, sniproxy, iptables, curl
# Configures sniproxy + WireGuard server + IPv4 forwarding
# Zero-touch: embedded default keypair, overridable via env vars
# ============================================================
set -euo pipefail

# --- Embedded Default Keypair (Germany Server) ------------------------------
# Override any of these via environment variables:
DEFAULT_GER_PRIVKEY="QNxYIcRlUvXt+OdAVN/87QqqJq++EBvkfhHgvg1aMks="
DEFAULT_GER_PUBKEY="9cqugEj7G9hw8VVbU/3yx5WkTZJ3GKOPsiOwdgoDVjQ="
DEFAULT_IRAN_PUBKEY="/PO1DDkGj5duyWI1TRSn6soUvh2kEiD7Ipj3lxgkr3s="

GER_PRIVKEY="${WG_GER_PRIVKEY:-$DEFAULT_GER_PRIVKEY}"
IRAN_PUBKEY="${WG_IRAN_PUBKEY:-$DEFAULT_IRAN_PUBKEY}"
# --------------------------------------------------------------------------

# --- Configuration ---------------------------------------------------------
WG_DIR="/etc/wireguard"
WG_CONF="${WG_DIR}/wg0.conf"
WG_PORT=51820
WG_SUBNET="10.10.0.1/24"
CLIENT_IP="10.10.0.2/32"
IFACE=$(ip route get 8.8.8.8 | awk '{print $5; exit}')
# --------------------------------------------------------------------------

echo "[*] Updating packages..."
apt-get update -qq

echo "[*] Installing wireguard, sniproxy, iptables, curl..."
apt-get install -y -qq wireguard sniproxy iptables curl

# --- sniproxy configuration ------------------------------------------------
echo "[*] Configuring sniproxy..."
cat > /etc/sniproxy.conf <<-EOF
resolver {
    nameserver 1.1.1.1
    nameserver 8.8.8.8
    mode ipv4_only
}

listener {
    port 443
    proto tls
    table {
        .* *
    }
}
EOF

# Kill any lingering sniproxy zombie processes
echo "[*] Cleaning up zombie sniproxy processes..."
pkill -f sniproxy 2>/dev/null || true
sleep 1

systemctl enable sniproxy
systemctl restart sniproxy

# --- Enable IPv4 forwarding (persistent) -----------------------------------
echo "[*] Enabling IPv4 forwarding..."
sysctl -w net.ipv4.ip_forward=1
if grep -q '^net.ipv4.ip_forward' /etc/sysctl.conf; then
    sed -i 's/^net.ipv4.ip_forward.*/net.ipv4.ip_forward=1/' /etc/sysctl.conf
else
    echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf
fi

# --- WireGuard server configuration ----------------------------------------
echo "[*] Writing ${WG_CONF}..."
mkdir -p "${WG_DIR}"
cat > "${WG_CONF}" <<-EOF
[Interface]
Address = ${WG_SUBNET}
ListenPort = ${WG_PORT}
PrivateKey = ${GER_PRIVKEY}
SaveConfig = false

PostUp = iptables -A FORWARD -i %i -j ACCEPT
PostUp = iptables -A FORWARD -o %i -j ACCEPT
PostUp = iptables -t nat -A POSTROUTING -o ${IFACE} -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -j ACCEPT 2>/dev/null || true
PostDown = iptables -D FORWARD -o %i -j ACCEPT 2>/dev/null || true
PostDown = iptables -t nat -D POSTROUTING -o ${IFACE} -j MASQUERADE 2>/dev/null || true

[Peer]
PublicKey = ${IRAN_PUBKEY}
AllowedIPs = ${CLIENT_IP}
EOF

chmod 600 "${WG_CONF}"

# --- Enable & start WireGuard ----------------------------------------------
echo "[*] Enabling and starting wg-quick@wg0..."
systemctl enable wg-quick@wg0
systemctl restart wg-quick@wg0

# --- Self-check ------------------------------------------------------------
echo ""
echo "[*] Running self-check..."

# Check 1: wg0 interface UP
if ip link show wg0 &>/dev/null; then
    echo "  [PASS] wg0 interface is UP"
else
    echo "  [FAIL] wg0 interface not found!"
fi

# Check 2: port 443 listening locally
if nc -zv -w 3 127.0.0.1 443 &>/dev/null; then
    echo "  [PASS] Port 443 is listening"
else
    echo "  [WARN] Port 443 not listening — check sniproxy status"
fi

# --- Summary ---------------------------------------------------------------
echo ""
echo "============================================================"
echo "  Germany Exit Node — Setup Complete"
echo "============================================================"
echo ""
echo "  Server Private Key: ${GER_PRIVKEY}"
echo "  Server Public Key:  ${DEFAULT_GER_PUBKEY}"
echo "  Iran Peer Public:   ${IRAN_PUBKEY}"
echo "  Default Interface:  ${IFACE}"
echo "============================================================"