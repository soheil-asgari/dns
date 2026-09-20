FROM haproxy:2.8-alpine

USER root

# Prepare required haproxy directories and self-signed SSL certificate fallback
# Install socat for runtime ACL manipulation via the admin socket
RUN apk add --no-cache openssl socat && \
    mkdir -p /var/lib/haproxy /var/run/haproxy /etc/ssl/certs /usr/local/etc/haproxy && \
    chown -R haproxy:haproxy /var/lib/haproxy /var/run/haproxy /usr/local/etc/haproxy && \
    openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
        -keyout /tmp/key.pem -out /tmp/cert.pem \
        -subj "/CN=localhost" && \
    cat /tmp/key.pem /tmp/cert.pem > /etc/ssl/certs/haproxy.pem && \
    chmod 600 /etc/ssl/certs/haproxy.pem && \
    rm -f /tmp/key.pem /tmp/cert.pem

COPY haproxy.cfg /usr/local/etc/haproxy/haproxy.cfg

# Create empty whitelist ACL file with correct ownership
RUN touch /usr/local/etc/haproxy/whitelist.acl && \
    chown haproxy:haproxy /usr/local/etc/haproxy/whitelist.acl && \
    chmod 644 /usr/local/etc/haproxy/whitelist.acl

EXPOSE 80 443 8053 8404

CMD ["haproxy", "-f", "/usr/local/etc/haproxy/haproxy.cfg"]