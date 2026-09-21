#!/usr/bin/env bash

# نصب ابزارهای مورد نیاز در صورت عدم وجود
which mtr >/dev/null 2>&1 || apt-get update && apt-get install -y mtr-tiny iputils-ping dnsutils bc >/dev/null 2>&1

echo "================================================================================"
echo "          بررسی و مقایسه پینگ سرورهای آلمان، دبی و لابی‌های Warzone              "
echo "================================================================================"
printf "%-26s | %-16s | %-8s | %-8s | %-8s | %-8s\n" "Endpoint / Region" "IP" "Loss %" "Min(ms)" "Avg(ms)" "Max(ms)"
echo "--------------------------------------------------------------------------------"

TARGETS=(
  "Germany Peer (DE):91.107.169.182"
  "Dubai Peer (UAE):85.234.73.15"
  "Warzone ME (Bahrain AWS):157.175.0.1"
  "Warzone ME (Dubai Core):185.38.149.1"
  "Warzone EU (Frankfurt ATVI):185.34.104.1"
  "Warzone STUN (Demonware EU):$(dig +short genesis.stun.eu.demonware.net | head -n 1)"
)

for ENTRY in "${TARGETS[@]}"; do
    NAME="${ENTRY%%:*}"
    IP="${ENTRY##*:}"

    if [ -z "$IP" ]; then
        printf "%-26s | %-16s | %-8s | %-8s | %-8s | %-8s\n" "$NAME" "DNS Fail" "-" "-" "-" "-"
        continue
    fi

    PING_OUT=$(ping -c 10 -i 0.2 -W 1 "$IP" 2>/dev/null)
    LOSS=$(echo "$PING_OUT" | grep -oP '\d+(?=% packet loss)')
    STATS=$(echo "$PING_OUT" | tail -n 1 | awk -F '/' '{print $4, $5, $6}' 2>/dev/null)

    if [ -n "$STATS" ]; then
        MIN=$(echo "$STATS" | awk '{print $1}')
        AVG=$(echo "$STATS" | awk '{print $2}')
        MAX=$(echo "$STATS" | awk '{print $3}')
    else
        MIN="N/A"
        AVG="N/A"
        MAX="N/A"
    fi

    printf "%-26s | %-16s | %-8s | %-8s | %-8s | %-8s\n" "$NAME" "$IP" "${LOSS}%" "$MIN" "$AVG" "$MAX"
done

echo "================================================================================"
echo ""
echo ">>> بررسی Trombone Routing (آیا ترافیک دبی از فرانکفورت دور می‌زند؟):"
echo "--------------------------------------------------------------------------------"
mtr -c 5 -r -w 85.234.73.15

echo ""
echo ">>> مسیر روتینگ آلمان:"
echo "--------------------------------------------------------------------------------"
mtr -c 5 -r -w 91.107.169.182
