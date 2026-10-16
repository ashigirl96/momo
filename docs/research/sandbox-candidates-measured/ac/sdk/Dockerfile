# common/sdk/img/Dockerfile.bun plus the probe baked in, so the guest needs no extra mount.
FROM oven/bun:1.4.2-slim AS install
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

FROM oven/bun:1.4.2-slim
WORKDIR /app
COPY --from=install /temp/prod/node_modules node_modules
COPY package.json .
COPY probe.mjs sidecar.ts /app/
RUN ls node_modules/@anthropic-ai/ > /app/installed.txt && du -sh node_modules >> /app/installed.txt
