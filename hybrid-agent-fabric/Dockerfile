FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/package.json
COPY apps/control-api/package.json apps/control-api/package.json
COPY apps/acp-server/package.json apps/acp-server/package.json
COPY apps/session-worker/package.json apps/session-worker/package.json
COPY apps/wasi-runner/package.json apps/wasi-runner/package.json
COPY apps/canvas-web/package.json apps/canvas-web/package.json
RUN npm ci
COPY packages packages
COPY apps apps
COPY python python
RUN npm run build

FROM node:20-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production HAF_HOME=/data HAF_HOST=0.0.0.0 HAF_PORT=8787
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/engine/package.json packages/engine/package.json
COPY --from=build /app/packages/engine/dist packages/engine/dist
COPY --from=build /app/apps/control-api/package.json apps/control-api/package.json
COPY --from=build /app/apps/control-api/dist apps/control-api/dist
COPY --from=build /app/apps/acp-server/package.json apps/acp-server/package.json
COPY --from=build /app/apps/acp-server/dist apps/acp-server/dist
COPY --from=build /app/apps/session-worker/package.json apps/session-worker/package.json
COPY --from=build /app/apps/session-worker/dist apps/session-worker/dist
COPY --from=build /app/apps/wasi-runner/package.json apps/wasi-runner/package.json
COPY --from=build /app/apps/wasi-runner/dist apps/wasi-runner/dist
COPY --from=build /app/apps/canvas-web/package.json apps/canvas-web/package.json
COPY --from=build /app/apps/canvas-web/dist apps/canvas-web/dist
COPY --from=build /app/python python
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/control-api/dist/main.js"]
