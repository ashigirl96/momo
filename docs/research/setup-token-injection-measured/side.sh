# Runs one basic query per env candidate and prints every HTTP request, DNS lookup and TCP attempt it caused.
D="$(cd "$(dirname "$0")" && pwd)"; cd "$D"
PH=sk-ant-oat01-momoPLACEHOLDER0000000000000000000000000000000000000000000000000000000000000000000000-AAAAAA
for ENV in CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_AUTH_TOKEN; do
  rm -f log/requests.jsonl log/dns.jsonl log/tcp.jsonl
  echo "=== $ENV $*"
  S=side-$ENV sh run.sh basic:MARKER -e "$ENV=$PH" "$@" 2>&1 | grep -E '"result"' | cut -c1-120
  sleep 3
  jq -c '{m:.method,p:.path,port}' log/requests.jsonl
  cat log/dns.jsonl log/tcp.jsonl 2>/dev/null | jq -c '{name,port,sni}' | sort | uniq -c
done
