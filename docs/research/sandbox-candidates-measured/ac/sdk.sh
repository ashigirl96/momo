#!/bin/sh
# Agent SDK runner inside Apple container: read-only root, uid 1000, the four writable dirs mounted
# from a host Session dir, and the fake Anthropic endpoint reached through a guest-side shim.
# usage: sdk.sh image | fake | create <name> | run <name> <mode> [env...] | rm <name>
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$HERE/.work
GWD=$(cat "$WORK/gwdir")
S=$WORK/sdk/session
mkdir -p "$S/cfg" "$S/home" "$S/work" "$S/state" "$S/log" "$WORK/sdk/fakelog"

cmd=$1
shift
case "$cmd" in
image)
  docker build -q -t momo-cmp-a-sdk:1 "$HERE/sdk" >/dev/null
  docker save --platform linux/arm64 momo-cmp-a-sdk:1 -o "$WORK/sdk.tar"
  container image load -i "$WORK/sdk.tar"
  ;;
fake)
  SOCK=$GWD/fa.sock LOG_DIR=$WORK/sdk/fakelog exec bun "$HERE/sdk/fake-uds.ts"
  ;;
create)
  # The sidecar runs as root under --init; the runner is started later with `exec -u 1000`.
  container run -d --name "$1" --progress none --network none --init --read-only \
    --tmpfs /tmp --dns 127.0.0.1 --cpus 2 --memory 2G --ulimit nproc=512:512 \
    -v "$GWD/fa.sock:/run/gw.sock" --mount "type=bind,source=$HERE/tools,target=/tools,readonly" \
    -v "$S/cfg:/cfg" -v "$S/home:/home/runner" -v "$S/work:/work" -v "$S/state:/state" -v "$S/log:/log" \
    -e HOME=/home/runner -e CLAUDE_CONFIG_DIR=/cfg -e WORK=/work -e LAN_IP="${LAN_IP:-}" -e ROUTER_IP="${ROUTER_IP:-}" \
    -e ANTHROPIC_BASE_URL=http://127.0.0.1:8080 -e ANTHROPIC_API_KEY=sk-ant-placeholder \
    --entrypoint bun momo-cmp-a-sdk:1 /app/sidecar.ts
  ;;
run)
  name=$1
  mode=$2
  shift 2
  envs=""
  for e in "$@"; do envs="$envs -e $e"; done
  # shellcheck disable=SC2086
  container exec -u 1000 -w /work $envs "$name" bun /app/probe.mjs "$mode"
  ;;
*)
  echo "usage: $0 image|fake|create|run" >&2
  exit 2
  ;;
esac
