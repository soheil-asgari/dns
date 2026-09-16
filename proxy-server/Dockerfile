FROM haproxy:2.8-alpine

COPY haproxy.cfg /usr/local/etc/haproxy/haproxy.cfg

EXPOSE 80 443 8053 8404

CMD ["haproxy", "-f", "/usr/local/etc/haproxy/haproxy.cfg"]