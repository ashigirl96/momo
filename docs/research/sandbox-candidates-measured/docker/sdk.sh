#!/bin/sh
# Runs common/sdk/probe/probe.mjs as the agent on the isolated internal network, with the four
# writable dirs bind-mounted from a per-session host dir, and captures the agent netns with tcpdump.
# usage: sdk.sh <session> <mode> [quiet]   (quiet adds CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 and skipWebFetchPreflight)
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
S=$1; MODE=$2; QUIET=${3:-}
SD=$HERE/.work/sess/$S
OUT=$HERE/.work/sdk-$S-$MODE${QUIET:+-quiet}
mkdir -p "$SD/home" "$SD/work" "$SD/cfg" "$SD/state" "$OUT"
NAME=momo-cmp-d-sdk-$S
EXTRA=""
[ -n "$QUIET" ] && EXTRA="-e CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 -e SKIP_PREFLIGHT=1"
docker rm -f "$NAME" "$NAME-cap" >/dev/null 2>&1 || true
# shellcheck disable=SC2086
docker create --name "$NAME" --network momo-cmp-d-iso \
  --cap-drop=ALL --security-opt no-new-privileges --init --pids-limit 512 --cpus 2 --memory 1g --memory-swap 1g \
  --user 1000:1000 --read-only --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  -v "$HERE/../common/sdk/probe/probe.mjs:/app/probe.mjs:ro" \
  -v "$SD/home:/home/runner" -v "$SD/work:/work" -v "$SD/cfg:/cfg" -v "$SD/state:/state" \
  -e HOME=/home/runner -e WORK=/work -e CLAUDE_CONFIG_DIR=/cfg \
  -e ANTHROPIC_BASE_URL=http://gateway:3130 -e ANTHROPIC_API_KEY=sk-ant-placeholder $EXTRA \
  --entrypoint sh momo-cmp-d-sdk:1 -c "sleep 2; exec bun /app/probe.mjs $MODE" >/dev/null
START=$(python3 -c 'import time;print(time.time())')
docker start "$NAME" >/dev/null
docker run -d --name "$NAME-cap" --network "container:$NAME" --cap-add NET_ADMIN --cap-add NET_RAW momo-cmp-d-probe:1 \
  tcpdump -i any -nn -l -A -s 200 'not (tcp port 3130)' >/dev/null
docker wait "$NAME" >/dev/null
END=$(python3 -c 'import time;print(time.time())')
docker logs "$NAME" > "$OUT/probe.jsonl" 2>&1
sleep 1
docker logs "$NAME-cap" > "$OUT/tcpdump.txt" 2>&1 || true
docker rm -f "$NAME" "$NAME-cap" >/dev/null
python3 -c "print('wall', round($END-$START,2), 's')" > "$OUT/wall.txt"
echo "$OUT"
