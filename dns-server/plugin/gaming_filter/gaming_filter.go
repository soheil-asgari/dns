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
		redisClient:      rdb,
		refreshInterval:  refreshInterval,
		gamingDomains:    make(map[string]bool),
		proxyIP:          "10.0.0.1",
	}

	go gf.refreshDomains()
	return gf
}

func (gf *GamingFilter) ServeDNS(ctx context.Context, w dns.ResponseWriter, r *dns.Msg) (int, error) {
	state := request.Request{W: w, Req: r}

	// Normalize: strip trailing dot and lowercase
	rawName := strings.ToLower(strings.TrimSuffix(state.QName(), "."))

	if gf.isGamingDomain(rawName) {
		log.Infof("[gaming_filter] Intercepted %s -> rewriting to %s", rawName, gf.proxyIP)

		rr := new(dns.A)
		rr.Hdr = dns.RR_Header{Name: state.QName(), Rrtype: dns.TypeA, Class: dns.ClassINET, Ttl: 300}
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

// isGamingDomain checks exact match or subdomain suffix match.
// domains are expected to be stored without trailing dot.
func (gf *GamingFilter) isGamingDomain(rawName string) bool {
	gf.mu.RLock()
	defer gf.mu.RUnlock()

	if gf.gamingDomains[rawName] {
		return true
	}
	// Check subdomain: rawName ends with ".domain"
	for d := range gf.gamingDomains {
		if strings.HasSuffix(rawName, "."+d) {
			return true
		}
	}
	return false
}

func (gf *GamingFilter) refreshDomains() {
	ticker := time.NewTicker(gf.refreshInterval)
	for range ticker.C {
		val, err := gf.redisClient.HGet(context.Background(), "DNSgaming:domains", "data").Result()
		if err != nil {
			continue
		}
		var domains []string
		if err := json.Unmarshal([]byte(val), &domains); err != nil {
			continue
		}
		gf.mu.Lock()
		gf.gamingDomains = make(map[string]bool)
		for _, d := range domains {
			gf.gamingDomains[d] = true
		}
		gf.mu.Unlock()
	}
}