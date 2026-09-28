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
