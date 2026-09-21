#!/usr/bin/env bash

which mtr >/dev/null 2>&1 || apt-get update && apt-get install -y mtr-tiny iputils-ping dnsutils bc >/dev/null 2>&1

echo "================================================================================"
echo "          مقایسه پینگ و پکت‌لاس سرور آلمان در برابر سرور ترکیه                  "
echo "================================================================================"
printf "%-26s | %-16s | %-8s | %-8s | %-8s | %-8s\n" "Endpoint / Region" "IP" "Loss %" "Min(ms)" "Avg(ms)" "Max(ms)"
echo "--------------------------------------------------------------------------------"

TARGETS=(
  "Germany Peer (DE):91.107.169.182"
  "Turkey Peer (TR):93.114.98.75"
)

for ENTRY in "${TARGETS[@]}"; do
    NAME="${ENTRY%%:*}"
    IP="${ENTRY##*:}"

    PING_OUT=$(ping -c 10 -i 0.2 -W 1 "$IP" 2>/dev/null)
    LOSS=$(echo "$PING_OUT" | grep -oP '\d+(?=% packet loss)')
    
    STATS=$(echo "$PING_OUT" | awk -F '=' '/^(rtt|round-trip)/ {print $2}' | awk -F '/' '{print $1, $2, $3}')

    if [ -n "$STATS" ]; then
        MIN=$(echo "$STATS" | awk '{print $1}' | tr -d ' ')
        AVG=$(echo "$STATS" | awk '{print $2}' | tr -d ' ')
        MAX=$(echo "$STATS" | awk '{print $3}' | tr -d ' ')
    else
        MIN="N/A"
        AVG="N/A"
        MAX="N/A"
    fi

    printf "%-26s | %-16s | %-8s | %-8s | %-8s | %-8s\n" "$NAME" "$IP" "${LOSS}%" "$MIN" "$AVG" "$MAX"
done

echo "================================================================================"
echo ""
echo ">>> بررسی مسیر روتینگ و تعداد هاپ‌ها به سمت ترکیه (MTR):"
echo "--------------------------------------------------------------------------------"
mtr -c 5 -r -w 93.114.98.75
