# dns-server

CoreDNS configuration with custom Go plugins for gaming DNS resolution.

## Structure

- `Corefile` - CoreDNS configuration
- `plugin/` - Custom Go plugins
- `go.mod` - Go module definition

## Local Development

```bash
cd dns-server
go build -o coredns ./cmd/coremain/
./coredns