//go:build ignore

package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

func main() {
	fmt.Println("=== CoreDNS plugin.cfg directive generator ===")

	f, err := os.Open("plugin.cfg")
	if err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: cannot open plugin.cfg: %v\n", err)
		os.Exit(1)
	}
	defer f.Close()

	var directives []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			fmt.Fprintf(os.Stderr, "ERROR: invalid plugin.cfg line: %s\n", line)
			os.Exit(1)
		}
		directives = append(directives, parts[0])
	}
	if err := scanner.Err(); err != nil {
		fmt.Fprintf(os.Stderr, "ERROR reading plugin.cfg: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("Plugin execution order (from plugin.cfg):")
	for i, d := range directives {
		fmt.Printf("  %d. %s\n", i+1, d)
	}
	fmt.Println("plugin.cfg validation passed")
}