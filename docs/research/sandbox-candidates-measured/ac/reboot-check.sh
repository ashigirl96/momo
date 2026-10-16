#!/bin/sh
# Run after the Mac reboots, before starting anything else. Records the untouched state, then
# brings up the Apple container services, the fake Gateway (fake Anthropic on a host UDS) and the
# kept container momo-cmp-a-keep, and probes again: egress as uid 1000, and a resume of the
# Agent SDK session created before the reboot.
# usage: sh reboot-check.sh > .work/reboot.out 2>&1   (LAN_IP and ROUTER_IP are read from .work/env)
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
KEEP=momo-cmp-a-keep
WORK=$HERE/.work
. "$WORK/env"
export LAN_IP ROUTER_IP
GWD=$(cat "$WORK/gwdir")

echo "## before anything"
date
echo "# launchd jobs for container"
launchctl list | grep -i 'com.apple.container' || echo "(none)"
echo "# apiserver status"
container system status 2>&1 | head -3
echo "# old Gateway socket dir"
ls -la "$GWD" 2>&1 | head -5

echo "## container system start"
t0=$(date +%s)
container system start --disable-kernel-install 2>&1 | tail -3
echo "system start secs=$(( $(date +%s) - t0 ))"
container list -a

echo "## start the container while the Gateway socket is missing"
rm -f "$GWD/fa.sock"
container start "$KEEP" 2>&1 | tail -2
container list -a | grep "$KEEP"

echo "## bring up the decoys and the fake Gateway at the original path"
mkdir -p "$GWD" && chmod 700 "$GWD"
/usr/bin/python3 "$HERE/host_listeners.py" decoys 47301 47302 47303 "$WORK/host-reboot.log" > "$WORK/decoys-reboot.out" 2>&1 &
dp=$!
sh "$HERE/sdk.sh" fake > "$WORK/fake-reboot.out" 2>&1 &
fp=$!
until [ -S "$GWD/fa.sock" ]; do sleep 0.2; done
chmod 0666 "$GWD/fa.sock"
t0=$(date +%s)
container start "$KEEP" 2>&1 | tail -2
echo "container start secs=$(( $(date +%s) - t0 ))"
container list -a | grep "$KEEP"

echo "## egress probe as uid 1000"
container exec -u 1000 "$KEEP" bun /tools/netprobe.ts
echo "## resume the pre-reboot session"
sh "$HERE/sdk.sh" run "$KEEP" resume2 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 2>&1 | grep -E 'resumeFrom|"result"|sameSession' | cut -c1-300

kill "$dp" "$fp" 2>/dev/null
pkill -f fake-uds.ts 2>/dev/null
echo "## decoy hits (expect only 'listening')"
cat "$WORK/host-reboot.log"
