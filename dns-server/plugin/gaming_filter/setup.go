package gaming_filter

import (
	"os"
	"time"

	"github.com/coredns/caddy"
	"github.com/coredns/coredns/core/dnsserver"
	"github.com/coredns/coredns/plugin"
)

func init() {
	plugin.Register("gaming_filter", setup)
}

func setup(c *caddy.Controller) error {
	c.Next()

	var redisAddr string
	var refreshInterval time.Duration
	var proxyIP string

	for c.NextBlock() {
		switch c.Val() {
		case "redis_addr":
			if !c.NextArg() {
				return c.ArgErr()
			}
			redisAddr = c.Val()
		case "refresh_interval":
			if !c.NextArg() {
				return c.ArgErr()
			}
			d, err := time.ParseDuration(c.Val())
			if err != nil {
				return c.Errf("invalid refresh_interval: %v", err)
			}
			refreshInterval = d
		case "proxy_ip":
			if !c.NextArg() {
				return c.ArgErr()
			}
			proxyIP = c.Val()
		default:
			return c.Errf("unknown property '%s'", c.Val())
		}
	}

	if redisAddr == "" {
		redisAddr = "redis:6379"
	}
	if refreshInterval == 0 {
		refreshInterval = 5 * time.Second
	}
	if proxyIP == "" {
		proxyIP = os.Getenv("GAMING_PROXY_IP")
		if proxyIP == "" {
			proxyIP = "10.0.0.1"
		}
	}

	gf := New(redisAddr, refreshInterval)
	gf.proxyIP = proxyIP

	cfg := dnsserver.GetConfig(c)
	cfg.AddPlugin(func(next plugin.Handler) plugin.Handler {
		gf.Next = next
		return gf
	})

	return nil
}