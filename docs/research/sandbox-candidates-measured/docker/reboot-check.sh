#!/bin/sh
# Run after the Mac reboots, before starting anything by hand.
# Records what Docker Desktop and the kept containers/networks look like, then brings the
# NanoClaw-style topology back and repeats the probe, the Gateway restart, and the SDK resume.
# usage: LAN_IP=... ROUTER_IP=... sh reboot-check.sh 2>&1 | tee .work/reboot-check.log
# Kept across the reboot: networks momo-cmp-d-int and momo-cmp-d-iso, containers momo-cmp-d-relay,
# momo-cmp-d-agent-live (restart=no) and momo-cmp-d-agent-rp (restart=unless-stopped),
# images momo-cmp-d-probe:1 and momo-cmp-d-sdk:1, and the session dir .work/sess/s3.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$HERE/.work
OUT=$WORK/reboot
mkdir -p "$OUT"

echo "# 1. state before touching anything ($(date -u +%FT%TZ), uptime: $(uptime | sed 's/.*up //; s/,.*//'))"
echo "Docker Desktop processes: $(pgrep -f '/Applications/Docker.app/Contents/MacOS/com.docker.backend' | wc -l | tr -d ' ')"
echo "AutoStart setting: $(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/Library/Group Containers/group.com.docker/settings-store.json'))).get('AutoStart'))")"
if timeout 10 docker ps >/dev/null 2>&1; then echo "docker API: up without being started"; else echo "docker API: down"; fi

echo "# 2. start Docker Desktop"
T0=$(date +%s)
pgrep -f '/Applications/Docker.app/Contents/MacOS/com.docker.backend' >/dev/null || open -a Docker
until timeout 10 docker ps >/dev/null 2>&1; do sleep 2; done
echo "docker API up after $(( $(date +%s) - T0 ))s"
docker ps -a --format '{{.Names}} {{.Status}}' | grep momo-cmp-d
docker network ls --format '{{.Name}}' | grep momo-cmp-d

echo "# 3. Gateway and decoys (the private socket dir under TMPDIR may be gone after the reboot)"
GWD=$(cat "$WORK/gwdir")
[ -d "$GWD" ] || { echo "gw dir was removed by the reboot; recreating"; mkdir -p "$GWD"; }
python3 "$HERE/host_listeners.py" decoys 47201 47202 47203 "$WORK/host.log" >/dev/null 2>&1 & echo $! > "$OUT/decoys.pid"
python3 "$HERE/host_listeners.py" gw "$GWD/gw.sock" 47200 "$WORK/host.log" >/dev/null 2>&1 & echo $! > "$OUT/gw.pid"
(cd "$HERE" && LOG_DIR=$WORK/fake bun sdk/server.ts > "$WORK/fake/out.log" 2>&1) & echo $! > "$OUT/fake.pid"
until curl -s http://127.0.0.1:47210/api/hello >/dev/null; do sleep 1; done

echo "# 4. bring the kept containers back"
T1=$(date +%s)
docker start momo-cmp-d-relay momo-cmp-d-agent-live
echo "docker start took $(( $(date +%s) - T1 ))s"
docker inspect momo-cmp-d-agent-rp --format 'agent-rp (unless-stopped): {{.State.Status}}'
docker inspect momo-cmp-d-relay --format 'relay aliases: {{range $k,$v := .NetworkSettings.Networks}}{{$k}}:{{$v.Aliases}} {{end}}'

echo "# 5. probe, Gateway restart, SDK resume"
sh "$HERE/probe-live.sh" momo-cmp-d-agent-live
sh "$HERE/gw-restart.sh" momo-cmp-d-agent-live
O=$(sh "$HERE/sdk.sh" s3 resume2 quiet)
grep -oE '"sameSession":(true|false)|"text":"SEEN[^"]*"' "$O/probe.jsonl" | sort -u

echo "# 6. stop the host processes this script started"
for p in gw decoys fake; do kill "$(cat "$OUT/$p.pid")" 2>/dev/null; done
pkill -f "$HERE/host_listeners.py" 2>/dev/null
pkill -f "$HERE/sdk/server.ts" 2>/dev/null
echo "done; containers and networks are left for teardown (sh run.sh teardown, then docker rm -f momo-cmp-d-agent-live momo-cmp-d-agent-rp)"
