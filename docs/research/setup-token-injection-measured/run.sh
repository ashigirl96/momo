# S=<state-name> sh run.sh <mode> [extra docker args...]
D="$(cd "$(dirname "$0")" && pwd)"
MODE="$1"; shift
S="${S:-$MODE}"
rm -rf "$D/st/$S"; mkdir -p "$D/st/$S/home" "$D/st/$S/work" "$D/st/$S/cfg"
docker run --rm --network sdk31net -v "$D/resolv.conf":/etc/resolv.conf:ro \
  --user 1000:1000 --read-only --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  -v "$D/probe/probe.mjs":/app/probe.mjs:ro \
  -v "$D/st/$S/home":/home/runner -v "$D/st/$S/work":/work -v "$D/st/$S/cfg":/cfg \
  -e HOME=/home/runner -e WORK=/work -e CLAUDE_CONFIG_DIR=/cfg \
  -e ANTHROPIC_BASE_URL=${BASE:-http://172.30.31.2:8080} -e DISABLE_UPDATES=1 \
  "$@" --entrypoint bun sdk31:bun-slim /app/probe.mjs "$MODE"
