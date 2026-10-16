#!/bin/sh
# container stop/start, a missing Gateway socket at start, and container system stop/start.
# usage: restart.sh <container>
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$HERE/.work
GWD=$(cat "$WORK/gwdir")
C=$1
summary() { container exec "$C" python3 /probe.py | awk -F'\t' '{n[$2]++} $2=="REACHED"{r=r" "$1} END{printf "REACHED=%d BLOCKED=%d SENT=%d reached:%s\n", n["REACHED"], n["BLOCKED"], n["SENT"], r}'; }
startgw() { /usr/bin/python3 "$HERE/host_listeners.py" gw "$GWD/gw.sock" 47300 "$WORK/host.log" > "$WORK/gw.out" 2>&1 & echo $! > "$WORK/gw.pid"; sleep 1; }
t() { s=$(/usr/bin/python3 -c 'import time;print(time.time())'); "$@"; rc=$?; e=$(/usr/bin/python3 -c 'import time;print(time.time())'); /usr/bin/python3 -c "print('  took %.2fs rc=$rc' % ($e-$s))"; }

echo "# baseline"; summary
echo "# container stop"; t container stop "$C"
echo "# start with the Gateway down and its socket removed"
kill "$(cat "$WORK/gw.pid")"; sleep 1; rm -f "$GWD/gw.sock"
t container start "$C" 2>&1 | tail -2
container list -a | grep "$C"
echo "# start the Gateway, then the container"
startgw
t container start "$C"
summary
echo "# container system stop"
t container system stop
pgrep -fl 'container-runtime-linux|container-apiserver' || echo "(no container processes)"
echo "# container system start"
t container system start --disable-kernel-install >/dev/null
container list -a
for c in $(container list -a | awk 'NR>1{print $1}'); do t container start "$c" >/dev/null; done
container list -a
summary
