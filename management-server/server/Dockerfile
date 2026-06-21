# ─────────────────────────────────────────────────────────────────────────────
# Jellyfin management server — backend image
# Multi-stage: compile TypeScript in a "builder", then ship a slim runtime that
# only contains node_modules + compiled dist.
#
# better-sqlite3 is a NATIVE module: it compiles C++ at install time, so the
# builder stage needs python3 + make + g++ (the node-gyp toolchain).
# ─────────────────────────────────────────────────────────────────────────────

# ---- Stage 1: build -------------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Native build toolchain for better-sqlite3 (node-gyp needs python3/make/g++).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Install all deps (incl. devDeps like typescript/tsx) using the lockfile when
# present. This layer is cached unless package*.json changes.
COPY package*.json ./
RUN npm ci || npm install

# Compile TypeScript -> dist/
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop devDependencies so only the runtime node_modules (including the already
# compiled better-sqlite3 native binary) are carried to the final image.
RUN npm prune --omit=dev

# ---- Stage 2: runtime -----------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Pruned production node_modules (with the prebuilt native .node binary) and the
# compiled JS. No build tools, no TypeScript sources in the final image.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json ./

# SQLite database lives here; declared as a volume so it survives `down`/rebuild.
# DB_PATH in .env defaults to ./data/jellyfin.db relative to /app.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 4000

CMD ["node", "dist/index.js"]
