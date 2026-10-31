# Build from the repository root; Dockerfile.dockerignore excludes local runtime data.
FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
WORKDIR /src
COPY . .
# pnpm 10 legacy deploy copies the built workspace dependency without injection.
RUN pnpm install --frozen-lockfile \
 && pnpm -r build \
 && pnpm --filter @kommutator/hub deploy --legacy --prod /out \
 && cd /out && node --input-type=module -e "\
      import { openDatabase } from './dist/db.js'; \
      import { createHubServer } from './dist/server.js'; \
      const db = openDatabase(':memory:'); \
      createHubServer({ db, key: 'smoke-test-key-0123456789' }).close(); \
      db.close(); \
      console.log('hub deploy ok');"

FROM node:24-alpine
ENV NODE_ENV=production KOM_HUB_PORT=8787 KOM_HUB_BIND=0.0.0.0 KOM_HUB_DB=/data/kommutator.db KOM_KEY_FILE=/run/secrets/hub_key
WORKDIR /app
COPY --from=build /out .
COPY docker/start.mjs docker/secret.mjs docker/healthcheck.mjs docker/backup.mjs ./container/
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8787
CMD ["node", "/app/container/start.mjs"]
