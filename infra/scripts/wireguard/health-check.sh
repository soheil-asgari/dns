#!/bin/bash
# ============================================================
# WireGuard Health Check — run every 60s via systemd timer
# Pings the remote tunnel endpoint and restarts wg0 on failure
# Log: /var/log/wg-health.log
# ============================================================
set -euo pipefail

TUNNEL_INTERFACE="wg0"
REMOTE_IP="10.10.0.1"       # Germany server tunnel IP
LOG_FILE="/var/log/wg-health.log"
TIMEOUT_SEC=5

log() {
    local level="$1"
    local msg="$2"
    echo "[$(date '+%Y-%m-%d %H:%M:%S %z')] [${level}] ${msg}" >> "$LOG_FILE"
}

if ! ping -c 1 -W "$TIMEOUT_SEC" "$REMOTE_IP" &>/dev/null; then
    log "WARN" "Ping to ${REMOTE_IP} failed. Restarting ${TUNNEL_INTERFACE} ..."
    systemctl restart "wg-quick@${TUNNEL_INTERFACE}" 2>>"$LOG_FILE"
    sleep 2
    if ping -c 1 -W "$TIMEOUT_SEC" "$REMOTE_IP" &>/dev/null; then
        log "OK"   "${TUNNEL_INTERFACE} restarted successfully — ping to ${REMOTE_IP} OK"
    else
        log "FAIL" "${TUNNEL_INTERFACE} restart did NOT restore connectivity to ${REMOTE_IP}"
    fi
else
    log "OK"   "Ping to ${REMOTE_IP} succeeded"
fi