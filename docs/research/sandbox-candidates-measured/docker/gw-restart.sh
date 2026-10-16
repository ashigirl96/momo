#!/bin/sh
# Stops and restarts this candidate's fake Gateway (matched by its own path) around a running agent.
# usage: gw-restart.sh <agent-container>
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$HERE/.work
GWD=$(cat "$WORK/gwdir")
A=$1
mypid() { pgrep -f "$HERE/host_listeners.py gw" | head -1; }
try() { docker exec "$A" python3 -c '
import socket,sys
try:
    s=socket.create_connection(("gateway",3129),timeout=3); s.settimeout(3); print(sys.argv[1],"connect ok, recv",repr(s.recv(20)))
except Exception as e: print(sys.argv[1],"ERR",type(e).__name__,e)' "$1"; }
try 1.baseline
kill "$(mypid)"; sleep 1
try 2.stopped; try 3.stopped-again
docker exec "$A" python3 /probe.py | grep -vE 'BLOCKED|INFO' | sed 's/^/  not-blocked: /'
nohup python3 "$HERE/host_listeners.py" gw "$GWD/gw.sock" 47200 "$WORK/host.log" >/dev/null 2>&1 &
sleep 1
try 4.restarted; try 5.restarted-again
