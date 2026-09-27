#!/usr/bin/env bash
set -euo pipefail

ip link set eth1 up 2>/dev/null || true
ip route add 185.226.116.0/22 dev eth1 src 185.226.117.62 table 101 2>/dev/null || true
ip route add default via 185.226.116.1 dev eth1 table 101 2>/dev/null || true
ip rule add from 185.226.117.62 lookup 101 2>/dev/null || true
ip route add 185.226.116.0/22 dev eth2 src 185.226.119.97 table 102 2>/dev/null || true
ip route add default via 185.226.116.1 dev eth2 table 102 2>/dev/null || true
ip rule add from 185.226.119.97 lookup 102 2>/dev/null || true