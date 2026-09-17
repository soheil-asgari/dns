FROM golang:1.21-alpine AS builder
WORKDIR /src
COPY go.mod go.sum* ./
COPY . .
# Run tidy with source code present to resolve imports and populate go.sum
RUN go mod tidy
RUN CGO_ENABLED=0 go build -mod=mod -o /coredns ./cmd/coremain/

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
COPY --from=builder /coredns /usr/local/bin/coredns
COPY Corefile /etc/coredns/Corefile
EXPOSE 53 53/udp 9153
ENTRYPOINT ["/usr/local/bin/coredns"]
CMD ["-conf", "/etc/coredns/Corefile"]