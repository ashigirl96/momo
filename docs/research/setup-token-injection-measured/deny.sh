# Measures how long the CLI keeps retrying for each status securityd could return on a bad credential.
D="$(cd "$(dirname "$0")" && pwd)"; cd "$D"
for C in "401 authentication_error" "403 permission_error"; do
  set -- $C
  rm -f log/proxy.jsonl
  UPSTREAM=http://172.30.31.2:8080 DENY_STATUS=$1 DENY_TYPE=$2 sh proxy.sh "$D/fake-token" >/dev/null
  echo "=== $1 $2"
  BASE=http://172.30.31.3:8080 S=deny$1 timeout 300 sh run.sh basic:X -e ANTHROPIC_AUTH_TOKEN=wrong -e CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 2>&1 | grep -E '"result"' | head -1 | jq -c '{dt, r: .msg.result}'
  printf 'attempts: '; grep -c deny-credential log/proxy.jsonl
done
