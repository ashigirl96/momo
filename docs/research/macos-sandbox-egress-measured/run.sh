#!/bin/sh
# Reproduces the measurements in ../macos-sandbox-egress-measured.md.
# usage: run.sh listeners | seatbelt | d1 | ac-image | ac
# Set LAN_IP and ROUTER_IP to this Mac's LAN address and default gateway first.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${WORK:-$HERE/.work}
mkdir -p "$WORK"
# macOS caps sun_path at 104 bytes, so the socket lives in a short private dir.
GWD=${GWD:-$(cat "$WORK/gwdir" 2>/dev/null || mktemp -d "${TMPDIR}momo-gw.XXXXXX")}
echo "$GWD" > "$WORK/gwdir"
PORTS="GW_TCP=47100 DECOY_LO=47101 DECOY_ANY=47102 DECOY_UDP=47103 PROBE_TIMEOUT=2"

case "$1" in
listeners)
  /usr/bin/python3 "$HERE/host_listeners.py" decoys 47101 47102 47103 "$WORK/host.log" &
  /usr/bin/python3 "$HERE/host_listeners.py" gw "$GWD/gw.sock" 47100 "$WORK/host.log" &
  wait
  ;;
seatbelt)
  # Base rules are copied verbatim from sandbox-runtime; only the network block is ours.
  gh api -H 'Accept: application/vnd.github.raw' \
    'repos/anthropics/sandbox-runtime/contents/src/sandbox/macos-sandbox-utils.ts?ref=9a277e5e04af1ab1b04feea4400a6ed8a5b72039' |
    sed -n '1084,1254p' | grep -E "^\s+'|^\s+\`" |
    sed -E "s/^ *['\`]//; s/['\`],?$//; s/\\\$\{logTag\}/momo-egress/" > "$WORK/seatbelt.sb"
  R=$(realpath "$GWD")
  cat >> "$WORK/seatbelt.sb" <<EOF
(allow system-socket (socket-domain AF_UNIX))
(allow network-bind (local unix-socket (subpath "$R")))
(allow network-outbound (remote unix-socket (subpath "$R")))
(allow network-bind (local ip "localhost:47100"))
(allow network-inbound (local ip "localhost:47100"))
(allow network-outbound (remote ip "localhost:47100"))
(allow file-read*)
(allow file-write* (literal "/dev/null"))
EOF
  env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin LAN_IP="$LAN_IP" ROUTER_IP="$ROUTER_IP" GW_UDS="$GWD/gw.sock" $PORTS \
    sandbox-exec -f "$WORK/seatbelt.sb" /usr/bin/python3 "$HERE/probe.py"
  ;;
d1)
  docker build -q -t momo-egress-probe:1 "$HERE" >/dev/null
  # shellcheck disable=SC2086
  docker run --rm -e LAN_IP="$LAN_IP" -e ROUTER_IP="$ROUTER_IP" $(printf -- '-e %s ' $PORTS) momo-egress-probe:1 python3 /probe.py
  ;;
ac-image)
  docker build -q -t momo-egress-probe:1 "$HERE" >/dev/null
  docker save --platform linux/arm64 momo-egress-probe:1 -o "$WORK/probe-image.tar"
  container image load -i "$WORK/probe-image.tar"
  ;;
ac)
  # shellcheck disable=SC2086
  container run -d --name momo-ac --network none -v "$GWD/gw.sock:/run/gw.sock" \
    -e LAN_IP="$LAN_IP" -e ROUTER_IP="$ROUTER_IP" -e GW_UDS=/run/gw.sock -e SHIM_PORT=3128 $(printf -- '-e %s ' $PORTS) \
    momo-egress-probe:1 sh -c 'socat TCP-LISTEN:3128,bind=127.0.0.1,fork,reuseaddr UNIX-CONNECT:/run/gw.sock & exec sleep infinity'
  container exec momo-ac python3 /probe.py
  container exec -e VSOCK_SCAN=1 momo-ac python3 -c 'import runpy; runpy.run_path("/probe.py")["vsock_scan"]()'
  ;;
*)
  echo "usage: $0 listeners|seatbelt|d1|ac-image|ac" >&2
  exit 2
  ;;
esac
