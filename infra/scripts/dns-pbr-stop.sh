#!/usr/bin/env bash
set -euo pipefail

ip rule del from 185.226.117.62 2>/dev/null || true
ip rule del from 185.226.119.97 2>/dev/null || true
ip route flush table 101 2>/dev/null || true
ip route flush table 102 2>/dev/null || true