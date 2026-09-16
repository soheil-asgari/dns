package gaming_filter

import (
    "context"
    "net"
    "time"

    "github.com/coredns/coredns/plugin"
    "github.com/coredns/coredns/request"
    "github.com/go-redis/redis/v8"
    "github.com/miekg/dns"
)

type GamingFilter struct {
    Next          plugin.Handler
    redisClient   *redis.Client
    refreshInterval time.Duration
    gamingDomains  map[string]bool
}

func New(redisAddr string, refreshInterval time.Duration) *GamingFilter {
    rdb := redis.NewClient(&redis.Options{
        Addr: redisAddr,
    })

    gf := &GamingFilter{
        redisClient:      rdb,
        refreshInterval:  refreshInterval,
        gamingDomains:    make(map[string]bool),
    }

    go gf.refreshDomains()
    return gf
}

func (gf *GamingFilter) ServeDNS(ctx context.Context, w dns.ResponseWriter, r *dns.Msg) (int, error) {
    state := request.Request{W: w, Req: r}
    qname := state.QName()

    if gf.isGamingDomain(qname) {
        // Apply custom routing rules for gaming domains
        // e.g., redirect to low-latency servers
        gf.modifyResponse(r)
    }

    return plugin.NextOrFailure(gf.Name(), gf.Next, ctx, w, r)
}

func (gf *GamingFilter) Name() string { return "gaming_filter" }

func (gf *GamingFilter) isGamingDomain(domain string) bool {
    _, ok := gf.gamingDomains[domain]
    return ok
}

func (gf *GamingFilter) modifyResponse(r *dns.Msg) {
    // Apply custom DNS response modifications
    // e.g., route to specific game server IPs
}

func (gf *GamingFilter) refreshDomains() {
    ticker := time.NewTicker(gf.refreshInterval)
    for range ticker.C {
        domains, err := gf.redisClient.SMembers(context.Background(), "gaming:domains").Result()
        if err != nil {
            continue
        }
        gf.gamingDomains = make(map[string]bool)
        for _, d := range domains {
            gf.gamingDomains[d] = true
        }
    }
}