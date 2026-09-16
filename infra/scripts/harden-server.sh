#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# harden-server.sh
# Idempotent security hardening script for Ubuntu 22.04 DNS server
# Target role: Iran DNS server for gaming-dns-service project
#
# Usage:
#   sudo bash harden-server.sh
#
# Manual step (run AFTER verifying SSH key works):
#   sudo bash harden-server.sh --apply-ssh-lockdown
# =============================================================================

# --- CONFIGURABLE VARIABLES --------------------------------------------------

# Placeholder — replace with your actual public key before running
DEPLOY_SSH_PUBLIC_KEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBc3SUoNUM9WUjCwKi3XgyQG7X4iDlToCDPMeLx8XjUd gaming-service-server"

DEPLOY_USER="deploy"
SSH_PORT="2222"
SSH_PORT_NEW="2222"
SSH_PORT_OLD="22"

# --- PREFLIGHT CHECKS --------------------------------------------------------

if [[ $EUID -ne 0 ]]; then
    echo "[!] This script must be run as root (sudo)." >&2
    exit 1
fi

if ! grep -qi "ubuntu" /etc/os-release 2>/dev/null; then
    echo "[!] This script is designed for Ubuntu. Detected:" "$(lsb_release -d 2>/dev/null | cut -f2)" >&2
    exit 1
fi

UBUNTU_VERSION=$(lsb_release -rs 2>/dev/null || echo "unknown")
echo "[*] Detected Ubuntu ${UBUNTU_VERSION}"

# --- HELPER FUNCTIONS --------------------------------------------------------

idempotent_append_line() {
    local file="$1" line="$2"
    grep -qxF "$line" "$file" 2>/dev/null || echo "$line" >> "$file"
}

# === 1. CREATE NON-ROOT DEPLOY USER =========================================

echo ""
echo "=== [1/6] Creating deploy user: ${DEPLOY_USER} ==="

if id "${DEPLOY_USER}" &>/dev/null; then
    echo "[*] User '${DEPLOY_USER}' already exists — skipping creation."
else
    useradd -m -s /bin/bash "${DEPLOY_USER}"
    usermod -aG sudo "${DEPLOY_USER}"
    echo "[✓] User '${DEPLOY_USER}' created with sudo access."
fi

# Ensure sudo group has passwordless sudo (optional, but convenient for automation)
idempotent_append_line /etc/sudoers.d/90-cloud-init-users "${DEPLOY_USER} ALL=(ALL) NOPASSWD:ALL"
chmod 440 /etc/sudoers.d/90-cloud-init-users
echo "[✓] Passwordless sudo ensured for '${DEPLOY_USER}'."

# === 2. DEPLOY SSH AUTHORIZED KEY ============================================

echo ""
echo "=== [2/6] Installing SSH public key for ${DEPLOY_USER} ==="

DEPLOY_SSH_DIR="/home/${DEPLOY_USER}/.ssh"
mkdir -p "${DEPLOY_SSH_DIR}"
chmod 700 "${DEPLOY_SSH_DIR}"

if grep -q "${DEPLOY_SSH_PUBLIC_KEY}" "${DEPLOY_SSH_DIR}/authorized_keys" 2>/dev/null; then
    echo "[*] SSH public key already present — skipping."
else
    echo "${DEPLOY_SSH_PUBLIC_KEY}" >> "${DEPLOY_SSH_DIR}/authorized_keys"
    echo "[✓] SSH public key appended."
fi

chmod 600 "${DEPLOY_SSH_DIR}/authorized_keys"
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${DEPLOY_SSH_DIR}"
echo "[✓] authorized_keys permissions locked down."

# === 3. SSH LOCKDOWN (MANUAL STEP — requires --apply-ssh-lockdown flag) ======

echo ""
echo "=== [3/6] SSH lockdown (manual step) ==="

if [[ "${1:-}" == "--apply-ssh-lockdown" ]]; then
    echo "[*] Applying SSH lockdown..."

    # --- CAUTION: you will be locked out if your SSH key does not work ---
    # Disable root SSH login
    sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
    grep -q "^PermitRootLogin no" /etc/ssh/sshd_config || \
        echo "PermitRootLogin no" >> /etc/ssh/sshd_config
    echo "  [✓] PermitRootLogin set to no."

    # Disable password authentication
    sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
    grep -q "^PasswordAuthentication no" /etc/ssh/sshd_config || \
        echo "PasswordAuthentication no" >> /etc/ssh/sshd_config
    echo "  [✓] PasswordAuthentication set to no."

    # Disable challenge-response (extra protection)
    sed -i 's/^#*ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' /etc/ssh/sshd_config
    grep -q "^ChallengeResponseAuthentication no" /etc/ssh/sshd_config || \
        echo "ChallengeResponseAuthentication no" >> /etc/ssh/sshd_config
    echo "  [✓] ChallengeResponseAuthentication set to no."

    # Disable PAM password auth (where applicable)
    sed -i 's/^#*UsePAM.*/UsePAM no/' /etc/ssh/sshd_config 2>/dev/null || true
    echo "  [✓] UsePAM set to no."

    # Enable public key authentication explicitly
    sed -i 's/^#*PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config
    grep -q "^PubkeyAuthentication yes" /etc/ssh/sshd_config || \
        echo "PubkeyAuthentication yes" >> /etc/ssh/sshd_config
    echo "  [✓] PubkeyAuthentication set to yes."

    # Change SSH port from 22 → 2222
    sed -i 's/^#*Port.*/Port '"${SSH_PORT_NEW}"'/' /etc/ssh/sshd_config
    grep -q "^Port ${SSH_PORT_NEW}" /etc/ssh/sshd_config || \
        echo "Port ${SSH_PORT_NEW}" >> /etc/ssh/sshd_config
    echo "  [✓] SSH port changed to ${SSH_PORT_NEW}."

    # Restart SSH daemon
    systemctl restart sshd
    echo "[✓] sshd restarted. You are now listening on port ${SSH_PORT_NEW}."
    echo ""
    echo "    ⚠  IMPORTANT: Keep your current session open and test"
    echo "       a NEW SSH connection on port ${SSH_PORT_NEW} with your key."
    echo "       Only close this session after confirming connectivity."
else
    echo "[*] SKIPPED: SSH lockdown is manual."
    echo ""
    echo "    To apply SSH lockdown (disable root login, disable password auth,"
    echo "    change port to ${SSH_PORT_NEW}), run:"
    echo ""
    echo "        sudo bash $0 --apply-ssh-lockdown"
    echo ""
    echo "    ⚠  FIRST verify that your SSH key works for user '${DEPLOY_USER}'."
fi

# === 4. INSTALL & CONFIGURE FAIL2BAN ========================================

echo ""
echo "=== [4/6] Installing and configuring fail2ban ==="

if command -v fail2ban-server &>/dev/null; then
    echo "[*] fail2ban already installed — skipping apt install."
else
    apt-get update -qq
    apt-get install -y -qq fail2ban
    echo "[✓] fail2ban installed."
fi

# Write jail.local for SSH on port 2222 (idempotent — always matches desired state)
cat > /etc/fail2ban/jail.local <<'FAIL2BAN_EOF'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5
ignoreip = 127.0.0.1/8 ::1

[sshd]
enabled   = true
port      = 2222
filter    = sshd
logpath   = /var/log/auth.log
maxretry  = 5
bantime   = 3600
FAIL2BAN_EOF

systemctl enable --now fail2ban 2>/dev/null || systemctl restart fail2ban
echo "[✓] fail2ban configured for SSH port ${SSH_PORT_NEW} and running."

# === 5. ENABLE UNATTENDED UPGRADES ==========================================

echo ""
echo "=== [5/6] Enabling unattended-upgrades ==="

if dpkg -s unattended-upgrades &>/dev/null; then
    echo "[*] unattended-upgrades already installed — skipping."
else
    apt-get install -y -qq unattended-upgrades
    echo "[✓] unattended-upgrades installed."
fi

# Ensure automatic updates config is active
dpkg-reconfigure -f noninteractive unattended-upgrades 2>/dev/null || true

CONF_FILE="/etc/apt/apt.conf.d/20auto-upgrades"
cat > "${CONF_FILE}" <<'APT_EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::Verbose "0";
APT_EOF

echo "[✓] unattended-upgrades configured (daily auto-updates)."

# === 6. CONFIGURE UFW FIREWALL ==============================================

echo ""
echo "=== [6/6] Configuring UFW firewall ==="

ufw --force reset 2>/dev/null || true
ufw default deny incoming
ufw default allow outgoing

# SSH (new port)
ufw allow "${SSH_PORT_NEW}/tcp" comment "SSH"

# DNS
ufw allow 53/tcp comment "DNS TCP"
ufw allow 53/udp comment "DNS UDP"

# WireGuard
ufw allow 51820/udp comment "WireGuard"

# Enable UFW (idempotent)
ufw --force enable
echo "[✓] UFW enabled with rules:"
ufw status verbose | head -20

# =============================================================================
echo ""
echo "=== DONE ==="
echo "Server hardening complete (manual SSH lockdown may be pending)."