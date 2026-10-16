#!/bin/sh
# Fails when a domain's schema.ts has changes without a generated migration,
# or when drizzle-kit check finds the migration history inconsistent.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
kit="$root/node_modules/.bin/drizzle-kit"
status=0
for config in "$root"/packages/*/drizzle.config.ts; do
  dir=$(dirname "$config")
  domain=$(basename "$dir")
  out=$(cd "$dir" && "$kit" generate --explain 2>&1) || { echo "$out"; exit 1; }
  if printf '%s' "$out" | grep -q -- "--- Generated migration statements ---"; then
    echo "drift in $domain: run 'bun run db:generate $domain <name>'"
    printf '%s\n' "$out" | sed -n '/--- Generated migration statements ---/,$p'
    status=1
  fi
  (cd "$dir" && "$kit" check >/dev/null) || { echo "drizzle-kit check failed in $domain"; status=1; }
done
exit "$status"
