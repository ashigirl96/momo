# Builds the probe images. Bun images follow Bun's Docker guide; Node images are the comparison baseline.
set -e
cd "$(dirname "$0")/img"
docker build -q -f Dockerfile.bun  --build-arg BASE=oven/bun:1.4.2-slim   -t sdk16:bun-slim   .
docker build -q -f Dockerfile.bun  --build-arg BASE=oven/bun:1.4.2-alpine -t sdk16:bun-alpine .
docker build -q -f Dockerfile.node --build-arg BASE=node:22-slim          -t sdk16:node22     .
docker build -q -f Dockerfile.node --build-arg BASE=node:24-slim          -t sdk16:node24     .
docker build -q -f Dockerfile.alpine-bash -t sdk16:bun-alpine-bash .
for t in bun-slim bun-alpine node22 node24; do echo "== $t"; docker run --rm --entrypoint cat sdk16:$t /app/installed.txt; done
docker images sdk16 --format '{{.Tag}} {{.Size}}'
