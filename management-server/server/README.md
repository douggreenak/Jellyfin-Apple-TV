# Jellyfin Management Server (backend)

Node + TypeScript + SQLite backend that is the source of truth for a fleet of
Apple TV units running the Jellyfin app. It serves a device API
(register / config / heartbeat / ack) and an admin API (JWT-protected) consumed
by the React + MUI dashboard.

## Stack

- Express 4
- better-sqlite3 (synchronous SQLite, CommonJS — no ESM)
- zod (validation), jsonwebtoken, bcryptjs
- cors, helmet, dotenv
- tsx for dev, tsc -> CommonJS for build

## Run

```bash
npm install
cp .env.example .env      # then edit secrets (JWT_SECRET, ADMIN_PASSWORD)
npm run dev               # tsx watch, hot reload
```

Production build:

```bash
npm run build             # tsc -> dist/
npm start                 # node dist/index.js
```

Type-check only:

```bash
npm run typecheck
```

Health check: `GET http://localhost:4000/api/v1/health` -> `{ "ok": true }`.

## Environment (.env)

| Var                   | Default                     | Purpose                                    |
| --------------------- | --------------------------- | ------------------------------------------ |
| PORT                  | 4000                        | HTTP port                                  |
| ADMIN_USERNAME        | admin                       | Admin login username                       |
| ADMIN_PASSWORD        | changeme                    | Plaintext password (hashed at boot)        |
| JWT_SECRET            | replace-me                  | Secret for signing admin JWTs              |
| ONLINE_WINDOW_SECONDS | 90                          | A unit is "online" if seen within this     |
| DB_PATH               | ./data/jellyfin.db        | SQLite file path (dir auto-created)         |
| ADMIN_ORIGIN          | http://localhost:5173       | Allowed CORS origin for the dashboard      |

## API

Base path: `/api/v1`. All JSON.

### Auth

- Device auth: headers `X-Unit-Id` + `X-Unit-Token` (token issued at register).
- Admin auth: `Authorization: Bearer <jwt>` (from `POST /admin/auth/login`).

### Device endpoints

| Method | Path                        | Notes                                          |
| ------ | --------------------------- | ---------------------------------------------- |
| POST   | `/devices/register`         | Idempotent on `unitId`. Returns `{unit, token}`|
| GET    | `/devices/:unitId/config`   | ETag via `configVersion`; 304 on If-None-Match |
| PUT    | `/devices/:unitId/config`   | Device pushes a local edit back; server-owned fields always overwritten |
| POST   | `/devices/:unitId/heartbeat`| Updates `lastSeenAt` + `status.appVersion` (if sent), returns pending command |
| POST   | `/devices/:unitId/ack`      | Clears pending command if id matches           |
| GET    | `/devices/:unitId/live`     | `{screenShare}` — is a dashboard operator watching this unit's screen right now |
| POST   | `/devices/:unitId/screenshot`| raw `image/jpeg` body — uploads one frame while `screenShare` is true |

### Admin endpoints

Full detail (bodies, exact response shapes) lives in
[`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §2 — this is a quick index.

| Method | Path                            | Notes                                     |
| ------ | ------------------------------- | ----------------------------------------- |
| POST   | `/admin/auth/login`             | `{username,password}` -> `{token,expiresAt}` |
| GET    | `/admin/auth/me`                | `{username}`                              |
| POST   | `/admin/auth/change-password`   | `{currentPassword,newPassword}` — persisted, overrides `.env` |
| GET    | `/admin/units`                  | `Unit[]` with derived `status.online`     |
| GET    | `/admin/units/:unitId`          | `Unit`                                     |
| PATCH  | `/admin/units/:unitId/config`   | Deep-partial; bumps `configVersion`       |
| POST   | `/admin/units/:unitId/command`  | `{type:"reload"\|"identify"\|"restart"\|"migrate",data?}` |
| POST   | `/admin/units/:unitId/rename`   | `{displayName}`                           |
| DELETE | `/admin/units/:unitId`          | `{ok:true}`                               |
| POST   | `/admin/units/bulk`             | `{unitIds[],action,data?}` — fleet-wide adopt/unadopt/reload/identify/restart/delete/migrate |
| POST   | `/admin/units/push-jellyfin`    | `{serverUrl,username,password}` -> pushes to every unit's `jellyfin` config |
| POST   | `/admin/units/:unitId/remote/:action` | `:action` = up\|down\|left\|right\|select\|menu\|play_pause\|top_menu (needs pairing) |
| GET/PUT/DELETE | `/admin/units/:unitId/power`  | Get/set/remove the unit's pyatv Companion pairing |
| POST   | `/admin/units/:unitId/power/:action` | `:action` = on\|off — wake/sleep the paired Apple TV |
| GET    | `/admin/power/available`        | Is `pyatv`/`atvremote` installed on this box |
| POST   | `/admin/power/scan`             | Discover Apple TVs on the LAN for pairing |
| POST   | `/admin/power/pair/begin`       | `{atvId}` -> starts Companion pairing (PIN shown on TV) |
| POST   | `/admin/power/pair/finish`      | `{unitId,pairingId,pin}` -> stores credentials |
| GET/POST/PUT/DELETE | `/admin/schedules[/:id]` | Power on/off schedules (name, time, weekdays, target); `POST .../:id/run` runs one now |
| GET    | `/admin/app-version`            | `{latestVersion,counts}` — fleet's configured latest build + current/outdated/unknown tally |
| PUT    | `/admin/app-version`            | `{latestVersion}` — sets the reference value units are compared against |
| GET    | `/admin/defaults`               | Editable `UnitConfig` template            |
| PUT    | `/admin/defaults`               | Replace template (validated)              |
| POST   | `/admin/jellyfin/test`          | `{serverUrl,username,password}` -> libs   |
| POST   | `/admin/jellyfin/children`      | `{serverUrl,username,password,parentId?}` -> folder-lock tree picker |
| POST   | `/admin/jellyfin/resolve`       | `{serverUrl,username,password,itemId}` -> display name for a locked folder id |
| GET    | `/admin/export`                 | Full server-config snapshot (defaults + all units) for backup |
| POST   | `/admin/import?replace=true`    | Restore a snapshot from `GET /export`     |

## Behavior notes

- **Source of truth**: the server owns the canonical `UnitConfig`. Devices cache
  it and re-fetch when `configVersion` changes (observed via the heartbeat
  response or the config ETag).
- **Every config-changing admin write** bumps `configVersion` and sets a fresh
  `updatedAt`.
- **`online` is derived** from `lastSeenAt` vs `ONLINE_WINDOW_SECONDS` at read
  time — it is never persisted as authoritative.
- **`deviceToken` is never returned** in any response. `jellyfin.password` is
  returned in single-unit GET and `/admin/defaults` so the editor can show it
  (trusted local admin), but not relevant to list trimming here.
- **register is idempotent**: re-registering the same `unitId` keeps its config,
  refreshes telemetry, and returns a valid token.

## Storage

Single SQLite file. Tables:

- `units(unitId PK, displayName, groupId, config JSON, status JSON,
  pendingCommand JSON, deviceToken, configVersion, registeredAt)`
- `settings(key PK, value JSON)` — generic key-value store: the editable defaults template,
  the admin password hash (once changed from the dashboard), and per-unit pyatv Companion
  pairing credentials (`atvpower:<unitId>`).
- `schedules(id PK, name, enabled, action, targetType, targetValue, time, days JSON,
  lastRun, lastResult)` — power on/off schedules, ticked every 20s by `scheduler.ts`.
