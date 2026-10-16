# sh suite.sh <image>  -- runs every short probe sequentially and stores per-test logs under results/<image>/<test>/.
D="$(cd "$(dirname "$0")" && pwd)"
IMG="$1"
R="$D/results/$IMG"; rm -rf "$R" "$D/st/$IMG-"*; mkdir -p "$R"
KEY="-e ANTHROPIC_API_KEY=sk-ant-placeholder"
QUIET="-e CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1"
t() { # t <test-name> <state-name> <mode> [docker args...]
  name="$1"; st="$2"; mode="$3"; shift 3
  : > "$D/log/requests.jsonl"; : > "$D/log/dns.jsonl"; : > "$D/log/tcp.jsonl"; : > "$D/log/sse.jsonl"
  mkdir -p "$R/$name"
  S="$IMG-$st" timeout 300 sh "$D/run.sh" "$IMG" "$mode" "$@" > "$R/$name/out.jsonl" 2>&1
  echo "exit=$?" >> "$R/$name/out.jsonl"
  sleep 1
  cp "$D"/log/*.jsonl "$R/$name/"
  (cd "$D/st/$IMG-$st" && find . -type f | sort) > "$R/$name/files.txt"
  echo "done $IMG $name"
}
t basic-apikey     a basic $KEY
t basic-authtoken  b basic -e ANTHROPIC_AUTH_TOKEN=placeholder
t basic-nocreds    c basic
t basic-quiet      d basic $KEY $QUIET
t webfetch         e webfetch $KEY $QUIET
t webfetch-skip    f webfetch $KEY $QUIET -e SKIP_PREFLIGHT=1
t stream           g stream $KEY $QUIET
t cancel           h cancel $KEY $QUIET
t cancel-init      i cancel $KEY $QUIET --init
t interrupt        j interrupt $KEY $QUIET
t close            k close $KEY $QUIET
t resume1          r resume1 $KEY $QUIET
t resume2          r resume2 $KEY $QUIET
t fork             r fork $KEY $QUIET
t nopersist        n nopersist $KEY $QUIET
t mcp-timeout30    m mcpwait:60:30 $KEY $QUIET
t ping90           p ping:90 $KEY $QUIET
