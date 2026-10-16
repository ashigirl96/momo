#!/bin/sh
# Runs probe.py inside an existing agent container and prints only the lines that were not blocked.
# usage: probe-live.sh <agent-container>
A=$1
docker exec -e LAN_IP="$LAN_IP" -e ROUTER_IP="$ROUTER_IP" -e GW_TCP=47200 -e DECOY_LO=47201 -e DECOY_ANY=47202 -e DECOY_UDP=47203 -e PROBE_TIMEOUT=2 \
  -e EXTRA_TCP="relay_tcp=gateway:3129,relay_fake=gateway:3130,other_lazyai_db=172.18.0.3:5432,other_onecli=172.23.0.2:10254,bridge_gw=172.17.0.1:25432,vm=192.168.65.3:25432" \
  "$A" python3 /probe.py > "/tmp/momo-cmp-d-probe-$A.tsv" 2>&1
echo "blocked=$(grep -c BLOCKED "/tmp/momo-cmp-d-probe-$A.tsv") not-blocked: $(grep -vE 'BLOCKED|INFO' "/tmp/momo-cmp-d-probe-$A.tsv" | cut -f1,2 | tr '\n' ' ')"
docker exec "$A" sh -c 'echo "cgroup: cpu=$(cat /sys/fs/cgroup/cpu.max) mem=$(cat /sys/fs/cgroup/memory.max) swap=$(cat /sys/fs/cgroup/memory.swap.max) pids=$(cat /sys/fs/cgroup/pids.max) uid=$(id -u)"'
rm -f "/tmp/momo-cmp-d-probe-$A.tsv"
