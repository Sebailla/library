# Multi-stage build for alejandria-nas-backend.
#
# Stage 1 (build): install all deps and compile TypeScript → dist/.
# Stage 2 (deps):  install ONLY production deps for the runtime image.
# Stage 3 (runtime): copy dist + production node_modules, run as non-root.
#
# Build-time arguments (consumed by docker-publish.yml):
#   * VERSION   — semver from package.json (e.g. 0.5.1)
#   * VCS_REF   — full git SHA of the commit being built
#   * BUILD_DATE — RFC 3339 timestamp of the build (set by CI to ISO format)

# ---------- Stage 1: build ----------
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Install all deps (dev included) so we can compile.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Compile TypeScript via the nest CLI.
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---------- Stage 2: production deps ----------
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------- Stage 3: runtime ----------
FROM node:20-bookworm-slim AS runtime

# Build-time args (consumed in this stage only — defaults make local
# `docker build .` work without --build-arg).
ARG VERSION="0.0.0-local"
ARG VCS_REF="unknown"
ARG BUILD_DATE="1970-01-01T00:00:00Z"

ENV NODE_ENV=production \
    PORT=3000

# OCI image annotations — surfaced by `docker inspect` and registries
# (Docker Hub, GHCR) so consumers can see provenance without pulling.
LABEL org.opencontainers.image.title="alejandria-nas-backend" \
      org.opencontainers.image.description="NestJS NAS backend for alejandria-v2 — Postgres + pgroonga + Redis + BullMQ." \
      org.opencontainers.image.source="https://github.com/Sebailla/library" \
      org.opencontainers.image.licenses="Proprietary" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.authors="Sebastián Bailla <sebailla@example.com>"

# Run as the unprivileged ``node`` user that ships with the base image.
WORKDIR /app
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist          ./dist
COPY package.json ./package.json

EXPOSE 3000

# Use the existing /livez liveness endpoint so orchestrators
# (Container Station, Compose, Kubernetes) can probe without auth.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+process.env.PORT+'/livez',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/main.js"]