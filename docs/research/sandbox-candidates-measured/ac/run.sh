#!/bin/sh
# Apple container 1.5.0 candidate: --network none plus a UDS relay to a fake Gateway.
# usage: run.sh image | listeners | gw | decoys | create <name> [extra run args] | probe <name> | vsock <name> | rm <name>
# Set LAN_IP and ROUTER_IP to this Mac's LAN address and default gateway first.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${WORK:-$HERE/.work}
mkdir -p "$WORK"
# macOS caps sun_path at 104 bytes, so the socket lives in a short private dir.
GWD=${GWD:-$(cat "$WORK/gwdir" 2>/dev/null || mktemp -d "${TMPDIR}momo-acgw.XXXXXX")}
echo "$GWD" > "$WORK/gwdir"
PORTS="GW_TCP=47300 DECOY_LO=47301 DECOY_ANY=47302 DECOY_UDP=47303 PROBE_TIMEOUT=2"
LAN_IP=${LAN_IP:-}
ROUTER_IP=${ROUTER_IP:-}

cmd=$1
shift
case "$cmd" in
image)
  docker build -q -t momo-cmp-a-probe:1 -f "$HERE/Dockerfile.probe" "$HERE" >/dev/null
  docker save --platform linux/arm64 momo-cmp-a-probe:1 -o "$WORK/probe.tar"
  container image load -i "$WORK/probe.tar"
  ;;
gw)
  exec /usr/bin/python3 "$HERE/host_listeners.py" gw "$GWD/gw.sock" 47300 "$WORK/host.log"
  ;;
decoys)
  exec /usr/bin/python3 "$HERE/host_listeners.py" decoys 47301 47302 47303 "$WORK/host.log"
  ;;
create)
  # The guest-side shim exposes the Gateway on lo:3128 for TCP-only clients.
  name=$1
  shift
  # shellcheck disable=SC2086
  container run -d --name "$name" --network none -v "$GWD/gw.sock:/run/gw.sock" \
    -e LAN_IP="$LAN_IP" -e ROUTER_IP="$ROUTER_IP" -e GW_UDS=/run/gw.sock -e SHIM_PORT=3128 $(printf -- '-e %s ' $PORTS) \
    "$@" momo-cmp-a-probe:1 sh -c 'socat TCP-LISTEN:3128,bind=127.0.0.1,fork,reuseaddr UNIX-CONNECT:/run/gw.sock & exec sleep infinity'
  ;;
probe)
  container exec "$1" python3 /probe.py
  ;;
probe-user)
  container exec -u 1000 "$1" python3 /probe.py
  ;;
vsock)
  container exec -e VSOCK_SCAN=1 "$1" python3 -c 'import runpy; runpy.run_path("/probe.py")["vsock_scan"]()'
  ;;
*)
  echo "usage: $0 image|gw|decoys|create|probe|probe-user|vsock" >&2
  exit 2
  ;;
esac
