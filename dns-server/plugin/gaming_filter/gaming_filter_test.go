package gaming_filter

import (
	"context"
	"net"
	"testing"

	"github.com/coredns/coredns/plugin"
	"github.com/miekg/dns"
)

func TestGamingDomainReturnsProxyIP(t *testing.T) {
	gf := New("redis:6379", 60)
	gf.proxyIP = "192.168.1.100"

	// Inject a known gaming domain directly into the map
	gf.mu.Lock()
	gf.gamingDomains["epicgames.com."] = true
	gf.mu.Unlock()

	m := new(dns.Msg)
	m.SetQuestion("epicgames.com.", dns.TypeA)
	m.RecursionDesired = true

	rec := &dns.Test.ResponseWriter{}
	rcode, err := gf.ServeDNS(context.Background(), rec, m)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rcode != dns.RcodeSuccess {
		t.Fatalf("expected RcodeSuccess, got %d", rcode)
	}

	reply := rec.Msg
	if reply == nil {
		t.Fatal("expected non-nil reply message")
	}
	if len(reply.Answer) == 0 {
		t.Fatal("expected at least one answer")
	}

	a, ok := reply.Answer[0].(*dns.A)
	if !ok {
		t.Fatalf("expected A record, got %T", reply.Answer[0])
	}

	expectedIP := net.ParseIP("192.168.1.100")
	if !a.A.Equal(expectedIP) {
		t.Fatalf("expected proxy IP %s, got %s", expectedIP, a.A.String())
	}
}

func TestNonGamingDomainPassesToNext(t *testing.T) {
	gf := New("redis:6379", 60)
	gf.proxyIP = "192.168.1.100"

	nextCalled := false
	gf.Next = plugin.HandlerFunc(func(ctx context.Context, w dns.ResponseWriter, r *dns.Msg) (int, error) {
		nextCalled = true
		return dns.RcodeSuccess, nil
	})

	m := new(dns.Msg)
	m.SetQuestion("google.com.", dns.TypeA)

	rec := &dns.Test.ResponseWriter{}
	rcode, err := gf.ServeDNS(context.Background(), rec, m)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rcode != dns.RcodeSuccess {
		t.Fatalf("expected RcodeSuccess, got %d", rcode)
	}
	if !nextCalled {
		t.Fatal("expected next plugin to be called for non-gaming domain")
	}
}