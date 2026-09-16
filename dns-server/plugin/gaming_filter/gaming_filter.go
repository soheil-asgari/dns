package gaming_filter

import (
	"context"
	"net"
	"sync"
	"time"

	"github.com/coredns/coredns/plugin"
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
	qname := state.QName()

	if gf.isGamingDomain(qname) {
		return gf.modifyResponse(ctx, w, r)
	}

	return plugin.NextOrFailure(gf.Name(), gf.Next, ctx, w, r)
}

func (gf *GamingFilter) Name() string { return "gaming_filter" }

func (gf *GamingFilter) isGamingDomain(domain string) bool {
	gf.mu.RLock()
	defer gf.mu.RUnlock()
	_, ok := gf.gamingDomains[domain]
	return ok
}

func (gf *GamingFilter) modifyResponse(ctx context.Context, w dns.ResponseWriter, r *dns.Msg) (int, error) {
	state := request.Request{W: w, Req: r}

	m := new(dns.Msg)
	m.SetReply(r)
	m.Authoritative = true

	proxyIP := net.ParseIP(gf.proxyIP)
	if proxyIP == nil {
		return dns.RcodeServerFailure, nil
	}

	header := dns.RR_Header{
		Name:   state.QName(),
		Rrtype: state.QType(),
		Class:  state.QClass(),
		Ttl:    300,
	}

	var answer dns.RR
	switch state.QType() {
	case dns.TypeA:
		answer = &dns.A{
			Hdr: header,
			A:   proxyIP,
		}
	case dns.TypeAAAA:
		if proxyIP.To4() != nil {
			answer = &dns.AAAA{
				Hdr:  header,
				AAAA: net.IPv6loopback,
			}
		} else {
			answer = &dns.AAAA{
				Hdr:  header,
				AAAA: proxyIP,
			}
		}
	default:
		answer = &dns.A{
			Hdr: header,
			A:   proxyIP,
		}
	}

	m.Answer = append(m.Answer, answer)

	err := w.WriteMsg(m)
	if err != nil {
		return dns.RcodeServerFailure, err
	}
	return dns.RcodeSuccess, nil
}

func (gf *GamingFilter) refreshDomains() {
	ticker := time.NewTicker(gf.refreshInterval)
	for range ticker.C {
		domains, err := gf.redisClient.SMembers(context.Background(), "gaming:domains").Result()
		if err != nil {
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