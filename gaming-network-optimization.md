# 🎮 بهینه‌سازی شبکه برای بازی — کاهش پینگ و پکت‌لاست

> بررسی پروژه `dns-infra` و پیشنهادات بهبود برای افزایش سرعت بازی، کاهش پینگ (Latency) و کاهش Packet Loss.

---

## فهرست

1. [🔧 تنظیمات کرنل (sysctl)](#1-تنظیمات-کرنل-sysctl)
2. [🌐 Traffic Control & QoS](#2-traffic-control--qos)
3. [📡 WireGuard Tuning](#3-wireguard-tuning)
4. [🔄 HAProxy Optimization](#4-haproxy-optimization)
5. [🧠 CoreDNS & DNS Optimization](#5-coredns--dns-optimization)
6. [🛡️ Netfilter / nftables](#6-netfilter--nftables)
7. [⚡ XDP / eBPF](#7-xdp--ebpf)
8. [📊 Monitoring & Observability](#8-monitoring--observability)
9. [🧪 سناریوی آزمایشی (Quick Wins)](#9-سناریوی-آزمایشی-quick-wins)

---

## 1. تنظیمات کرنل (sysctl)

فایل فعلی: [`scripts/optimize-network.sh`](scripts/optimize-network.sh)

### وضعیت موجود
- ✅ BBR congestion control
- ✅ TCP Fast Open (TFO)
- ✅ TCP `tw_reuse`
- ✅ `tcp_slow_start_after_idle=0`
- ✅ Bufferهای بزرگ (128MB)

### پیشنهادات اضافه

```bash
# ==========================================
# UDP tuning (برای گیمینگ بحرانی‌ست)
# ==========================================
# حداکثر بافر دریافتی UDP
net.core.rmem_default = 262144
net.core.rmem_max = 134217728

# Netdev budget (تعداد پکت‌های پردازش شده در هر softirq)
net.core.netdev_budget = 600
net.core.netdev_budget_usecs = 8000

# backlog ورودی网络
net.core.netdev_max_backlog = 5000

# ==========================================
# TCP advanced
# ==========================================
# فعال‌سازی TCP MTU probing (جلوگیری از fragmentation)
net.ipv4.tcp_mtu_probing = 1

# کاهش Keepalive time (شناسایی سریع اتصال مرده)
net.ipv4.tcp_keepalive_time = 60
net.ipv4.tcp_keepalive_intvl = 10
net.ipv4.tcp_keepalive_probes = 3

# TCP NotSent Lowat — کاهش لِیتنسی ارسال
net.ipv4.tcp_notsent_lowat = 131072

# ==========================================
# IPv6 (اگر استفاده نمی‌شود، غیرفعال شود)
# ==========================================
net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1

# ==========================================
# Reducing TIME_WAIT impact
# ==========================================
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_tw_reuse = 1
```

### اولویت: 🔴 بالا
> BBR در کرنل‌های جدید با ` pacing` ترکیب شود. اگر کرنل ≥ 5.19 است از `tcp_bbr2` استفاده کنید.

---

## 2. Traffic Control & QoS

وضعیت فعلی: فقط [`infra/nftables/dns-filter.nft`](infra/nftables/dns-filter.nft) یک `dscp` ساده دارد.

### 2.1. Active Queue Management (fq_codel / cake)

```bash
# جایگزین qdisc پیش‌فرض (pfifo_fast) با fq_codel
# fq_codel به صورت خودکار لِیتنسی را برای ترافیک تعاملی کم می‌کند
tc qdisc replace dev eth0 root fq_codel

# برای link با سرعت پایین (< 100Mbps) از cake با overhead تنظیم شده استفاده کنید
tc qdisc replace dev eth0 root cake bandwidth 100mbit diffserv4 nat wash
```

### 2.2. Prioritization با tc + nftables

```bash
# ==========================================
# 1. ایجاد سه band: High (گیمینگ), Medium (DNS), Low (بقیه)
# ==========================================
tc qdisc add dev eth0 root handle 1: prio bands 3 priomap 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2

# Band 0: High priority (گیمینگ) - DSCP CS4
tc qdisc add dev eth0 parent 1:1 handle 10: fq_codel
# Band 1: Medium priority (DNS)
tc qdisc add dev eth0 parent 1:2 handle 20: fq_codel
# Band 2: Best effort
tc qdisc add dev eth0 parent 1:3 handle 30: fq_codel

# ==========================================
# 2. فیلتر: پکت‌های با مارک 0x2 (گیمینگ) به band 0
# ==========================================
tc filter add dev eth0 parent 1:0 protocol ip prio 1 handle 0x2 fw flowid 1:1
# پکت‌های DNS (مارک 0x1) به band 1
tc filter add dev eth0 parent 1:0 protocol ip prio 2 handle 0x1 fw flowid 1:2
```

### 2.3. به‌روزرسانی nftables برای هماهنگی با tc

در [`infra/nftables/dns-filter.nft`](infra/nftables/dns-filter.nft) خطوط فعلی `meta mark set 0x1` و `0x2` درست هستند، اما باید `ip dscp` را نیز ست کنید:

```nftables
# به جای ip dscp set 0x20 (CS4)، از DSCP EF (0x2E) برای گیمینگ استفاده کنید
# که در مسیریاب‌های اینترنتی优先یت بالاتری دارد
tcp dport {443, 80} ip dscp set 0x2E
```

> **نکته**: DSCP EF (46) معمولاً توسط ISPها優先یت داده می‌شود. اما بعضی ISPها آن را ریست می‌کنند — در این صورت فقط از `meta mark` استفاده کنید.

### اولویت: 🟠 متوسط
> `fq_codel` به تنهایی می‌تواند لِیتنسی را 30-50% در links با congestion کاهش دهد.

---

## 3. WireGuard Tuning

فایل‌های فعلی:
- [`infra/scripts/wireguard/setup-germany-server.sh`](infra/scripts/wireguard/setup-germany-server.sh)
- [`infra/scripts/wireguard/setup-iran-client.sh`](infra/scripts/wireguard/setup-iran-client.sh)

### 3.1. کاهش PersistentKeepalive

حالت فعلی: `PersistentKeepalive = 25`

```ini
# برای کاهش overhead در سناریوهای گیمینگ:
PersistentKeepalive = 20
# یا اگر NAT قوی دارید: 15
```

### 3.2. MTU بهینه

```ini
# WireGuard MTU استاندارد: 1420 (Ethernet 1500 - 60 (IP+UDP) - 20 (WireGuard))
# اگر ISP شما PPPoE دارد: 1412
# اگر ISP شما MTU پایین‌تری دارد:
[Interface]
MTU = 1412
```

### 3.3. RSS (Receive Side Scaling) برای WireGuard

WireGuard روی CPU0 می‌افتد. اگر چند هسته دارید:

```bash
# توزیع IRQهای WireGuard بین هسته‌ها
# ابتدا پیدا کنید کدام IRQ متعلق به WG است
IRQ_LINE=$(grep wg0 /proc/interrupts | awk '{print $1}' | tr -d :)
echo 2 > /proc/irq/$IRQ_LINE/smp_affinity  # CPU 1

# یا برای توزیع خودکار:
# در صورت استفاده از systemd، cpu affinity را تنظیم کنید:
# IRQBALANCE_BANNED_CPUS=1 irqbalance (CPU 0 رو بذار برای WG)
```

### 3.4. کاهش Handshake Interval

WireGuard handshake هر 2 دقیقه انجام می‌شود. برای پایداری بیشتر:

```ini
# در Germany server:
[Peer]
PersistentKeepalive = 20
# کاهش handshake interval پیش‌فرض (مخفی):
# این کار در کد WireGuard قابل تنظیم نیست، اما می‌توانید از wg show استفاده کنید
```

### اولویت: 🟢 کم
> WireGuard خودش overlay بسیار بهینه‌ای است. نکات بالا در شرایط خاص مفیدند.

---

## 4. HAProxy Optimization

فایل فعلی: [`proxy-server/haproxy.cfg`](proxy-server/haproxy.cfg)

### 4.1. Tuning Timeout

حالت فعلی:

```haproxy
timeout connect 5000ms
timeout client  50000ms
timeout server  50000ms
```

پیشنهاد:

```haproxy
global
    # افزایش maxconn
    maxconn 10000
    # فعال‌سازی nbthread (تعداد هسته‌های CPU)
    nbthread 4
    # pool برای reuse bufferها
    tune.bufsize 16384
    tune.ssl.cachesize 50000

defaults
    # کاهش timeouts برای گیمینگ
    timeout connect 2000ms
    timeout client  30000ms
    timeout server  30000ms
    timeout http-keep-alive 10s
    # فعال‌سازی TCP Fast Open در HAProxy
    tune.tcpfastopen 3
```

### 4.2. Backend تنظیمات (گیمینگ)

```haproxy
backend backend_germany_sni
    mode tcp
    # کاهش timeout check و inter
    timeout check 5s
    timeout server 1h
    timeout tunnel 1h
    # active health check با سرعت بالاتر
    option tcp-check
    server germany_peer 10.10.0.1:443 check inter 2s fall 3 rise 2
    # keepalive برای TCP connections
    option tcpka
```

### 4.3. افزودن Backend گیمینگ اختصاصی با اولویت بالاتر

```haproxy
frontend gaming_sni
    bind *:443
    mode tcp
    option tcplog
    tcp-request inspect-delay 2s
    tcp-request content accept if { req_ssl_hello_type 1 }
    timeout client 1h
    
    # شناسایی SNI بازی‌های معروف و ارسال به backend اختصاصی
    acl is_valorant   req_ssl_sni -i valorant.com
    acl is_league     req_ssl_sni -i leagueoflegends.com
    acl is_fortnite   req_ssl_sni -i fortnite.com
    acl is_csgo       req_ssl_sni -i steam.com
    
    use_backend gaming_priority if is_valorant or is_league or is_fortnite or is_csgo
    default_backend backend_germany_sni

backend gaming_priority
    mode tcp
    option tcpka
    timeout server 1h
    timeout tunnel 1h
    # اولویت بالاتر (استفاده از leastconn)
    balance leastconn
    server germany_peer 10.10.0.1:443 check inter 1s fall 2 rise 1 weight 20
```

### اولویت: 🟠 متوسط
> کاهش `timeout connect` و فعال‌سازی `tune.tcpfastopen` تأثیر محسوسی در گیمینگ دارد.

---

## 5. CoreDNS & DNS Optimization

فایل فعلی: [`dns-server/Corefile`](dns-server/Corefile)

### 5.1. افزایش Cache و Prefetch

```corefile
cache 3600 {
    success 3600
    denial 60
    prefetch 30 30s 25%
    serve_stale 1h
}
```

- `prefetch 30`: تا 30 domain محبوب را قبل از انقضا دوباره بکش
- `serve_stale`: اگر DNS upstream جواب نداد، از cache منقضی شده استفاده کن

### 5.2. Upstream انتخاب هوشمندتر

```corefile
forward . 8.8.8.8 1.1.1.1 9.9.9.9 {
    policy sequential  # sequential -> اولی اگر جواب داد بعدی رو صدا نزن
    # یا
    policy first
    health_check 5s
    max_concurrent 4000
    expire 10s
    # enforce prefer 1.1.1.1 (Cloudflare) برای latency کمتر در ایران
    prefer 1.1.1.1
}
```

> **توصیه**: در ایران Cloudflare (1.1.1.1) معمولاً لِیتنسی کمتری نسبت به Google (8.8.8.8) دارد.

### 5.3. افزودن DNS Cache لوکال (وایرگارد)

می‌توانید یک `Unbound` یا `dnsmasq` سبک روی Iran-Client نصب کنید تا DNS queries از WayireGuard عبور نکند:

```yaml
# docker-compose.yml
unbound:
  image: mvance/unbound:latest
  ports:
    - "127.0.0.1:53:53/udp"
  volumes:
    - ./infra/dns/unbound.conf:/opt/unbound/unbound.conf:ro
  restart: unless-stopped
  networks:
    dns-net:
      ipv4_address: 172.20.0.20
```

سپس در ایران-کلاینت `/etc/resolv.conf` را به 172.20.0.20 تنظیم کنید تا ابتدا کش محلی چک شود.

### اولویت: 🟢 کم
> DNS latency تأثیر دارد اما نه به اندازه خود لِیتنسی شبکه.

---

## 6. Netfilter / nftables

فایل فعلی: [`infra/nftables/dns-filter.nft`](infra/nftables/dns-filter.nft)

### 6.1. افزودن Rate Limiting برای UDP

```nftables
# جلوگیری از flood روی DNS
table inet filter {
    chain input {
        # Rate limit UDP DNS queries per IP
        tcp dport 53 ct state new limit rate 1000/second accept
        udp dport 53 ct state new limit rate 1000/second
    }
}
```

### 6.2. Conntrack بهینه‌سازی

```bash
# افزایش conntrack table size (پیش‌فرض 65536)
net.netfilter.nf_conntrack_max = 262144
net.netfilter.nf_conntrack_tcp_timeout_established = 432000
net.netfilter.nf_conntrack_udp_timeout = 30
net.netfilter.nf_conntrack_udp_timeout_stream = 120
```

### 6.3. افزودن DSCP EF به جای CS4

```nftables
table inet gaming {
    chain dscp {
        type filter hook output priority -150; policy accept
        
        # Gaming traffic -> DSCP EF (46, 0x2E)
        tcp dport {443, 80} ip dscp set 0x2E
        # DNS -> DSCP AF21 (18, 0x12)
        udp dport 53 ip dscp set 0x12
    }
}
```

### اولویت: 🟠 متوسط
> `conntrack` tuning در سرورهای با ترافیک بالا ضروری است.

---

## 7. XDP / eBPF

اگر کرنل >= 5.10 دارید، می‌توانید با XDP پکت‌ها را قبل از ورود به Network Stack پردازش کنید:

### 7.1. XDP-based Load Balancer

```bash
# نصب katran (XDP load balancer از فیسبوک)
# یا استفاده از xdp-tools
git clone https://github.com/xdp-project/xdp-tools
cd xdp-tools
./configure && make && make install

# نصب xdp-loader
xdp-loader load eth0 xdp-dispatcher.o
```

### 7.2. جایگزینی HAProxy با XDP برای TCP Passthrough

برای ترافیک 443 گیمینگ، `XDP_TX` می‌تواند پکت‌ها را بدون عبور از Kernel stack فوروارد کند:

```c
// xdp_forward.c - ساده‌ترین XDP forwarder
// پکت‌های TCP 443 را مستقیماً به 10.10.0.1 فوروارد می‌کند
// این کار لِیتنسی را تا 50% کاهش می‌دهد
```

> **اما**: XDP پیچیدگی عملیاتی دارد و در این پروژه HAProxy با `mode tcp` کافی‌ست.

### اولویت: 🔵 پایین (Advanced)
> برای پروژه‌های با scale بالا.

---

## 8. Monitoring & Observability

### 8.1. MTR (سابق WinMTR) — رایگان و سریع

```bash
# نصب
apt install mtr-tiny

# استفاده: latency real-time به Germany
mtr -4 -r -c 100 10.10.0.1
mtr -4 -r -c 100 185.226.119.97
```

### 8.2. Tcpdump برای شناسایی پکت‌لاست

```bash
# مانیتورینگ packet loss در WireGuard
tcpdump -i wg0 -n udp port 51820

# بررسی retransmission
tcpdump -i eth0 -n tcp and port 443 | grep -i "retransmission"
tcpdump -i eth0 -n "icmp and icmp[icmptype] == icmp-unreach"
```

### 8.3. استفاده از `tc` برای دیدن statistics

```bash
# مشاهده packet drops در qdisc
tc -s qdisc show dev eth0

# مشاهده statistics per band
tc -s class show dev eth0
```

### 8.4. Prometheus + Grafana

CoreDNS از قبل متریک‌های Prometheus روی پورت 9153 دارد:

- `coredns_dns_request_count_total`
- `coredns_dns_request_duration_seconds`
- `coredns_cache_hits_total`
- `coredns_cache_misses_total`

افزودن متریک‌های شبکه به [`docker-compose.yml`](docker-compose.yml):

```yaml
node-exporter:
  image: prom/node-exporter:latest
  network_mode: host
  pid: host
  volumes:
    - /proc:/host/proc:ro
    - /sys:/host/sys:ro
  environment:
    - NODE_ID=iran-dns
  restart: unless-stopped
```

### اولویت: 🟢 کم
> برای دیباگ کاهش پینگ و شناسایی مشکل، MTR اولین ابزاری است که باید اجرا کنید.

---

## 9. سناریوی آزمایشی (Quick Wins)

### ✅ قدم 1 — Immediate (بدون ریسک)

```bash
# 1. اعمال sysctl های جدید
cat >> /etc/sysctl.d/99-dns-gaming-optimizations.conf << 'EOF'
net.core.netdev_budget = 600
net.core.netdev_budget_usecs = 8000
net.core.netdev_max_backlog = 5000
net.ipv4.tcp_mtu_probing = 1
net.ipv4.tcp_notsent_lowat = 131072
net.ipv4.tcp_fin_timeout = 15
EOF
sysctl -p /etc/sysctl.d/99-dns-gaming-optimizations.conf

# 2. تغییر qdisc به fq_codel
tc qdisc replace dev eth0 root fq_codel

# 3. MTR test
mtr -4 -r -c 50 185.226.119.97 > /tmp/mtr-before.txt
```

### ✅ قدم 2 — Medium (یک روزه)

```bash
# 1. به‌روزرسانی nftables با DSCP EF
nft add rule inet gaming dscp tcp dport {443, 80} ip dscp set 0x2E

# 2. HAProxy timeout tuning
# (ویرایش proxy-server/haproxy.cfg)

# 3. CoreDNS serve_stale
# (ویرایش dns-server/Corefile)
```

### ✅ قدم 3 — Advanced (نیاز به برنامه‌ریزی)

```bash
# 1. نصب node-exporter برای مانیتورینگ
# 2. نصب XDP katran (در صورت نیاز)
# 3. جدا کردن gaming backend در HAProxy
```

---

## جدول خلاصه

| # | راهکار | تأثیر روی پینگ | تأثیر روی پکت‌لاست | سختی پیاده‌سازی |
|---|--------|---------------|-------------------|-----------------|
| 1 | BBR + sysctl | 🟢 5-15% | 🟢 10-30% | 🔵 آسان |
| 2 | fq_codel qdisc | 🟢 20-50% | 🟢 20-40% | 🔵 آسان |
| 3 | DSCP EF / QoS | 🟡 5-10% | 🟡 10-20% | 🟡 متوسط |
| 4 | HAProxy tuning (tfo, timeouts) | 🟢 5-20% | 🟢 - | 🔵 آسان |
| 5 | WireGuard MTU / Keepalive | 🟡 1-5% | 🟡 5-15% | 🔵 آسان |
| 6 | CoreDNS serve_stale + prefetch | 🟢 DNS | - | 🔵 آسان |
| 7 | conntrack tuning | 🟡 | 🟢 10-15% | 🔵 آسان |
| 8 | XDP / eBPF | 🟢 30-50% | 🟢 - | 🔴 سخت |
| 9 | Monitoring (MTR + node-exporter) | اطلاعاتی | اطلاعاتی | 🔵 آسان |

---

## پیش‌نیازها

> تمام دستورات باید با دسترسی `root` یا `sudo` اجرا شوند. برای اعمال دائمی tc rules، از systemd unit یا `rc.local` استفاده کنید.

```bash
# نصب ابزارهای مورد نیاز
apt install -y mtr-tiny nftables ethtool iproute2

# بررسی پشتیبانی کرنل
uname -r
# نیاز: >= 4.9 (برای BBR), >= 5.10 (برای XDP)
```

---

## جمع‌بندی

1. **اولویت اول**: `fq_codel` + `BBR` + `sysctl` → بیشترین تأثیر با کمترین ریسک
2. **اولویت دوم**: `HAProxy tuning` + `CoreDNS serve_stale` → بهبود محسوس در گیمینگ
3. **اولویت سوم**: `QoS / DSCP` + `conntrack` → اگر ISP از DSCP عبور دهد
4. **پاداش**: `XDP` فقط در صورتی که latency بحرانی باشد و تیم DevOps حرفه‌ای داشته باشید