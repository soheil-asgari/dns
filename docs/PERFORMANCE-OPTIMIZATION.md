# گزارش بهینه‌سازی سرعت، پینگ و Packet Loss

بررسی کلی زیرساخت Gaming DNS (Iran Edge → WireGuard → Germany Exit → SNI Proxy) با هدف کاهش پینگ، افزایش Throughput و کاهش Packet Loss.

---

## ۱. خلاصه وضعیت فعلی

| لایه | فایل | وضعیت |
|------|------|-------|
| WireGuard Tunnel | [`scripts/setup-iran.sh`](scripts/setup-iran.sh:67), [`scripts/setup-germany.sh`](scripts/setup-germany.sh:73) | MTU صریح تنظیم نشده، تک‌تونل |
| HAProxy | [`proxy-server/haproxy.cfg`](proxy-server/haproxy.cfg:1) | `nbthread 4` هاردکد، بدون `tcp-smart-*` |
| CoreDNS | [`dns-server/Corefile`](dns-server/Corefile:1) | `policy sequential` باعث عبور همه کوئری‌ها از تونل |
| Gaming Filter | [`dns-server/plugin/gaming_filter/gaming_filter.go`](dns-server/plugin/gaming_filter/gaming_filter.go:133) | جست‌وجوی O(n) روی هر کوئری + لاگ Infof در هر درخواست |
| Unbound (Iran) | [`dns-server/unbound/unbound.conf`](dns-server/unbound/unbound.conf:1) | `num-threads` تنظیم نشده (تک‌هسته‌ای) |
| Unbound (Germany) | [`infra/unbound-germany/unbound.conf`](infra/unbound-germany/unbound.conf:1) | همان مشکل، بدون cache sizing |
| sysctl | [`scripts/optimize-network.sh`](scripts/optimize-network.sh:21) | `tcp_notsent_lowat` بالا = پینگ بیشتر |
| qdisc | [`infra/systemd/tc-qdisc.service`](infra/systemd/tc-qdisc.service:9) | تداخل `fq` (sysctl) و `fq_codel` (tc) |
| DSCP | [`infra/nftables/dns-filter.nft`](infra/nftables/dns-filter.nft:68) | mark/DSCP می‌زند اما tc filter مصرف‌کننده ندارد |

---

## ۲. لایه WireGuard (بزرگ‌ترین منبع پینگ و Packet Loss)

### ۲.۱ تنظیم صریح MTU
در حال حاضر MTU تونل به مقدار پیش‌فرض `wg-quick` (۱۴۲۰) رها شده. برای مسیرهای IPv4 با MTU ۱۵۰۰:

- Overhead = 20 (IP) + 8 (UDP) + 32 (WG) = 60 بایت → MTU بهینه تئوریک ۱۴۴۰.
- مقدار ۱۴۲۰ محافظه‌کارانه و امن است؛ اما اگر ISP مسیر را با MTU کمتر می‌بندد، افت بسته زیاد می‌شود.

**پیشنهاد:** MTU را صریح و در هر دو سمت تنظیم کنید و با `ping -M do` تست کنید:

```ini
[Interface]
MTU = 1420
```

```bash
# تست کشف MTU واقعی مسیر (از Iran به Germany)
ping -M do -s 1392 10.10.0.1   # 1392+28 = 1420
```

### ۲.۲ افزودن `fwmark` برای جلوگیری از حلقه مسیریابی
وقتی PBR فعال است، عدم `fwmark` می‌تواند باعث ارسال بسته‌های تونل از مسیر اشتباه شود:

```ini
[Interface]
FwMark = 0xca6c
```

سپس در PBR این mark را از جدول‌های ۱۰۱/۱۰۲ مستثنی کنید.

### ۲.۳ Multipath / چند تونل برای مقاومت به Packet Loss
WireGuard هر Peer را در یک صف پردازش می‌کند و رمزنگاری single-threaded است. با یک تونل:

- هر افت روی مسیر ایران↔آلمان مستقیماً روی کل سرویس اثر می‌گذارد.
- سقف پهنای‌باند به CPU یک هسته گره می‌خورد.

**پیشنهاد:** دو تونل `wg0`/`wg1` روی پورت‌های متفاوت (مثلاً 51820 و 51821) با ECMP:

```bash
ip route add 10.10.0.1/32 dev wg0
ip route add 10.10.1.1/32 dev wg1
# ECMP برای توزیع بار
ip route add 10.10.0.0/24 \
  nexthop dev wg0 weight 1 \
  nexthop dev wg1 weight 1
```

یا حداقل یک تونل پشتیبان با health-check برای failover سریع.

### ۲.۴ افزایش بافر UDP تونل
بافر پیش‌فرض UDP در بار بالا باعث drop می‌شود (به بخش sysctl مراجعه کنید: `net.core.rmem_default`).

---

## ۳. لایه HAProxy

فایل: [`proxy-server/haproxy.cfg`](proxy-server/haproxy.cfg:1)

### ۳.۱ `nbthread` هاردکد
`nbthread 4` ثابت است. اگر سرور هسته‌های بیشتری دارد، هدر می‌رود؛ اگر کمتر، Over-subscription رخ می‌دهد.

```haproxy
global
    nbthread auto
```

### ۳.۲ فعال‌سازی TCP Splicing / Smart-Connect
برای SNI Passthrough، تأخیر اتصال به بک‌اند را حذف کنید:

```haproxy
defaults
    option tcp-smart-accept
    option tcp-smart-connect
```

- `tcp-smart-connect`: اتصال به آلمان تا رسیدن اولین داده‌ی کلاینت به تعویق می‌افتد → حذف یک RTT اضافی در SYN.
- `tcp-smart-accept`: کاهش syscall.

### ۳.۳ افزایش بافر و maxconn
```haproxy
global
    maxconn 50000
    tune.bufsize 32768
    tune.maxrewrite 8192

defaults
    maxconn 20000
    timeout connect 1s
```

`tune.ssl.cachesize` بی‌فایده است چون HAProxy در این معماری TLS را terminate نمی‌کند (Passthrough).

### ۳.۴ کاهش `tcp-request inspect-delay`
مقدار `2s` فعلی فقط زمانی اثر دارد که کلاینت Hello نفرستد، اما برای اطمینان و جلوگیری از اشغال کانکشن:

```haproxy
tcp-request inspect-delay 500ms
tcp-request content accept if { req_ssl_hello_type 1 }
```

### ۳.۵ بازبینی weight در backend gaming
`server germany_peer ... weight 20` روی یک سرور تنها بی‌اثر است؛ اگر ECMP چند تونل اضافه شود، اینجا وزن‌دهی معنا پیدا می‌کند.

### ۳.۶ `nolinger` و keepalive
```haproxy
defaults
    option nolinger
```

---

## ۴. لایه CoreDNS

فایل: [`dns-server/Corefile`](dns-server/Corefile:1)

### ۴.۱ سیاست Forward
```coredns
forward . 10.10.0.1:53 172.20.0.11 {
    health_check 5s
    max_concurrent 4000
    expire 10s
    policy sequential   # ← مشکل‌ساز
}
```

`sequential` همیشه اول `10.10.0.1` (آلمان، از داخل تونل) را می‌زند و فقط در خطا سراغ Unbound محلی می‌رود. یعنی حتی برای دامنه‌های غیرگیمینگ، ترافیک DNS از تونل عبور می‌کند و پینگ را بالا می‌برد.

**پیشنهاد:**
```coredns
forward . 172.20.0.11 10.10.0.1:53 {
    health_check 2s
    max_concurrent 8000
    expire 30s
    policy round_robin
    prefer_udp
}
```
اولویت با resolver محلی (Unbound داخلی) و در صورت خرابی، تونل.

### ۴.۲ Cache
```coredns
cache 3600 {
    success 3600
    denial 60
    prefetch 30 30s 25%
    serve_stale 1h
    min 5            # جلوگیری از TTL=0
    keepttl          # احترام به TTL مبدأ
}
```

`serve_stale 1h` برای مقاومت در برابر Packet Loss عالی است و باید حفظ شود.

### ۴.۳ رفع گلوگاه پلاگین Gaming Filter
فایل: [`dns-server/plugin/gaming_filter/gaming_filter.go`](dns-server/plugin/gaming_filter/gaming_filter.go:133)

```go
// جست‌وجوی خطی O(n) روی همه دامنه‌ها برای هر کوئری غیرگیمینگ
for d := range gf.gamingDomains {
    if len(rawName) > len(d) && rawName[len(rawName)-len(d)-1] == '.' && strings.HasSuffix(rawName, d) {
        return true
    }
}
```

با بزرگ‌شدن لیست دامنه‌ها (هزاران دامنه)، این حلقه در مسیر داغ (Hot Path) هر کوئری، CPU و Latency را بالا می‌برد.

**پیشنهاد:** استفاده از درخت معکوس برچسب (Suffix Trie) یا map کلیدمعکوس:

```go
// به جای لیست، دامنه‌ها را برعکس ذخیره کنید: com.epicgames
suffixMap map[string]bool  // کلید = reversed domain

func (gf *GamingFilter) isGamingDomain(name string) bool {
    labels := strings.Split(name, ".")
    for i := 0; i < len(labels); i++ {
        candidate := strings.Join(reverse(labels[i:]), ".")
        if gf.suffixMap[candidate] {
            return true
        }
    }
    return false
}
```
پیچیدگی از O(n) به O(تعداد برچسب) کاهش می‌یابد.

### ۴.۴ حذف لاگ در مسیر داغ
```go
log.Infof("[gaming_filter] Intercepted %s -> rewriting to %s", rawName, gf.proxyIP)
```
در هر کوئری گیمینگ یک I/O لاگ رخ می‌دهد. به `log.Debugf` تغییر دهید.

### ۴.۵ TTL رکورد پاسخ
TTL فعلی `60` ثانیه است ([`gaming_filter.go`](dns-server/plugin/gaming_filter/gaming_filter.go:116)). اگر IP پروکسی ثابت است، افزایش به ۳۰۰ کاهش بار DNS کلاینت‌ها را در پی دارد.

---

## ۵. لایه Unbound (هر دو گره)

فایل‌ها: [`dns-server/unbound/unbound.conf`](dns-server/unbound/unbound.conf:1) و [`infra/unbound-germany/unbound.conf`](infra/unbound-germany/unbound.conf:1)

### ۵.۱ بحرانی: `num-threads` تنظیم نشده
بدون این گزینه Unbound تک‌رشته‌ای اجرا می‌شود و سقف QPS پایین می‌ماند.

```conf
server:
    num-threads: 4
    so-reuseport: yes
    msg-cache-size: 128m
    rrset-cache-size: 256m
    msg-cache-slabs: 8
    rrset-cache-slabs: 8
    infra-cache-slabs: 8
    key-cache-slabs: 8
```

### ۵.۲ بافر سوکت و concurrency
```conf
server:
    so-rcvbuf: 8m
    so-sndbuf: 8m
    outgoing-range: 8192
    num-queries-per-thread: 4096
    edns-buffer-size: 1232
    jostle-timeout: 200
```

### ۵.۳ کاهش Round-Trip در حل بازگشتی
`qname-minimisation: yes` امنیت را بالا می‌برد اما تعداد پرس‌وجوهای بازگشتی و Latency را زیاد می‌کند. برای سرویس کم‌تأخیر:

```conf
    qname-minimisation: no
    prefetch: yes
    prefetch-key: yes
    cache-min-ttl: 60
    serve-expired: yes
    serve-expired-ttl: 3600
    serve-expired-reply-ttl: 30
```

### ۵.۴ افزودن forward-zone سریع (اختیاری)
برای دامنه‌های پرمصرف گیمینگ می‌توان Forward-zone به resolver عمومی نزدیک آلمان اضافه کرد تا مسیر بازگشتی کوتاه‌تر شود (با حفظ DNSSEC در صورت نیاز).

---

## ۶. لایه سیستمی / Kernel

فایل: [`scripts/optimize-network.sh`](scripts/optimize-network.sh:21)

### ۶.۱ `tcp_notsent_lowat` بالا = پینگ بیشتر (مهم)
```ini
net.ipv4.tcp_notsent_lowat = 131072
```
این مقدار باعث می‌شود کرنل داده‌ی بیشتری را قبل از ارسال بافر کند و برای ترافیک تعاملی/گیمینگ تأخیر ایجاد می‌کند. برای Low-Latency:

```ini
net.ipv4.tcp_notsent_lowat = 16384
```

### ۶.۲ تداخل qdisc
sysctl مقدار `net.core.default_qdisc = fq` می‌دهد اما [`tc-qdisc.service`](infra/systemd/tc-qdisc.service:9) روی eth1/eth2 `fq_codel` می‌گذارد. این دو با هم هم‌خوان نیستند و `fq_codel` روی گره پرمصرف به Bufferbloat کمکی نمی‌کند.

**پیشنهاد:** یکدست‌سازی روی `fq` (سازگار با BBR) یا ارتقا به `cake` برای کنترل Bufferbloat روی اینترفیس WAN:

```bash
tc qdisc replace dev eth1 root cake bandwidth 1gbit diffserv3 dual-dsthost
tc qdisc replace dev eth2 root cake bandwidth 1gbit diffserv3 dual-dsthost
```

### ۶.۳ تیون‌های پیشنهادی تکمیلی
```ini
# Latency / busy polling
net.core.busy_poll = 50
net.core.busy_read = 50

# Backlog و صف‌ها
net.core.somaxconn = 32768
net.ipv4.tcp_max_syn_backlog = 8192

# محدوده پورت‌های محلی (برای conntrack بالاتر)
net.ipv4.ip_local_port_range = 10240 65535

# ECN و کاهش تأخیر
net.ipv4.tcp_ecn = 1
net.ipv4.tcp_sack = 1
net.ipv4.tcp_timestamps = 1
net.ipv4.tcp_no_metrics_save = 1

# UDP برای DNS/Gaming
net.ipv4.udp_rmem_min = 16384
net.ipv4.udp_wmem_min = 16384

# افزایش conntrack
net.netfilter.nf_conntrack_max = 1048576
```

### ۶.۴ IRQ Affinity و CPU Governor
- `rps.service` مقدار ثابت `f` (۴ هسته) را اعمال می‌کند؛ آن را با تعداد واقعی هسته (mask کامل) هم‌سان کنید.
- CPU Governor را روی `performance` بگذارید:

```bash
for g in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
    echo performance > "$g" 2>/dev/null || true
done
```

### ۶.۵ XPS روی اینترفیس‌های TX
```bash
for tx in /sys/class/net/eth*/queues/tx-*/xps_cpus; do
    [ -e "$tx" ] && echo f > "$tx"
done
```

---

## ۷. DSCP / QoS — کانفیگ مرده

فایل: [`infra/nftables/dns-filter.nft`](infra/nftables/dns-filter.nft:68)

```nft
tcp dport {443, 80} meta mark set 0x2
tcp dport {443, 80} ip dscp set 0x2E
```

مشکل: هیچ `tc filter` این mark/DSCP را مصرف نمی‌کند، بنابراین QoS واقعی اعمال نمی‌شود. باید یک qdisc با کلاس‌بندی و filter مطابق mark اضافه شود:

```bash
tc qdisc add dev eth1 root handle 1: htb default 30
tc class add dev eth1 parent 1: classid 1:1 htb rate 1gbit
tc class add dev eth1 parent 1:1 classid 1:10 htb rate 400mbit ceil 1gbit prio 1  # gaming
tc class add dev eth1 parent 1:1 classid 1:20 htb rate 100mbit ceil 1gbit prio 2  # dns
tc class add dev eth1 parent 1:1 classid 1:30 htb rate 200mbit ceil 1gbit prio 3  # default
tc filter add dev eth1 parent 1: protocol ip prio 1 handle 0x2 fw classid 1:10
tc filter add dev eth1 parent 1: protocol ip prio 2 handle 0x1 fw classid 1:20
```

---

## ۸. لایه Docker / معماری استقرار

فایل: [`docker-compose.yml`](docker-compose.yml:1)

### ۸.۱ شبکه Bridge و NAT
همه سرویس‌ها روی bridge با NAT هستند؛ هر بسته چند بار از netfilter عبور می‌کند و Latency و CPU مصرف می‌کند. برای سرویس‌های مسیر داغ (`haproxy`, `coredns`) در تولید:

```yaml
  haproxy:
    network_mode: host
  coredns:
    network_mode: host
```

با این کار، SNI Passthrough و DNS بدون NAT انجام می‌شود (البته ایزولاسیون شبکه کاهش می‌یابد و باید با nftables کنترل شود).

### ۸.۲ DNS کانتینر backend-api
```yaml
    dns:
      - 172.20.0.10   # CoreDNS (که خودش forward می‌کند)
      - 178.22.122.100
```
مسیر DNS کانتینرها دو هاپ است. می‌توان مستقیماً `172.20.0.11` (Unbound محلی) را اول گذاشت تا یک هاپ حذف شود.

### ۸.۳ healthcheck و restart
`restart: unless-stopped` خوب است؛ برای کاهش downtime، `start_period` و `interval` را با بار واقعی تنظیم کنید.

---

## ۹. جمع‌بندی اولویت‌دار

### اولویت بحرانی (اثر بالا، ریسک کم)
1. تنظیم `num-threads` و cache sizing در Unbound (هر دو گره).
2. تغییر `policy sequential` به `round_robin` و اولویت resolver محلی در CoreDNS.
3. کاهش `tcp_notsent_lowat` به ۱۶۳۸۴.
4. رفع جست‌وجوی O(n) پلاگین gaming_filter.
5. تنظیم صریح MTU تونل WireGuard.

### اولویت بالا
6. `nbthread auto` + `tcp-smart-accept/connect` در HAProxy.
7. یکدست‌سازی qdisc روی `fq`/`cake`.
8. تنظیم IRQ/RPS/XPS و CPU governor.

### اولویت متوسط (مقاومت و مقیاس)
9. ECMP چند‌تونلی WireGuard برای کاهش اثر Packet Loss.
10. tc filter واقعی برای DSCP/QoS.
11. بررسی `network_mode: host` برای HAProxy و CoreDNS.
12. افزودن `fwmark` به WireGuard.

---

## ۱۰. چک‌لیست اعتبارسنجی

```bash
# ۱. سلامت تونل و پینگ
wg show; ping -c 20 -i 0.2 10.10.0.1 | tail -3

# ۲. تست Packet Loss مسیر (MTR)
mtr -rwzc 100 10.10.0.1

# ۳. کشف MTU
ping -M do -s 1392 -c 3 10.10.0.1

# ۴. تأخیر DNS (قبل/بعد)
dig @127.0.0.1 google.com +stats +noall +comments

# ۵. وضعیت qdisc و drop
tc -s qdisc show dev eth1
ss -s; nstat -az | grep -i drop

# ۶. بافر و صف‌های شبکه
ethtool -S eth1 | grep -i drop
cat /proc/net/softnet_stat

# ۷. متریک‌های CoreDNS
curl -s http://127.0.0.1:9153/metrics | grep coredns_cache
```

---

## ۱۱. جدول اثر تقریبی

| تغییر | اثر پینگ | اثر Packet Loss | اثر Throughput |
|-------|----------|-----------------|----------------|
| Unbound num-threads | کم | متوسط | زیاد |
| CoreDNS round_robin | متوسط | کم | کم |
| tcp_notsent_lowat ↓ | زیاد | کم | کم |
| MTU صحیح | متوسط | زیاد | متوسط |
| HAProxy smart-connect | متوسط | کم | کم |
| qdisc cake/fq | متوسط | زیاد | متوسط |
| ECMP چندتونلی | کم | زیاد | زیاد |
| tc QoS واقعی | متوسط | متوسط | کم |
