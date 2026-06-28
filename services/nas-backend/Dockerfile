# Multi-stage build for alejandria-nas-backend.
#
# Stage 1 (build): install all deps and compile TypeScript → dist/.
# Stage 2 (deps):  install ONLY production deps for the runtime image.
# Stage 3 (runtime): copy dist + production node_modules, run as non-root.

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
ENV NODE_ENV=production \
    PORT=3000

# Run as the unprivileged ``node`` user that ships with the base image.
WORKDIR /app
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist          ./dist
COPY package.json ./package.json

EXPOSE 3000
CMD ["node", "dist/main.js"]
