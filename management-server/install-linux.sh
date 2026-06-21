#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Jellyfin management server — one-shot installer for a Linux box.
#
# What it does:
#   1. Checks that Docker + the Compose plugin are installed.
#   2. Creates server/.env from the example if it's missing.
#   3. Offers to open it in an editor so you can set the admin password.
#   4. Builds and starts everything with `docker compose up -d --build`.
#   5. Prints the dashboard URL and the device API base URLs.
#
# Re-running it is safe: it won't clobber an existing server/.env.
#
# Usage:
#   chmod +x install-linux.sh
#   ./install-linux.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Always operate from the directory this script lives in.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# --- pretty output ----------------------------------------------------------
if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"; GREEN="$(printf '\033[32m')"
  YELLOW="$(printf '\033[33m')"; RED="$(printf '\033[31m')"
  CYAN="$(printf '\033[36m')"; RESET="$(printf '\033[0m')"
else
  BOLD=""; GREEN=""; YELLOW=""; RED=""; CYAN=""; RESET=""
fi
info()  { echo "${CYAN}==>${RESET} $*"; }
ok()    { echo "${GREEN}✓${RESET} $*"; }
warn()  { echo "${YELLOW}!${RESET} $*"; }
die()   { echo "${RED}✗ $*${RESET}" >&2; exit 1; }

echo "${BOLD}Jellyfin management server — installer${RESET}"
echo

# --- 1. prerequisites -------------------------------------------------------
info "Checking prerequisites..."

if ! command -v docker >/dev/null 2>&1; then
  die "Docker is not installed. Install it first:  https://docs.docker.com/engine/install/"
fi
ok "docker found ($(docker --version 2>/dev/null | head -n1))"

# Prefer the modern `docker compose` (v2 plugin); fall back to legacy `docker-compose`.
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
  warn "Using legacy docker-compose. The v2 plugin ('docker compose') is recommended."
else
  die "Docker Compose is not available. Install the Compose plugin:  https://docs.docker.com/compose/install/"
fi
ok "compose found via: ${COMPOSE}"

# Make sure the Docker daemon is actually reachable.
if ! docker info >/dev/null 2>&1; then
  die "Cannot talk to the Docker daemon. Is it running? Do you need to run with sudo, or add your user to the 'docker' group?"
fi
ok "docker daemon is reachable"
echo

# --- 2. server/.env ---------------------------------------------------------
ENV_FILE="server/.env"
ENV_EXAMPLE="server/.env.example"

if [ -f "$ENV_FILE" ]; then
  ok "$ENV_FILE already exists — leaving it as-is."
else
  [ -f "$ENV_EXAMPLE" ] || die "$ENV_EXAMPLE is missing — cannot create $ENV_FILE."
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  ok "Created $ENV_FILE from the example."

  # Auto-generate a strong JWT secret so nobody ships the placeholder.
  if command -v openssl >/dev/null 2>&1; then
    SECRET="$(openssl rand -hex 32)"
    # Replace the JWT_SECRET line in place (portable sed: write to temp, move back).
    if grep -q '^JWT_SECRET=' "$ENV_FILE"; then
      tmp="$(mktemp)"
      sed "s|^JWT_SECRET=.*|JWT_SECRET=${SECRET}|" "$ENV_FILE" > "$tmp" && mv "$tmp" "$ENV_FILE"
      ok "Generated a random JWT_SECRET."
    fi
  else
    warn "openssl not found — set JWT_SECRET by hand in $ENV_FILE."
  fi

  echo
  warn "IMPORTANT: set a real ADMIN_PASSWORD in $ENV_FILE before exposing this to a network."
  # Offer to open an editor (only if we're on an interactive terminal).
  if [ -t 0 ]; then
    printf "Open %s in an editor now? [Y/n] " "$ENV_FILE"
    read -r reply || reply="n"
    case "${reply:-Y}" in
      [Nn]*) info "Skipping. Edit $ENV_FILE yourself, then re-run this script.";;
      *)     "${EDITOR:-nano}" "$ENV_FILE" || warn "Editor exited non-zero; continuing.";;
    esac
  else
    warn "Non-interactive shell — edit $ENV_FILE manually, then re-run."
  fi
fi
echo

# --- 3. build + start -------------------------------------------------------
info "Building and starting containers (this can take a few minutes the first time)..."
$COMPOSE up -d --build
ok "Containers are up."
echo

# --- 4. report URLs ---------------------------------------------------------
# Best-effort guess at the box's LAN IP for the printout.
HOST_IP=""
if command -v hostname >/dev/null 2>&1; then
  HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi
[ -n "$HOST_IP" ] || HOST_IP="<this-box-ip>"

echo "${BOLD}${GREEN}Done!${RESET}"
echo
echo "${BOLD}Admin dashboard${RESET}"
echo "    http://${HOST_IP}:8080"
echo "    (log in with ADMIN_USERNAME / ADMIN_PASSWORD from server/.env)"
echo
echo "${BOLD}Device API base — point the Apple TVs at ONE of these${RESET}"
echo "    via admin proxy : http://${HOST_IP}:8080/api/v1"
echo "    direct          : http://${HOST_IP}:4000/api/v1"
echo
echo "Manage with:"
echo "    ${COMPOSE} logs -f       # watch logs"
echo "    ${COMPOSE} ps            # status"
echo "    ${COMPOSE} down          # stop (your data in ./data is kept)"
echo
warn "On a real network, put this behind HTTPS (see README.md → 'HTTPS'):"
warn "the Jellyfin service-account password is pushed to devices and should not travel in clear text."
