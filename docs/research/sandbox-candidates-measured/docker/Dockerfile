FROM alpine:3.22
RUN apk add --no-cache python3 socat iputils-ping iptables ip6tables iproute2 sqlite tcpdump && adduser -D -u 1000 runner
COPY probe.py portscan.py /
