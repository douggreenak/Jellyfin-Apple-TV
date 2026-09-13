# Jellyfin — System Architecture

A fleet of Apple TV units that play **media content** from a
self-hosted **Jellyfin** server, centrally managed from a **local Linux box**.

There are two halves, joined by one shared contract (`UNIT_CONFIG_SCHEMA.json`):

```
┌──────────────────────────┐         ┌─────────────────────────────────────────┐
│      Apple TV unit        │        │        Management server (Linux box)        │
│  (tvOS / SwiftUI app)     │        │                                             │
│                           │  HTTPS │   ┌───────────────┐   ┌──────────────────┐  │
│  • Browses Jellyfin       │◄──────►│   │  Node API     │◄─►│ React + MUI admin │  │
│  • Plays video (AVPlayer) │        │   │  (Express/TS) │   │  (Material UI)    │  │
│  • Reads its UnitConfig   │        │   └──────┬────────┘   └──────────────────┘  │
│  • Server-managed only    │        │          │ SQLite                            │
└────────────┬──────────────┘        └──────────┼─────────────────────────────────┘
             │                                   │
             │  Jellyfin REST (auth, items, images, video stream)
             ▼                                   ▼
        ┌──────────────────────────────────────────┐
        │            Jellyfin media server          │
        └──────────────────────────────────────────┘
```

The Apple TV **never needs manual setup**: it registers itself with the management
server, receives a `UnitConfig` (which includes the **shared Jellyfin service account**),
and immediately starts browsing. Operators manage every TV centrally. Browse
mode starts as **`full`** (whole library visible).

---

## 1. The shared contract — `UnitConfig`

The management server is the **source of truth** for each unit's configuration. The device
fetches it, caches it locally, and re-fetches when `configVersion` changes. The canonical
JSON Schema lives in [`UNIT_CONFIG_SCHEMA.json`](./UNIT_CONFIG_SCHEMA.json). Summary:

| Field | Type | Notes |
|---|---|---|
| `unitId` | string (uuid) | Generated on the device, stable for the lifetime of the install. |
| `displayName` | string | e.g. `"Lobby TV"`. Shown in the admin and on the device's status screen. |
| `groupId` | string \| null | Optional grouping (campus / wing / room). |
| `jellyfin.serverUrl` | string | e.g. `https://jelly.example.com`. No trailing slash. |
| `jellyfin.username` | string | Shared service account. |
| `jellyfin.password` | string | Shared service account password (pushed from server). |
| `browse.mode` | `"full" \| "curated" \| "kiosk"` | Starts as `full`. |
| `browse.homeLibraryId` | string \| null | If set, app opens straight into this library/folder. `null` = library home. |
| `browse.allowedLibraryIds` | string[] | Used only in `curated` mode (empty = all). |
| `browse.hiddenLibraryIds` | string[] | Always hidden from the grid. |
| `appearance.appTitle` | string | Big title on the home screen, e.g. `"Jellyfin"`. |
| `appearance.theme` | `"system" \| "light" \| "dark"` | tvOS leans dark; default `dark`. |
| `appearance.accentColorHex` | string | `#RRGGBB`, drives focus/selection tint. |
| `appearance.showClock` | bool | Show a clock in the top bar. |
| `appearance.showItemTitles` | bool | Titles under posters. |
| `appearance.posterStyle` | `"poster" \| "thumb" \| "wide"` | Card aspect ratio. |
| `playback.autoplayNext` | bool | Auto-advance within a folder. |
| `playback.maxBitrateMbps` | number | `0` = unlimited / direct play. |
| `playback.preferDirectPlay` | bool | Prefer direct play over transcode. |
| `configVersion` | integer | Bumped by the server on every change; device polls this. |
| `updatedAt` | string (ISO-8601) | Last modification time. |

A server-side **`Unit`** record wraps the config with telemetry (see schema): `status.online`,
`status.lastSeenAt`, `appVersion`, `tvosVersion`, `model`, `ipAddress`, `nowPlaying`,
`pendingCommand`, `registeredAt`, **`adopted`** — `false` until an admin adopts the device
(a freshly-registered unit shows up as "ready to adopt" in the dashboard) — and
**`powerConfigured`**, whether this unit has been paired for Apple TV remote control/power
(§2, "Remote control & power").

---

## 2. Management Server HTTP API (`/api/v1`)

All JSON. Device auth via `X-Unit-Id` + `X-Unit-Token` headers (token issued at register).
Admin auth via `Authorization: Bearer <jwt>`.

### Device endpoints
| Method & path | Body | Returns | Purpose |
|---|---|---|---|
| `POST /devices/register` | `{ unitId, deviceName, model, tvosVersion, appVersion }` | `{ unit, token }` | First contact. Server creates the unit from the **defaults template**, issues a device token. Idempotent on `unitId`. |
| `GET /devices/:unitId/config` | — | `UnitConfig` | Device fetches its config. Supports `ETag`/`If-None-Match` → `304`. |
| `PUT /devices/:unitId/config` | full `UnitConfig` | `UnitConfig` | Device pushes a local settings edit back to the server (`unitId`/`configVersion`/`updatedAt` are server-owned and always overwritten). Currently unused — no on-device settings UI writes to it today. |
| `POST /devices/:unitId/heartbeat` | `{ ipAddress, nowPlaying, lastError }` | `{ ok, configVersion, command }` | Every ~30 s. Updates `lastSeenAt`; returns current `configVersion` (device re-fetches config if it changed) and any pending `command`. |
| `POST /devices/:unitId/ack` | `{ commandId }` | `{ ok }` | Device acknowledges a command it executed. |
| `GET /devices/:unitId/live` | — | `{ screenShare }` | Cheap poll (every few seconds) telling the device whether a dashboard operator has its screen mirror open right now. |
| `POST /devices/:unitId/screenshot` | raw `image/jpeg` (not JSON) | `{ ok }` | Uploads one captured screen frame while `screenShare` is true. In-memory only on the server — only the latest frame per unit is kept. |

### Admin endpoints (Bearer JWT)
| Method & path | Body | Returns |
|---|---|---|
| `POST /admin/auth/login` | `{ username, password }` | `{ token, expiresAt }` |
| `GET  /admin/auth/me` | — | `{ username }` |
| `POST /admin/auth/change-password` | `{ currentPassword, newPassword }` (min 8 chars) | `{ ok: true }` / `400 { ok:false, error }` — persisted (bcrypt hash in the `settings` table), overrides `.env` `ADMIN_PASSWORD` from then on; existing JWTs stay valid until they expire |
| `GET  /admin/units` | — | `Unit[]` (with live `status.online`) |
| `GET  /admin/units/:unitId` | — | `Unit` |
| `PATCH /admin/units/:unitId/config` | partial `UnitConfig` | `Unit` (bumps `configVersion`) |
| `POST /admin/units/:unitId/command` | `{ type: "reload" \| "identify" \| "restart" \| "migrate", data? }` | `Unit` (`data` is the new management server URL, required for `migrate`) |
| `POST /admin/units/:unitId/rename` | `{ displayName }` | `Unit` |
| `POST /admin/units/:unitId/adopt` | — | `Unit` (applies the current defaults template, bumps `configVersion`, marks `adopted`) |
| `POST /admin/units/:unitId/unadopt` | — | `Unit` (returns the unit to "ready to adopt") |
| `DELETE /admin/units/:unitId` | — | `{ ok }` |
| `POST /admin/units/bulk` | `{ unitIds: string[], action: "adopt"\|"unadopt"\|"reload"\|"identify"\|"restart"\|"delete"\|"migrate", data? }` | `{ ok: true, affected }` — fleet-wide bulk action; `data` required for `migrate`; unknown ids silently skipped |
| `POST /admin/units/push-jellyfin` | `{ serverUrl, username, password }` | `{ ok: true, affected }` — overwrites only the `jellyfin` section of **every** unit's config, bumping each `configVersion` ("push this server to all TVs" on Defaults) |
| `POST /admin/units/:unitId/remote/:action` | — (`:action` is one of `up\|down\|left\|right\|select\|menu\|play_pause\|top_menu`) | `{ ok, error? }` |
| `POST /admin/units/:unitId/screen/keepalive` | — | `{ ok }` (call every ~700 ms while the screen panel is open) |
| `GET  /admin/units/:unitId/screenshot` | — | latest `image/jpeg` frame, or `204` if none yet |
| `GET  /admin/power/available` | — | `{ available: boolean }` — whether `pyatv`/`atvremote` is installed on the server box |
| `POST /admin/power/scan` | — | `{ ok, devices?: [{identifier,name,address}], error? }` — discover Apple TVs on the LAN |
| `POST /admin/power/pair/begin` | `{ atvId }` | `{ ok, pairingId?, error? }` — starts Companion pairing; the TV shows a PIN |
| `POST /admin/power/pair/finish` | `{ unitId, pairingId, pin }` | `{ ok, atvId? }` / `502 { ok:false, error }` — completes pairing, stores Companion credentials |
| `GET  /admin/units/:unitId/power` | — | `{ configured: boolean, atvId: string \| null }` |
| `PUT  /admin/units/:unitId/power` | `{ atvId, credentials }` | `{ configured: true, atvId }` — manually set/overwrite a pairing |
| `DELETE /admin/units/:unitId/power` | — | `{ ok: true }` |
| `POST /admin/units/:unitId/power/:action` | — (`:action` = `on`\|`off`) | `{ ok: true }` / `400`/`502 { ok:false, error }` — 400 if unpaired, 502 if the pyatv command fails |
| `GET  /admin/schedules` | — | `PowerSchedule[]`, sorted by time |
| `POST /admin/schedules` | `ScheduleInput` (name, enabled, action `on`\|`off`, targetType `all`\|`group`\|`unit`, targetValue, `time` `HH:MM`, `days`) | `201 PowerSchedule` |
| `PUT  /admin/schedules/:id` | `ScheduleInput` | `PowerSchedule` / `404` |
| `DELETE /admin/schedules/:id` | — | `{ ok: true }` / `404` |
| `POST /admin/schedules/:id/run` | — | `{ ok: true, result: string }` / `404` — run a schedule immediately ("test" button) |
| `GET  /admin/defaults` | — | `UnitConfig` template (new units inherit this) |
| `PUT  /admin/defaults` | `UnitConfig` template | updated template |
| `POST /admin/jellyfin/test` | `{ serverUrl, username, password }` | `{ ok, serverName, version, libraries: [{id,name}] }` |
| `POST /admin/jellyfin/children` | `{ serverUrl, username, password, parentId? }` | `{ ok, items?: [{id,name,isFolder,childCount?}], error? }` — backs the "lock to folder" tree picker |
| `POST /admin/jellyfin/resolve` | `{ serverUrl, username, password, itemId }` | `{ ok, item?: {id,name,isFolder,childCount?}, error? }` — resolves a locked folder's id to a display name |
| `GET  /admin/export` | — | `{ version, exportedAt, defaults, units[] }` (`Content-Disposition: attachment`) — full server-config snapshot for backup, telemetry omitted |
| `POST /admin/import?replace=true` | `{ version?, exportedAt?, defaults, units[] }` (from `GET /export`) | `{ ok: true, imported, removed }` — restores a snapshot; without `?replace=true` extra existing units are left alone, with it they're deleted |

Commands flow **server → device** by being returned in the heartbeat response; the device
runs them and `POST`s an `ack`. `identify` flashes a full-screen marker so an operator can tell
which physical TV is which. `migrate` ("move to new server") is special: the device acks the
**old** server first, then re-points `managementBaseURL` at `data` and reconnects with its
existing identity — no re-adoption needed if the new server already has the migrated records.

### Apple TV remote control & power (pyatv)

The management server can reach a physical Apple TV directly over Apple's Companion protocol
(via the `pyatv`/`atvremote` CLI on the server box), independent of the Jellyfin app's own
management-client loop. One in-browser pairing per unit (scan → PIN pairing) yields a Companion
credentials string, stored server-side and reused for both **power** (`turn_on`/`turn_off` —
Apple TVs have no true hard-off) and **remote-control key relay** (`up`/`down`/`left`/`right`/
`select`/`menu`/`play_pause`/`top_menu`, indistinguishable from a physical Siri Remote press).
**Power schedules** layer on top: a schedule (name, on/off, target all/group/unit, `HH:MM` +
weekdays) is checked every 20s server-side and fires against its target units' stored pairings —
this is a server cron, not a device feature, and requires the same per-unit pairing as manual
power/remote control.

---

## 3. Jellyfin REST endpoints the app uses

Auth header for all requests:
`X-Emby-Authorization: MediaBrowser Client="Jellyfin Apple TV", Device="<name>", DeviceId="<unitId>", Version="<appVersion>"`
After login add `, Token="<accessToken>"`.

| Call | Purpose |
|---|---|
| `POST /Users/AuthenticateByName` `{ Username, Pw }` | Login → `{ AccessToken, User: { Id } }`. |
| `GET /UserViews?userId=<id>` (a.k.a. `/Users/{id}/Views`) | Top-level libraries. |
| `GET /Items?userId=<id>&parentId=<id>&SortBy=SortName&Fields=...` | Children of a folder/library. |
| `GET /Items/{id}/Images/Primary?fillHeight=...&tag=...` | Poster/thumbnail image URL (no auth needed if `api_key` query is added). |
| `GET /Videos/{id}/master.m3u8?videoCodec=h264,hevc&...&api_key=<token>` | **Always** used for playback — Jellyfin's adaptive HLS direct-streams codecs `AVPlayer` can decode and transcodes anything it can't (e.g. MPEG-2, VC-1). Static direct-play (`stream?static=true`) is intentionally **not used**: Apple devices have no MPEG-2 decoder, so it silently fails on that content. |
| `POST /Sessions/Playing`, `/Sessions/Playing/Progress`, `/Sessions/Playing/Stopped` | Playback reporting so Jellyfin tracks watched state + resume. **Note:** the app currently reports Start (on open) and Stopped (on back-navigation) but not periodic Progress — see the app-structure notes below. |

---

## 4. tvOS app structure (`Jellyfin/Jellyfin/`)

SwiftUI, tvOS 18+, Swift 5 language mode with `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`
(so types are MainActor-isolated by default — networking uses `async`/`await` off the main
actor where needed).

```
Jellyfin/
  JellyfinApp.swift          @main; builds AppModel, hosts RootView
  App/
    RootView.swift           routes on AppModel.phase; when ready, the folder browser (no tab bar)
    AppModel.swift           @Observable state machine — pure appliance: requires the server, no local cache
    Navigation.swift         shared NavigationStack routing (folder → folder, video → player directly)
    WindowAccessor.swift     grabs the app's UIWindow (no AppDelegate) for ScreenCaptureService
  Models/
    UnitConfig.swift         Codable mirror of UNIT_CONFIG_SCHEMA.json
    JellyfinModels.swift     auth, BaseItem, metadata helpers
  Services/
    DeviceIdentity.swift     persistent unitId + device token + management server address (UserDefaults)
    ManagementClient.swift   register / fetchConfig / heartbeat / ack / live-status poll / screenshot upload
    JellyfinClient.swift     auth / views / items / images / HLS playback URL / playback reporting
    ScreenCaptureService.swift  snapshots the app's own window to JPEG for the dashboard's live screen mirror
  DesignSystem/
    Theme.swift              colors, metrics, gradients (driven by the server's accentColorHex)
    CachedAsyncImage.swift   in-memory image cache + fade-in (avoids AsyncImage's re-fetch-on-rerender)
    MediaCards.swift         poster / landscape / library focus cards (tvOS `.card` button style)
    Components.swift         LoadingView, ErrorView, ClockView, SectionHeaderView
  Views/
    ConnectingView.swift     splash + "management server required" bootstrap + waiting-for-content + Identify
    LibraryView.swift        the folder browser: libraries grid, then folder/season contents
    PlayerView.swift         AVPlayer — starts paused on the first frame, resumes from saved position,
                             reports start/stop to Jellyfin + the management server
```

**The device is a pure managed appliance and a folder browser only.** There is no on-device
configuration and no local cache: every launch must reach the management server to obtain its
config. The only local input is the management server address (the bootstrap), shown on the
connection screen. There is no "watch now" dashboard, no shelves, and no search — libraries →
folders → videos, and tapping a video opens the player directly, paused on the first frame.

**State machine (`AppModel.phase`):** `launching → registering → connectingJellyfin → ready`, plus
`waitingForContent` (server reachable, no Jellyfin assigned yet), `needsManagementServer` (server
unreachable — the app is **blocked** and keeps retrying), and `error(message)`. A background loop
heartbeats every 30 s when connected (applying config changes and admin commands live); if the
server disappears it blocks after a few failed heartbeats and auto-recovers when it returns.

---

## 5. Management server structure (`management-server/`)

```
management-server/
  server/                    Node + TypeScript backend
    src/
      index.ts               bootstrap, config, listen, starts the scheduler
      db.ts                  better-sqlite3 setup + migrations (units, settings, schedules tables)
      schema.ts              zod schemas mirroring UNIT_CONFIG_SCHEMA.json + admin/device request bodies
      auth.ts                admin JWT + device-token middleware + change-password
      atv.ts                 pyatv Companion protocol: power on/off, remote key relay, scan + pairing
      scheduler.ts           power on/off schedule ticker (runs every 20s)
      liveScreen.ts          in-memory screen-mirror state (keepalive flag + latest frame per unit)
      routes/devices.ts      register / config (GET+PUT) / heartbeat / ack / live / screenshot upload
      routes/admin.ts        auth + units CRUD + bulk actions + power/remote/schedules + export/import + jellyfin + defaults
      jellyfin.ts            server-side Jellyfin credential test + browse/resolve for the folder picker
      defaults.ts            seed default UnitConfig template
      util.ts                toUnit/deepMerge/status helpers, PendingCommand + UnitStatus types
    package.json, tsconfig.json, .env.example
  admin/                     React + Vite + MUI (Material Design) dashboard
    src/
      main.tsx, App.tsx, theme.ts, auth.tsx, colorMode.tsx
      api/client.ts          typed fetch wrapper + auth token storage
      pages/Login.tsx
      pages/UnitsDashboard.tsx   cards/table of all units, online dot, quick actions, bulk fleet actions
      pages/UnitDetail.tsx       full config editor (tabs: General, Jellyfin, Appearance, Playback) + remote/power panel
      pages/Defaults.tsx         shared Jellyfin account + default template + "push to all" button
      pages/Schedule.tsx         power on/off schedule list + create/edit/run/delete
      pages/Data.tsx             export/import full server-config snapshot
      components/AppShell.tsx, ChangePasswordDialog.tsx, ConfirmDialog.tsx,
                 PairDialog.tsx, PowerPanel.tsx, RemoteScreenPanel.tsx,
                 SaveBar.tsx, ScheduleDialog.tsx, StatusDot.tsx, TabPanel.tsx
      components/config/         per-tab config editors: AppearancePanel, BrowsePanel,
                 JellyfinPanel, LibraryLockPicker (Jellyfin browse/resolve UI), PlaybackPanel
      util/diff.ts, util/time.ts
  docker-compose.yml         server + admin (nginx) on the Linux box
  README.md                  install / run on Linux
```

Data store: **SQLite** (`better-sqlite3`) — one file, perfect for a single local box, no
external DB to operate: the `units` table (config + telemetry), a generic `settings` key-value
table (admin password hash, per-unit pyatv Companion credentials under `atvpower:<unitId>`), and
`schedules` (power on/off schedules). Admin password + JWT secret come from `.env` initially;
the admin password can later be changed from the dashboard, which overrides `.env` from then on.

---

## 6. Security model

- Device token is a random 256-bit string issued at registration, stored on device, required
  for `config`/`heartbeat`. Lets us revoke a unit.
- Admin uses username/password (from `.env`, bcrypt-hashed) → short-lived JWT.
- The shared Jellyfin password is stored on the server and pushed to devices over HTTPS. On the
  device it is held only in memory for the session (there is no local config cache). **Run the
  server behind HTTPS** (nginx + self-signed or internal CA) so the pushed credentials aren't
  sent in clear text.
- The device is a managed appliance: it has no on-device configuration screen, and it refuses to
  operate (shows "management server required") whenever it cannot reach the management server.

---

## 7. Deployment (local Linux box)

`docker compose up -d` brings up the API and the admin site (served by nginx). The Apple TVs
are pointed at the box's address once (compiled-in default or first-run prompt), then managed
entirely from the web dashboard. See `management-server/README.md`.
