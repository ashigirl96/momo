# S=<state-name> sh run.sh <image> <mode> [extra docker args...]
# Runs probe.mjs as uid 1000 on a read-only root fs with placeholder creds against the fake endpoint.
D="$(cd "$(dirname "$0")" && pwd)"
IMG="$1"; MODE="$2"; shift 2
S="${S:-$IMG-$MODE}"
case "$IMG" in bun-*) RT=bun;; *) RT=node;; esac
mkdir -p "$D/st/$S/home" "$D/st/$S/work" "$D/st/$S/cfg" "$D/st/$S/state"
docker run --rm --network sdk16net -v "$D/resolv.conf":/etc/resolv.conf:ro \
  --user 1000:1000 --read-only --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  -v "$D/probe/probe.mjs":/app/probe.mjs:ro \
  -v "$D/st/$S/home":/home/runner -v "$D/st/$S/work":/work -v "$D/st/$S/cfg":/cfg -v "$D/st/$S/state":/state \
  -e HOME=/home/runner -e WORK=/work -e CLAUDE_CONFIG_DIR=/cfg \
  -e ANTHROPIC_BASE_URL=http://172.30.16.2:8080 \
  "$@" --entrypoint "$RT" "sdk16:$IMG" /app/probe.mjs "$MODE"
