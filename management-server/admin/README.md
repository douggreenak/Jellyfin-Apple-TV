# Jellyfin — Fleet (Admin Dashboard)

The web admin dashboard for the Jellyfin Apple TV fleet management server. Operators
use it to register, configure, and monitor the Apple TVs that play content
from a self-hosted Jellyfin server.

Built with **React 18 + Vite + TypeScript + MUI (Material Design)**, with
**TanStack Query** for live polling of unit status.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

In development, Vite proxies `/api` → `http://localhost:4000` (the management server).
See `vite.config.ts`.

## Scripts

| Script              | What it does                                  |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Start the Vite dev server with API proxy      |
| `npm run build`     | Type-check (`tsc`) then build a production bundle into `dist/` |
| `npm run preview`   | Preview the production build locally          |
| `npm run typecheck` | `tsc --noEmit` — type-check only              |

## Configuration

Copy `.env.example` to `.env` if you need to override the API base path:

```
VITE_API_BASE=/api/v1
```

The dev proxy forwards `/api` to `http://localhost:4000`. In production, serve the
built `dist/` from the same origin as the API (or set up an equivalent reverse proxy).

## Authentication

- Sign in with the admin username/password configured on the server
  (`ADMIN_USERNAME` / `ADMIN_PASSWORD`).
- The JWT is stored in `localStorage` (`kc.admin.jwt`) and attached as
  `Authorization: Bearer <jwt>` on every admin request.
- Any `401` response clears the token and bounces you to `/login`.

## Pages

- **Units** (`/`) — Live grid of every registered Apple TV. Polls every 10s and shows
  online status, last-seen, model / tvOS / app version, what's playing, and quick
  **Identify** / **Reload** actions. Empty state explains that TVs appear here once they
  connect.
- **Unit detail** (`/units/:id`) — Tabbed editor: **General** (name, group, telemetry,
  Identify/Reload/Restart/Remove), **Jellyfin** (credentials + **Test connection** that
  lists discovered libraries), **Appearance**, **Browse** (mode + library pickers fed by
  the tested libraries), **Playback**, **Security** (PIN). A sticky save bar PATCHes only
  the fields you changed and confirms with a snackbar.
- **Defaults** (`/defaults`) — Edit the template applied to newly registered TVs. This is
  where staff set the shared Jellyfin account once.

## API contract

All calls live in `src/api/client.ts` and mirror the management-server contract:

- `POST /admin/auth/login`, `GET /admin/auth/me`
- `GET /admin/units`, `GET /admin/units/:id`
- `PATCH /admin/units/:id/config` (deep-partial), `POST /admin/units/:id/command`,
  `POST /admin/units/:id/rename`, `DELETE /admin/units/:id`
- `GET /admin/defaults`, `PUT /admin/defaults`
- `POST /admin/jellyfin/test`

## Project layout

```
src/
  api/client.ts          typed fetch wrapper + UnitConfig/Unit types
  auth.tsx               auth context + <RequireAuth> guard
  theme.ts               MUI theme (brand indigo #5E5CE6)
  App.tsx / main.tsx     routing + providers
  components/            AppShell, StatusDot, ConfirmDialog, TabPanel, config/*
  pages/                 Login, UnitsDashboard, UnitDetail, Defaults
  util/                  time + config diff helpers
```
