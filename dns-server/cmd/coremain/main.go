package main

import (
	"os"

	"github.com/coredns/coredns/coremain"

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
	if len(os.Args) == 1 {
		os.Args = append(os.Args, "-conf", "/etc/coredns/Corefile")
	}
}

func main() {
	coremain.Run()
}