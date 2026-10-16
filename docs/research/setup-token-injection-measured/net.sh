# Starts the header-logging fake endpoint on an internal network. Re-runnable.
set -e
D="$(cd "$(dirname "$0")" && pwd)"
docker rm -f sdk31-fake >/dev/null 2>&1 || true
docker network inspect sdk31net >/dev/null 2>&1 || docker network create --internal --subnet 172.30.31.0/24 sdk31net >/dev/null
mkdir -p "$D/log" && rm -f "$D"/log/*.jsonl
printf 'nameserver 172.30.31.2\n' > "$D/resolv.conf"
docker run -d --name sdk31-fake --network sdk31net --ip 172.30.31.2 -e SELF_IP=172.30.31.2 \
  -v "$D/fake":/fake:ro -v "$D/log":/log oven/bun:1.4.2-slim bun /fake/server.ts >/dev/null
sleep 2; docker logs sdk31-fake
