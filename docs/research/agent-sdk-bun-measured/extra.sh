# Alpine with bash (cancel), and rg inside the Bash tool on each image. Outputs under results/extra/.
D="$(cd "$(dirname "$0")" && pwd)"
R="$D/results/extra"; rm -rf "$R" "$D/st/x-"*; mkdir -p "$R"
KEY="-e ANTHROPIC_API_KEY=sk-ant-placeholder -e CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1"
x() { name="$1"; shift; S="x-$name" timeout 120 sh "$D/run.sh" "$@" $KEY > "$R/$name.jsonl" 2>&1; echo "done $name"; }
x alpinebash-cancel       bun-alpine-bash cancel
x alpinebash-cancel-init  bun-alpine-bash cancel --init
x alpinebash-grep         bun-alpine-bash grep
x alpinebash-rg           bun-alpine-bash rg
x alpinebash-rg-norg      bun-alpine-bash rg -e USE_BUILTIN_RIPGREP=0
x slim-rg                 bun-slim rg
x node22-rg               node22 rg
