# ─────────────────────────────────────────────────────────────────────────────
# Jellyfin admin dashboard — static site image
# Multi-stage: build the Vite/React app, then serve the static dist/ with nginx.
# nginx also reverse-proxies /api/ to the backend so the browser only ever talks
# to one origin (no CORS headaches, and the device API works through here too).
# ─────────────────────────────────────────────────────────────────────────────

# ---- Stage 1: build -------------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Install deps (cached unless package*.json changes).
COPY package*.json ./
RUN npm ci || npm install

# Build the SPA. `npm run build` = `tsc && vite build` -> outputs to /app/dist.
# VITE_API_BASE defaults to /api/v1 (see .env.example); the app calls /api/v1/*
# which nginx proxies to the server.
COPY . .
RUN npm run build

# ---- Stage 2: serve -------------------------------------------------------
FROM nginx:alpine AS runtime

# Replace the default site with our SPA + API-proxy config.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Compiled static assets.
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

# nginx:alpine's default CMD already runs nginx in the foreground.
