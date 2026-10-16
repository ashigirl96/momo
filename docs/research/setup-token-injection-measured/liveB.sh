# Candidate B against the real API: without and with the proxy adding the OAuth beta. Stops the CLI's retry loop at 40s.
D="$(cd "$(dirname "$0")" && pwd)"; cd "$D"
for B in "" "oauth-2025-04-20"; do
  echo "=== ADD_BETA='$B'"; rm -f log/proxy.jsonl
  UPSTREAM=https://api.anthropic.com ADD_BETA="$B" sh proxy.sh "$D/real-token" >/dev/null
  ENV=ANTHROPIC_AUTH_TOKEN S="liveB$B" MODE="basic:Reply with the single word OK" timeout 40 sh via.sh 2>&1 | grep -E '"assistant"|"result"' | cut -c1-200
  jq -c 'del(.beta)' log/proxy.jsonl | head -4
done
