#!/bin/sh
# Reproduces the Docker (NanoClaw-style) measurements in RESULTS.md.
# usage: run.sh listeners | image | net | relay | probe <net> [agent-name] | teardown
# Set LAN_IP and ROUTER_IP to this Mac's LAN address and default gateway first.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${WORK:-$HERE/.work}
mkdir -p "$WORK"
# macOS caps sun_path at 104 bytes, so the socket lives in a short private dir.
GWD=${GWD:-$(cat "$WORK/gwdir" 2>/dev/null || mktemp -d "${TMPDIR:-/tmp/}momo-dgw.XXXXXX")}
echo "$GWD" > "$WORK/gwdir"
IMG=momo-cmp-d-probe:1
NET_PLAIN=momo-cmp-d-int
NET_ISO=momo-cmp-d-iso
RELAY=momo-cmp-d-relay
PORTS="GW_TCP=47200 DECOY_LO=47201 DECOY_ANY=47202 DECOY_UDP=47203 PROBE_TIMEOUT=2"
# The agent flags NanoClaw f2934ab passes in hardeningArgs/userArgs, plus a read-only root.
AGENT_FLAGS="--cap-drop=ALL --security-opt no-new-privileges --init --pids-limit 256 --user 1000:1000 --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m"

case "$1" in
listeners)
  python3 "$HERE/host_listeners.py" decoys 47201 47202 47203 "$WORK/host.log" &
  python3 "$HERE/host_listeners.py" gw "$GWD/gw.sock" 47200 "$WORK/host.log" &
  wait
  ;;
image)
  docker build -q -t "$IMG" "$HERE" >/dev/null
  ;;
net)
  docker network inspect "$NET_PLAIN" >/dev/null 2>&1 || docker network create --internal "$NET_PLAIN" >/dev/null
  docker network inspect "$NET_ISO" >/dev/null 2>&1 ||
    docker network create --internal -o com.docker.network.bridge.gateway_mode_ipv4=isolated "$NET_ISO" >/dev/null
  ;;
relay)
  # 3128 forwards to the host UDS through a bind mount, 3129 to the host TCP port through host.docker.internal.
  docker rm -f "$RELAY" >/dev/null 2>&1 || true
  docker run -d --name "$RELAY" --network bridge --read-only --cap-drop=ALL --security-opt no-new-privileges --init \
    -v "$GWD:/run/gw" "$IMG" sh -c '
      socat TCP-LISTEN:3128,fork,reuseaddr UNIX-CONNECT:/run/gw/gw.sock &
      socat TCP-LISTEN:3129,fork,reuseaddr TCP:host.docker.internal:47200 &
      socat TCP-LISTEN:3130,fork,reuseaddr TCP:host.docker.internal:47210 &
      wait' >/dev/null
  docker network connect --alias gateway "$NET_PLAIN" "$RELAY"
  docker network connect --alias gateway "$NET_ISO" "$RELAY"
  ;;
probe)
  NET=$2
  NAME=${3:-momo-cmp-d-agent}
  GW_IP=$(docker network inspect "$NET" --format '{{(index .IPAM.Config 0).Gateway}}')
  RELAY_IP=$(docker inspect "$RELAY" --format "{{(index .NetworkSettings.Networks \"$NET\").IPAddress}}")
  RELAY_BRIDGE_IP=$(docker inspect "$RELAY" --format '{{.NetworkSettings.Networks.bridge.IPAddress}}')
  BRIDGE_GW=$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')
  EXTRA="relay_uds=gateway:3128,relay_tcp=gateway:3129,relay_ssh=gateway:22,relay_other=$RELAY_IP:8080"
  EXTRA="$EXTRA,netgw_decoy_any=$GW_IP:47202,netgw_gw_tcp=$GW_IP:47200,netgw_53=$GW_IP:53,netgw_2375=$GW_IP:2375"
  EXTRA="$EXTRA,relay_bridge_ip=$RELAY_BRIDGE_IP:3128,bridge_gw_decoy=$BRIDGE_GW:47202"
  EXTRA="$EXTRA,dockerdns_53=127.0.0.11:53,${OTHER_TCP:-}"
  # shellcheck disable=SC2086
  docker run --rm --name "$NAME" --network "$NET" $AGENT_FLAGS \
    -e LAN_IP="$LAN_IP" -e ROUTER_IP="$ROUTER_IP" -e EXTRA_TCP="$EXTRA" -e EXTRA_GAI="gateway,host.docker.internal,gateway.docker.internal" \
    $(printf -- '-e %s ' $PORTS) "$IMG" python3 /probe.py
  ;;
teardown)
  docker rm -f "$RELAY" >/dev/null 2>&1 || true
  docker network rm "$NET_PLAIN" "$NET_ISO" >/dev/null 2>&1 || true
  ;;
*)
  echo "usage: $0 listeners|image|net|relay|probe <net>|teardown" >&2
  exit 2
  ;;
esac
