#!/bin/sh
# usage: build.sh <variant> <dest>
set -e
cd "$(dirname "$0")/probe"
PROBE_VARIANT="$1" cargo build --release -q
mkdir -p "$(dirname "$2")"
cp target/release/probe "$2.tmp" && mv "$2.tmp" "$2"
