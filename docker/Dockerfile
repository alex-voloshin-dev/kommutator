# Build from the repository root; Dockerfile.dockerignore excludes local runtime data.
FROM node:26.13.0-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS build
RUN npm install --global --prefix /opt/pnpm --ignore-scripts pnpm@12.18.0 \
 && test "$(/opt/pnpm/bin/pnpm --version)" = 12.18.0
ENV PATH="/opt/pnpm/bin:${PATH}"
WORKDIR /src
COPY . .
# pnpm 12 legacy deploy copies the built workspace dependency without injection.
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

FROM node:26.13.0-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216
ENV NODE_ENV=production KOM_HUB_PORT=8787 KOM_HUB_BIND=0.0.0.0 KOM_HUB_DB=/data/kommutator.db KOM_KEY_FILE=/run/secrets/hub_key
WORKDIR /app
COPY --from=build /out .
COPY LICENSE ./LICENSE
COPY docker/start.mjs docker/secret.mjs docker/healthcheck.mjs docker/backup.mjs ./container/
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8787
CMD ["node", "/app/container/start.mjs"]
