#!/bin/sh
# Gateway stop/restart and same-path spoofing against a running container, without restarting it.
# usage: gw-restart.sh <container>
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$HERE/.work
GWD=$(cat "$WORK/gwdir")
C=$1
uds() { container exec "$C" python3 -c '
import socket,sys
s=socket.socket(socket.AF_UNIX); s.settimeout(3)
try:
    s.connect("/run/gw.sock"); print(sys.argv[1], "connect ok, read:", repr(s.recv(64)))
except Exception as e: print(sys.argv[1], type(e).__name__, e)
' "$1"; }
startgw() { /usr/bin/python3 "$HERE/host_listeners.py" gw "$GWD/gw.sock" 47300 "$WORK/host.log" > "$WORK/gw.out" 2>&1 & echo $! > "$WORK/gw.pid"; sleep 1; }
spoof() { /usr/bin/python3 -c '
import os,socket,sys
p=sys.argv[1]
try: os.unlink(p)
except FileNotFoundError: pass
s=socket.socket(socket.AF_UNIX); s.bind(p); s.listen(4)
while True:
    c,_=s.accept(); c.sendall(b"SPOOF\n"); c.close()
' "$GWD/gw.sock" & echo $! > "$WORK/spoof.pid"; sleep 1; }

uds "1.baseline"
echo "# stop the Gateway (socket file left behind)"
kill "$(cat "$WORK/gw.pid")"; sleep 1
uds "2.stopped-stale-file"
uds "3.stopped-stale-file-again"
echo "# restart the Gateway at the same path"
startgw
uds "4.after-restart"
uds "5.after-restart-again"
echo "# stop and remove the socket file"
kill "$(cat "$WORK/gw.pid")"; sleep 1; rm -f "$GWD/gw.sock"
uds "6.stopped-no-file"
startgw
uds "7.after-restart-new-file"
echo "# a different process binds the same path while the Gateway is down"
kill "$(cat "$WORK/gw.pid")"; sleep 1
spoof
uds "8.spoof"
kill "$(cat "$WORK/spoof.pid")"; sleep 1
startgw
uds "9.gateway-back"
