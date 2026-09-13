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
  **Identify** / **Reload** actions, plus **bulk fleet actions** (adopt/unadopt/reload/
  identify/restart/delete/migrate) over a multi-selection. Empty state explains that TVs
  appear here once they connect.
- **Unit detail** (`/units/:id`) — Tabbed editor: **General** (name, group, telemetry,
  Identify/Reload/Restart/Remove), **Jellyfin** (credentials + **Test connection** that
  lists discovered libraries), **Appearance**, **Browse** (mode + library pickers, including
  a folder-lock tree fed by the Jellyfin browse/resolve endpoints), **Playback**, and a
  **remote control + power** panel (pair the unit's physical Apple TV over pyatv, then send
  remote-control key presses or turn it on/off). A sticky save bar PATCHes only the fields
  you changed and confirms with a snackbar.
- **Defaults** (`/defaults`) — Edit the template applied to newly registered TVs, including a
  **"push to all"** action that re-sends just the Jellyfin account to every existing unit.
- **Schedule** (`/schedule`) — Power on/off schedules (name, time, weekdays, target
  all/group/unit); create, edit, delete, or run one immediately to test it.
- **Data** (`/data`) — Export the full server config (defaults + every unit) as a backup
  file, or import one to restore/seed a server.

## API contract

All calls live in `src/api/client.ts` and mirror the management-server contract (see
[`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §2 for the authoritative,
fully-detailed list):

- `POST /admin/auth/login`, `GET /admin/auth/me`, `POST /admin/auth/change-password`
- `GET /admin/units`, `GET /admin/units/:id`, `POST /admin/units/bulk`,
  `POST /admin/units/push-jellyfin`
- `PATCH /admin/units/:id/config` (deep-partial), `POST /admin/units/:id/command`,
  `POST /admin/units/:id/rename`, `DELETE /admin/units/:id`
- `GET`/`PUT`/`DELETE /admin/units/:id/power`, `POST /admin/units/:id/power/:action`,
  `POST /admin/units/:id/remote/:action`, `GET /admin/power/available`,
  `POST /admin/power/scan`, `POST /admin/power/pair/begin`, `POST /admin/power/pair/finish`
- `GET`/`POST`/`PUT`/`DELETE /admin/schedules[/:id]`, `POST /admin/schedules/:id/run`
- `GET /admin/defaults`, `PUT /admin/defaults`
- `POST /admin/jellyfin/test`, `POST /admin/jellyfin/children`, `POST /admin/jellyfin/resolve`
- `GET /admin/export`, `POST /admin/import`

## Project layout

```
src/
  api/client.ts          typed fetch wrapper + UnitConfig/Unit types
  auth.tsx               auth context + <RequireAuth> guard
  colorMode.tsx           light/dark mode context
  theme.ts               MUI theme (brand indigo #5E5CE6)
  App.tsx / main.tsx     routing + providers
  components/            AppShell, ChangePasswordDialog, ConfirmDialog, PairDialog,
                         PowerPanel, RemoteScreenPanel, SaveBar, ScheduleDialog,
                         StatusDot, TabPanel, config/* (per-tab editors incl. LibraryLockPicker)
  pages/                 Login, UnitsDashboard, UnitDetail, Defaults, Schedule, Data
  util/                  time + config diff helpers
```
