#!/bin/bash
# دوباره‌اجراپذیر (idempotent)
nft delete table inet pbr 2>/dev/null
nft -f - <<'NFT'
table inet pbr {
  chain pre {
    type filter hook prerouting priority mangle; policy accept;
    iifname "eth1" ct state new ct mark set 1
    iifname "eth2" ct state new ct mark set 2
    iifname "br-*" ct mark != 0 meta mark set ct mark
  }
}
NFT
ip rule del fwmark 2 lookup 102 priority 90 2>/dev/null
ip rule del fwmark 1 lookup 101 priority 91 2>/dev/null
ip rule add fwmark 2 lookup 102 priority 90
ip rule add fwmark 1 lookup 101 priority 91

# Local Docker networks MUST stay reachable via their bridge in the PBR tables.
# Otherwise host->container traffic sourced from a public IP is sent out the
# WAN gateway (168.226.116.1) and never reaches the container (breaks port 80
# panel/ip page, and the panel's own outbound calls to backend-api).
for t in 101 102; do
  ip route replace 172.20.0.0/16 dev br-a8b573e48399 table "$t" 2>/dev/null || true
  ip route replace 172.17.0.0/16 dev docker0 table "$t" 2>/dev/null || true
done
