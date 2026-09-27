FROM alpine:3.21

RUN apk add --no-cache unbound bind-tools ca-certificates \
    && mkdir -p /var/lib/unbound \
    && touch /var/lib/unbound/root.key \
    && chown -R unbound:unbound /var/lib/unbound

COPY unbound.conf /etc/unbound/unbound.conf

USER unbound
EXPOSE 53/udp 53/tcp

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD nslookup cloudflare.com 127.0.0.1 || exit 1

CMD ["/bin/sh", "-ec", "if [ ! -s /var/lib/unbound/root.key ]; then unbound-anchor -a /var/lib/unbound/root.key; fi; exec unbound -d -c /etc/unbound/unbound.conf"]
