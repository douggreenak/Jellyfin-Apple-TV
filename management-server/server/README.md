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
| POST   | `/devices/:unitId/heartbeat`| Updates `lastSeenAt`, returns pending command  |
| POST   | `/devices/:unitId/ack`      | Clears pending command if id matches           |

### Admin endpoints

| Method | Path                            | Notes                                     |
| ------ | ------------------------------- | ----------------------------------------- |
| POST   | `/admin/auth/login`             | `{username,password}` -> `{token,expiresAt}` |
| GET    | `/admin/auth/me`                | `{username}`                              |
| GET    | `/admin/units`                  | `Unit[]` with derived `status.online`     |
| GET    | `/admin/units/:unitId`          | `Unit`                                     |
| PATCH  | `/admin/units/:unitId/config`   | Deep-partial; bumps `configVersion`       |
| POST   | `/admin/units/:unitId/command`  | `{type:"reload"\|"identify"\|"restart"}`  |
| POST   | `/admin/units/:unitId/rename`   | `{displayName}`                           |
| DELETE | `/admin/units/:unitId`          | `{ok:true}`                               |
| GET    | `/admin/defaults`               | Editable `UnitConfig` template            |
| PUT    | `/admin/defaults`               | Replace template (validated)              |
| POST   | `/admin/jellyfin/test`          | `{serverUrl,username,password}` -> libs   |

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
- `settings(key PK, value JSON)` — holds the editable defaults template.
