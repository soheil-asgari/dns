// +build ignore

package main

import (
    "fmt"
    "os"
    "strings"

    "github.com/coredns/coredns/core/dnsserver"
    "github.com/coredns/coredns/coremain"
    "github.com/coredns/coredns/plugin"

    // Register plugins
    _ "github.com/coredns/coredns/plugin/cache"
    _ "github.com/coredns/coredns/plugin/errors"
    _ "github.com/coredns/coredns/plugin/forward"
    _ "github.com/coredns/coredns/plugin/health"
    _ "github.com/coredns/coredns/plugin/log"
    _ "github.com/coredns/coredns/plugin/prometheus"
    _ "github.com/coredns/coredns/plugin/ratelimit"
    _ "github.com/coredns/coredns/plugin/whoami"

    // Custom plugins
    _ "dns-server/plugin/gaming_filter"
)

func init() {
    plugin.Register("gaming_filter", func(c *dnsserver.Controller) (plugin.Plugin, error) {
        return gaming_filter.New(c)
    })
}

func main() {
    coremain.Run()
}