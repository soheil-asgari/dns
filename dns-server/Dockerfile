FROM golang:1.21 AS builder

ENV GOPROXY=https://goproxy.cn,direct
ENV GOSUMDB=off
ENV GOFLAGS=-mod=mod

WORKDIR /src
COPY go.mod go.sum* ./
COPY . .

# کامپایل مستقیم بدون وابستگی به پراکسی‌های خارجی
RUN go generate ./...
RUN CGO_ENABLED=0 go build -mod=mod -o /coredns ./cmd/coremain/

FROM alpine:3.19
RUN for i in 1 2 3 4 5; do apk --no-cache add ca-certificates && break || sleep 3; done

COPY --from=builder /coredns /usr/local/bin/coredns
COPY Corefile /etc/coredns/Corefile
EXPOSE 53 53/udp 9153
ENTRYPOINT ["/usr/local/bin/coredns"]
CMD ["-conf", "/etc/coredns/Corefile"]