#!/bin/sh
# Usage: bun run db:generate <domain> <name> [--custom]
set -eu
if [ $# -lt 2 ]; then
  echo "usage: bun run db:generate <domain> <name> [--custom]" >&2
  exit 2
fi
root=$(cd "$(dirname "$0")/.." && pwd)
domain=$1
name=$2
shift 2
cd "$root/packages/$domain"
exec "$root/node_modules/.bin/drizzle-kit" generate --name "$name" "$@"
