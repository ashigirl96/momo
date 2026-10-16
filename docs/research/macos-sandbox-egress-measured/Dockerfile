FROM alpine:3.22
RUN apk add --no-cache python3 socat iputils-ping && adduser -D -u 1000 runner
COPY probe.py /probe.py
