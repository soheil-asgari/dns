#!/bin/bash
# ============================================================
# Automated Setup — Germany (Exit Node / VPS)
# Installs: wireguard, sniproxy, iptables, curl
# Configures sniproxy + WireGuard server + IPv4 forwarding
# ============================================================
set -euo pipefail

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
pkill -f sniproxy 2>/dev/null || true

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

# --- WireGuard server keypair ----------------------------------------------
echo "[*] Generating WireGuard server keypair..."
mkdir -p "${WG_DIR}/keys"
chmod 700 "${WG_DIR}/keys"

wg genkey | tee "${WG_DIR}/keys/server.key" | wg pubkey > "${WG_DIR}/keys/server.pub"
chmod 600 "${WG_DIR}/keys/server.key"

SERVER_PRIV_KEY=$(cat "${WG_DIR}/keys/server.key")

# --- WireGuard server configuration ----------------------------------------
echo "[*] Writing ${WG_CONF}..."
cat > "${WG_CONF}" <<-EOF
[Interface]
Address = ${WG_SUBNET}
ListenPort = ${WG_PORT}
PrivateKey = ${SERVER_PRIV_KEY}
SaveConfig = false

PostUp = iptables -A FORWARD -i %i -j ACCEPT
PostUp = iptables -A FORWARD -o %i -j ACCEPT
PostUp = iptables -t nat -A POSTROUTING -o ${IFACE} -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -j ACCEPT 2>/dev/null || true
PostDown = iptables -D FORWARD -o %i -j ACCEPT 2>/dev/null || true
PostDown = iptables -t nat -D POSTROUTING -o ${IFACE} -j MASQUERADE 2>/dev/null || true

[Peer]
PublicKey = PLACEHOLDER_PEER_KEY
AllowedIPs = ${CLIENT_IP}
EOF

chmod 600 "${WG_CONF}"

# --- Enable & start WireGuard ----------------------------------------------
echo "[*] Enabling and starting wg-quick@wg0..."
systemctl enable wg-quick@wg0
systemctl start wg-quick@wg0

# --- Summary ---------------------------------------------------------------
echo ""
echo "============================================================"
echo "  Germany Exit Node — Setup Complete"
echo "============================================================"
echo ""
echo "  Server Public Key: $(cat ${WG_DIR}/keys/server.pub)"
echo "  Default Interface: ${IFACE}"
echo ""
echo "  NEXT STEP: Copy the public key above and update"
echo "  ${WG_CONF} [Peer] PublicKey with the Iran client's public key."
echo "  Then on the Iran server, set GERMANY_PUB_KEY to this value."
echo "============================================================"