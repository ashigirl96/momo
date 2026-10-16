# Long-running probes in parallel; outputs only out.jsonl under results/long/.
D="$(cd "$(dirname "$0")" && pwd)"
L="$D/results/long"; mkdir -p "$L"
KEY="-e ANTHROPIC_API_KEY=sk-ant-placeholder -e CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1"
S=long-a timeout 1000 sh "$D/run.sh" bun-slim mcpwait:660:720 $KEY > "$L/bun-mcp660-t720.jsonl" 2>&1 &
S=long-b timeout 1000 sh "$D/run.sh" bun-slim mcpwait:660:0   $KEY > "$L/bun-mcp660-default.jsonl" 2>&1 &
S=long-c timeout 1000 sh "$D/run.sh" node22   mcpwait:660:720 $KEY > "$L/node22-mcp660-t720.jsonl" 2>&1 &
S=long-d timeout 1000 sh "$D/run.sh" bun-slim ping:300 $KEY > "$L/bun-ping300.jsonl" 2>&1 &
wait
echo long done
