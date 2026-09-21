# =============================================================================
# Portal Studenți — production image
# =============================================================================
# No build arguments: nothing the app needs is required at build time, so no
# secret can end up in an image layer. Everything is read at runtime.
#
# UPLOADS_DIR must be a mounted volume — attachments are the only application
# state that does not live in PostgreSQL.
# =============================================================================

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production dependencies only; the Astro node adapter resolves them at runtime.
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    TZ=Europe/Bucharest \
    UPLOADS_DIR=/app/uploads

# curl: Coolify's health check shells it; busybox wget resolves localhost to ::1.
# tzdata: without it TZ is accepted and silently ignored, and the portal would go
# on rendering UTC while telling everyone it meant Bucharest.
RUN apk add --no-cache curl tzdata

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node scripts ./scripts
# The plain-JS modules under src/lib that `scripts/` shares with the app. They
# have to be in the image because migrating and seeding happen inside the
# container: `migrate.mjs` reads the defaults from here (they do not apply in
# production — without DATABASE_URL the boot stops — but the import has to
# resolve or the container dies on its first line), and `seed.mjs` composes
# programme titles with the same function the app uses, so a seeded database
# cannot disagree with a migrated one.
#
# A wildcard rather than a list: naming one file is how seeding broke the day
# `programmes.mjs` appeared — the image built, the container was healthy, and
# the failure only surfaced when somebody ran the seed against production.
COPY --chown=node:node src/lib/*.mjs ./src/lib/

# Created in the image so a named volume mounted here inherits this ownership;
# otherwise the mount arrives root-owned and the unprivileged process cannot write.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3000/api/sanatate || exit 1

# Schema first: serving against an unmigrated database is worse than failing to boot.
# Migrations must succeed; seeding is demo data, so a failure there is logged and
# the app still serves rather than crash-looping on a fixture.
CMD ["sh", "-c", "node scripts/migrate.mjs && { node scripts/seed.mjs || echo '[seed] failed, continuing'; } && node ./dist/server/entry.mjs"]
