package main

import (
	"os"

	"github.com/coredns/coredns/coremain"
	"github.com/coredns/coredns/core/dnsserver"

	// Register standard plugins
	_ "github.com/coredns/coredns/plugin/cache"
	_ "github.com/coredns/coredns/plugin/errors"
	_ "github.com/coredns/coredns/plugin/forward"
	_ "github.com/coredns/coredns/plugin/health"
	_ "github.com/coredns/coredns/plugin/log"
	_ "github.com/coredns/coredns/plugin/metrics"
	_ "github.com/coredns/coredns/plugin/whoami"

	// Custom plugins — init() in setup.go calls plugin.Register("gaming_filter", setup)
	_ "dns-server/plugin/gaming_filter"
)

func init() {
	// Ensure gaming_filter is recognized as a valid directive and, critically,
	// runs BEFORE "cache". Inserting it merely before "forward" would let the
	// cache plugin serve a whitelisted client's cached A records straight back
	// to unregistered clients, silently bypassing the whitelist enforcement.
	// Without registering the directive, CoreDNS also rejects it as "Unknown
	// directive 'gaming_filter'".
	directives := make([]string, 0, len(dnsserver.Directives)+1)
	inserted := false
	for _, d := range dnsserver.Directives {
		if (d == "cache" || d == "forward") && !inserted {
			directives = append(directives, "gaming_filter")
			inserted = true
		}
		directives = append(directives, d)
	}
	dnsserver.Directives = directives
}

func init() {
	if len(os.Args) == 1 {
		os.Args = append(os.Args, "-conf", "/etc/coredns/Corefile")
	}
}

func main() {
	coremain.Run()
}