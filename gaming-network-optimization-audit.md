# 📋 Audit Report — Gaming Network Optimization Suggestions

> بررسی تطبیق پیشنهادات [`gaming-network-optimization.md`](gaming-network-optimization.md:1) با وضعیت فعلی پروژه

---

## 1. تنظیمات کرنل (sysctl)

| ردیف | پیشنهاد | وضعیت | فایل |
|------|---------|--------|------|
| 1 | BBR congestion control | ✅ انجام شده | [`scripts/optimize-network.sh:25`](scripts/optimize-network.sh:25) |
| 2 | TCP Fast Open (TFO) | ✅ انجام شده | [`scripts/optimize-network.sh:31`](scripts/optimize-network.sh:31) |
| 3 | `tcp_tw_reuse` | ✅ انجام شده | [`scripts/optimize-network.sh:33`](scripts/optimize-network.sh:33) |
| 4 | `tcp_slow_start_after_idle=0` | ✅ انجام شده | [`scripts/optimize-network.sh:32`](scripts/optimize-network.sh:32) |
| 5 | Socket buffer 128MB | ✅ انجام شده | [`scripts/optimize-network.sh:38-39`](scripts/optimize-network.sh:38) |
| 6 | UDP buffer (rmem_default=262144) | ✅ انجام شده | [`scripts/optimize-network.sh:44-45`](scripts/optimize-network.sh:44) |
| 7 | `netdev_budget=600` | ✅ انجام شده | [`scripts/optimize-network.sh:61`](scripts/optimize-network.sh:61) |
| 8 | `netdev_budget_usecs=8000` | ✅ انجام شده | [`scripts/optimize-network.sh:62`](scripts/optimize-network.sh:62) |
| 9 | `netdev_max_backlog=5000` | ✅ انجام شده | [`scripts/optimize-network.sh:63`](scripts/optimize-network.sh:63) |
| 10 | `tcp_mtu_probing=1` | ✅ انجام شده | [`scripts/optimize-network.sh:68`](scripts/optimize-network.sh:68) |
| 11 | keepalive (60/10/3) | ✅ انجام شده | [`scripts/optimize-network.sh:73-75`](scripts/optimize-network.sh:73) |
| 12 | `tcp_notsent_lowat=131072` | ✅ انجام شده | [`scripts/optimize-network.sh:85`](scripts/optimize-network.sh:85) |
| 13 | `tcp_fin_timeout=15` | ✅ انجام شده | [`scripts/optimize-network.sh:80`](scripts/optimize-network.sh:80) |
| 14 | conntrack tuning (max, timeouts) | ✅ انجام شده | [`scripts/optimize-network.sh:90-93`](scripts/optimize-network.sh:90) |
| **15** | **`disable_ipv6`** | **❌ انجام نشده** | — |
| **16** | **`tcp_bbr2` (کرنل ≥ 5.19)** | **❌ انجام نشده** | — |

---

## 2. Traffic Control & QoS

| ردیف | پیشنهاد | وضعیت | فایل |
|------|---------|--------|------|
| 1 | `fq_codel` qdisc | ✅ انجام شده | [`scripts/optimize-network.sh:122`](scripts/optimize-network.sh:122), [`infra/systemd/tc-qdisc.service:9`](infra/systemd/tc-qdisc.service:9) |
| 2 | `meta mark` (0x1 DNS, 0x2 gaming) | ✅ انجام شده | [`infra/nftables/dns-filter.nft:73-77`](infra/nftables/dns-filter.nft:73) |
| 3 | DSCP EF (0x2E) برای گیمینگ | ✅ انجام شده | [`infra/nftables/dns-filter.nft:84`](infra/nftables/dns-filter.nft:84) |
| 4 | DSCP AF21 (0x12) برای DNS | ✅ انجام شده | [`infra/nftables/dns-filter.nft:86-88`](infra/nftables/dns-filter.nft:86) |
| **5** | **`prio bands 3` + `fw flowid` (tc filter)** | **❌ انجام نشده** | — |

---

## 3. WireGuard Tuning

| ردیف | پیشنهاد | وضعیت | فایل |
|------|---------|--------|------|
| 1 | `PersistentKeepalive=20` (کاهش از 25) | ✅ انجام شده | [`setup-germany-server.sh:55`](infra/scripts/wireguard/setup-germany-server.sh:55), [`setup-iran-client.sh:60`](infra/scripts/wireguard/setup-iran-client.sh:60) |
| 2 | MTU=1412 | ✅ انجام شده | [`setup-iran-client.sh:62`](infra/scripts/wireguard/setup-iran-client.sh:62) |
| **3** | **RSS/smp_affinity توزیع IRQ** | **❌ انجام نشده** | — |

---

## 4. HAProxy Optimization

| ردیف | پیشنهاد | وضعیت | فایل |
|------|---------|--------|------|
| 1 | `maxconn 10000` | ✅ انجام شده | [`proxy-server/haproxy.cfg:6`](proxy-server/haproxy.cfg:6) |
| 2 | `nbthread 4` | ✅ انجام شده | [`proxy-server/haproxy.cfg:7`](proxy-server/haproxy.cfg:7) |
| 3 | `tune.bufsize 16384` | ✅ انجام شده | [`proxy-server/haproxy.cfg:12`](proxy-server/haproxy.cfg:12) |
| 4 | `tune.ssl.cachesize 50000` | ✅ انجام شده | [`proxy-server/haproxy.cfg:13`](proxy-server/haproxy.cfg:13) |
| 5 | `timeout connect 2000ms` | ✅ انجام شده | [`proxy-server/haproxy.cfg:28`](proxy-server/haproxy.cfg:28) |
| 6 | `timeout client 30000ms` | ✅ انجام شده | [`proxy-server/haproxy.cfg:29`](proxy-server/haproxy.cfg:29) |
| 7 | `timeout server 30000ms` | ✅ انجام شده | [`proxy-server/haproxy.cfg:30`](proxy-server/haproxy.cfg:30) |
| 8 | `timeout http-keep-alive 10s` | ✅ انجام شده | [`proxy-server/haproxy.cfg:31`](proxy-server/haproxy.cfg:31) |
| 9 | `gaming_sni` frontend با 13 ACL بازی | ✅ انجام شده | [`proxy-server/haproxy.cfg:37-62`](proxy-server/haproxy.cfg:37) |
| 10 | `gaming_priority` backend با health check سریع | ✅ انجام شده | [`proxy-server/haproxy.cfg:67-74`](proxy-server/haproxy.cfg:67) |
| 11 | `balance leastconn` + `option tcpka` | ✅ انجام شده | [`proxy-server/haproxy.cfg:69,73,81,85`](proxy-server/haproxy.cfg:69) |
| **12** | **`tune.tcpfastopen 3`** | **❌ انجام نشده** | — |

---

## 5. CoreDNS & DNS Optimization

| ردیف | پیشنهاد | وضعیت | فایل |
|------|---------|--------|------|
| 1 | `cache` با `prefetch 30 30s 25%` | ✅ انجام شده | [`dns-server/Corefile:12-17`](dns-server/Corefile:12) |
| 2 | `serve_stale 1h` | ✅ انجام شده | [`dns-server/Corefile:16`](dns-server/Corefile:16) |
| 3 | `forward` policy `sequential` | ✅ انجام شده | [`dns-server/Corefile:19-24`](dns-server/Corefile:19) |
| 4 | `health_check 5s` | ✅ انجام شده | [`dns-server/Corefile:21`](dns-server/Corefile:21) |
| 5 | `max_concurrent 4000` | ✅ انجام شده | [`dns-server/Corefile:22`](dns-server/Corefile:22) |
| 6 | `expire 10s` | ✅ انجام شده | [`dns-server/Corefile:23`](dns-server/Corefile:23) |
| 7 | اولویت 1.1.1.1 (Cloudflare) | ✅ انجام شده | [`dns-server/Corefile:19`](dns-server/Corefile:19) |
| **8** | **Unbound/dnsmasq لوکال روی Iran-Client** | **❌ انجام نشده** | — |

---

## 6. Netfilter / nftables

| ردیف | پیشنهاد | وضعیت | فایل |
|------|---------|--------|------|
| 1 | Rate limiting DNS (1000/second) | ✅ انجام شده | [`infra/nftables/dns-filter.nft:18-19`](infra/nftables/dns-filter.nft:18) |
| 2 | Conntrack max=262144 | ✅ انجام شده | [`scripts/optimize-network.sh:90`](scripts/optimize-network.sh:90) |
| 3 | DSCP EF (0x2E) برای گیمینگ | ✅ انجام شده | [`infra/nftables/dns-filter.nft:84`](infra/nftables/dns-filter.nft:84) |
| 4 | DSCP AF21 (0x12) برای DNS | ✅ انجام شده | [`infra/nftables/dns-filter.nft:86-88`](infra/nftables/dns-filter.nft:86) |

---

## 7. XDP / eBPF

| پیشنهاد | وضعیت |
|---------|--------|
| تمام پیشنهادات XDP (katran, xdp-forward) | ⏸️ اختیاری — در مستند ذکر شده اما پیاده‌سازی نشده و برای مقیاس بالا توصیه شده |

---

## 8. Monitoring & Observability

| ردیف | پیشنهاد | وضعیت | فایل |
|------|---------|--------|------|
| 1 | node-exporter در docker-compose | ✅ انجام شده | [`docker-compose.yml:165-174`](docker-compose.yml:165) |
| 2 | MTR, tcpdump, tc statistics | 📌 ابزارهای runtime — نیاز به اجرای دستی |

---

## 9. سناریوی آزمایشی (Quick Wins)

| قدم | وضعیت | توضیح |
|-----|--------|-------|
| قدم 1 — Immediate | ✅ انجام شده | sysctl های جدید + fq_codel در [`scripts/optimize-network.sh`](scripts/optimize-network.sh:21-122) |
| قدم 2 — Medium | ✅ انجام شده | nftables DSCP EF, HAProxy tuning, CoreDNS serve_stale |
| قدم 3 — Advanced | ⏸️ بخشی انجام شده | node-exporter اضافه شده، XDP و gaming backend اختصاصی انجام شده |

---

## خلاصه نهایی

| دسته | کل پیشنهادات | ✅ انجام شده | ❌ انجام نشده |
|------|:-----------:|:-----------:|:------------:|
| 1. sysctl | 16 | 14 | **2** |
| 2. QoS | 5 | 4 | **1** |
| 3. WireGuard | 3 | 2 | **1** |
| 4. HAProxy | 12 | 11 | **1** |
| 5. CoreDNS | 8 | 7 | **1** |
| 6. nftables | 4 | 4 | **0** |
| 7. XDP/eBPF | — | ⏸️ اختیاری | — |
| 8. Monitoring | 1 | 1 | **0** |
| **مجموع** | **~49** | **~43** | **~6** |

---

## ❌ موارد باقی‌مانده (6 پیشنهاد)

| # | پیشنهاد | اولویت | سختی | فایل هدف پیشنهادی |
|---|---------|--------|------|-------------------|
| 1 | `disable_ipv6` | 🟢 کم | 🔵 آسان | [`scripts/optimize-network.sh`](scripts/optimize-network.sh) |
| 2 | `tcp_bbr2` (if kernel ≥ 5.19) | 🟢 کم | 🔵 آسان | [`scripts/optimize-network.sh`](scripts/optimize-network.sh) |
| 3 | `prio bands 3` + tc filter | 🟠 متوسط | 🟡 متوسط | [`infra/scripts/dns-pbr-apply.sh`](infra/scripts/dns-pbr-apply.sh) یا systemd unit جدید |
| 4 | `tune.tcpfastopen 3` در HAProxy | 🟠 متوسط | 🔵 آسان | [`proxy-server/haproxy.cfg`](proxy-server/haproxy.cfg) |
| 5 | RSS/smp_affinity برای WireGuard IRQ | 🟢 کم | 🔵 آسان | systemd unit یا اسکریپت جداگانه |
| 6 | Unbound/dnsmasq لوکال روی Iran-Client | 🟢 کم | 🟡 متوسط | [`docker-compose.yml`](docker-compose.yml) + [`dns-server/Corefile`](dns-server/Corefile) |

---

> **تاریخ audit**: 2026-09-27  
> **وضعیت کلی**: ~88% از پیشنهادات اعمال شده‌اند. 6 پیشنهاد کم‌ریسک باقی‌مانده که پیاده‌سازی آنها توصیه می‌شود.