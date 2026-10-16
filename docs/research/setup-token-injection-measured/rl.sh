# Compares the rate-limit headers the real API returns for each placeholder env.
D="$(cd "$(dirname "$0")" && pwd)"; cd "$D"
UPSTREAM=https://api.anthropic.com sh proxy.sh "$D/real-token" >/dev/null
for E in CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_AUTH_TOKEN; do
  echo "=== $E"; rm -f log/proxy.jsonl
  ENV=$E S="rl$E" MODE="basic:Reply with the single word OK" timeout 60 sh via.sh -e ANTHROPIC_MODEL=claude-haiku-5-5 2>&1 | grep -E '"result"' | cut -c1-120
  jq -c 'select(.verdict) | {status, rl}' log/proxy.jsonl
done
