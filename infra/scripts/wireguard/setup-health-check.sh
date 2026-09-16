#!/bin/bash
# ============================================================
# Installer for health-check.sh — systemd timer (every 60s)
# Run this ON THE IRAN SERVER after wg0 is up.
# ============================================================
set -euo pipefail

SCRIPT_SRC="./health-check.sh"
SCRIPT_DST="/usr/local/bin/wg-health-check.sh"
TIMER_NAME="wg-health-check"
SERVICE_FILE="/etc/systemd/system/${TIMER_NAME}.service"
TIMER_FILE="/etc/systemd/system/${TIMER_NAME}.timer"
LOG_FILE="/var/log/wg-health.log"

echo "[*] Copying health-check script to ${SCRIPT_DST} ..."
cp "$SCRIPT_SRC" "$SCRIPT_DST"
chmod 755 "$SCRIPT_DST"

echo "[*] Creating ${TIMER_NAME}.service ..."
cat > "$SERVICE_FILE" <<-EOF
[Unit]
Description=WireGuard health check — ping Germany tunnel
After=network.target
Wants=wg-quick@wg0.service

[Service]
Type=oneshot
ExecStart=${SCRIPT_DST}
EOF

echo "[*] Creating ${TIMER_NAME}.timer (every 60s) ..."
cat > "$TIMER_FILE" <<-EOF
[Unit]
Description=Run wg-health-check every 60 seconds
After=wg-quick@wg0.service

[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
Unit=${TIMER_NAME}.service

[Install]
WantedBy=timers.target
EOF

echo "[*] Creating log file ..."
touch "$LOG_FILE"
chmod 640 "$LOG_FILE"

echo "[*] Enabling and starting timer ..."
systemctl daemon-reload
systemctl enable "${TIMER_NAME}.timer"
systemctl start  "${TIMER_NAME}.timer"

echo ""
echo "============================================================"
echo "  Health check installed"
echo "============================================================"
echo "  Timer:    ${TIMER_NAME}.timer"
echo "  Service:  ${TIMER_NAME}.service"
echo "  Script:   ${SCRIPT_DST}"
echo "  Log:      ${LOG_FILE}"
echo ""
echo "  Status:   systemctl status ${TIMER_NAME}.timer"
echo "  Logs:     tail -f ${LOG_FILE}"
echo "============================================================"