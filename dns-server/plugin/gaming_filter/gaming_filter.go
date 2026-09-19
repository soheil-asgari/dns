package gaming_filter

import (
	"context"
	"encoding/json"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/coredns/coredns/plugin"
	"github.com/coredns/coredns/plugin/pkg/log"
	"github.com/coredns/coredns/request"
	"github.com/go-redis/redis/v8"
	"github.com/miekg/dns"
)

type GamingFilter struct {
	Next            plugin.Handler
	redisClient     *redis.Client
	refreshInterval time.Duration
	gamingDomains   map[string]bool
	proxyIP         string
	mu              sync.RWMutex
}

func New(redisAddr string, refreshInterval time.Duration) *GamingFilter {
	rdb := redis.NewClient(&redis.Options{
		Addr: redisAddr,
	})

	gf := &GamingFilter{
		redisClient:     rdb,
		refreshInterval:  refreshInterval,
		gamingDomains:    make(map[string]bool),
		proxyIP:          "10.0.0.1",
	}

	go gf.startRefresher()
	return gf
}

func (gf *GamingFilter) startRefresher() {
	// 1. بارگذاری فوری و بدون معطلی در لحظه شروع
	gf.updateDomains()

	// 2. تکرار منظم دوره‌ای
	ticker := time.NewTicker(gf.refreshInterval)
	defer ticker.Stop()

	for range ticker.C {
		gf.updateDomains()
	}
}

func (gf *GamingFilter) updateDomains() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	val, err := gf.redisClient.HGet(ctx, "DNSgaming:domains", "data").Result()
	if err != nil {
		log.Errorf("[gaming_filter] Redis HGET error (key: DNSgaming:domains): %v", err)
		return
	}

	var domains []string
	if err := json.Unmarshal([]byte(val), &domains); err != nil {
		log.Errorf("[gaming_filter] JSON unmarshal error for value '%s': %v", val, err)
		return
	}

	gf.mu.Lock()
	gf.gamingDomains = make(map[string]bool)
	for _, d := range domains {
		clean := strings.ToLower(strings.TrimSpace(strings.TrimSuffix(d, ".")))
		if clean != "" {
			gf.gamingDomains[clean] = true
		}
	}
	count := len(gf.gamingDomains)
	gf.mu.Unlock()

	log.Infof("[gaming_filter] Successfully loaded %d gaming domains from Redis", count)
}

func (gf *GamingFilter) ServeDNS(ctx context.Context, w dns.ResponseWriter, r *dns.Msg) (int, error) {
	state := request.Request{W: w, Req: r}

	rawName := strings.ToLower(strings.TrimSuffix(state.QName(), "."))

	if gf.isGamingDomain(rawName) {
		log.Infof("[gaming_filter] Intercepted %s -> rewriting to %s", rawName, gf.proxyIP)

		rr := new(dns.A)
		rr.Hdr = dns.RR_Header{
			Name:   state.QName(),
			Rrtype: dns.TypeA,
			Class:  dns.ClassINET,
			Ttl:    300,
		}
		rr.A = net.ParseIP(gf.proxyIP)

		m := new(dns.Msg)
		m.SetReply(r)
		m.Authoritative = true
		m.Answer = []dns.RR{rr}
		state.W.WriteMsg(m)
		return dns.RcodeSuccess, nil
	}

	return plugin.NextOrFailure(gf.Name(), gf.Next, ctx, w, r)
}

func (gf *GamingFilter) Name() string { return "gaming_filter" }

func (gf *GamingFilter) isGamingDomain(rawName string) bool {
	gf.mu.RLock()
	defer gf.mu.RUnlock()

	if gf.gamingDomains[rawName] {
		return true
	}
	for d := range gf.gamingDomains {
		if strings.HasSuffix(rawName, "."+d) {
			return true
		}
	}
	return false
}