FROM golang:1.21-alpine AS builder

ENV GOPROXY=https://goproxy.io,direct
ENV GOSUMDB=off

WORKDIR /src
COPY go.mod go.sum* ./
COPY . .
# Run tidy with source code present to resolve imports and populate go.sum
RUN go mod tidy
# go generate reads plugin.cfg and produces/updates zdirectives.go
RUN go generate ./...
RUN CGO_ENABLED=0 go build -mod=mod -o /coredns ./cmd/coremain/

FROM alpine:3.19
# اضافه کردن حلقه تلاش مجدد (Retry) برای عبور از خطاهای موقتی اینترنت
RUN for i in 1 2 3 4 5; do apk --no-cache add ca-certificates && break || sleep 3; done

COPY --from=builder /coredns /usr/local/bin/coredns
COPY Corefile /etc/coredns/Corefile
EXPOSE 53 53/udp 9153
ENTRYPOINT ["/usr/local/bin/coredns"]
CMD ["-conf", "/etc/coredns/Corefile"]