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
`pendingCommand`, `registeredAt`, and **`adopted`** — `false` until an admin adopts the device
(a freshly-registered unit shows up as "ready to adopt" in the dashboard).

---

## 2. Management Server HTTP API (`/api/v1`)

All JSON. Device auth via `X-Unit-Id` + `X-Unit-Token` headers (token issued at register).
Admin auth via `Authorization: Bearer <jwt>`.

### Device endpoints
| Method & path | Body | Returns | Purpose |
|---|---|---|---|
| `POST /devices/register` | `{ unitId, deviceName, model, tvosVersion, appVersion }` | `{ unit, token }` | First contact. Server creates the unit from the **defaults template**, issues a device token. Idempotent on `unitId`. |
| `GET /devices/:unitId/config` | — | `UnitConfig` | Device fetches its config. Supports `ETag`/`If-None-Match` → `304`. |
| `POST /devices/:unitId/heartbeat` | `{ ipAddress, nowPlaying, lastError }` | `{ ok, configVersion, command }` | Every ~30 s. Updates `lastSeenAt`; returns current `configVersion` (device re-fetches config if it changed) and any pending `command`. |
| `POST /devices/:unitId/ack` | `{ commandId }` | `{ ok }` | Device acknowledges a command it executed. |

### Admin endpoints (Bearer JWT)
| Method & path | Body | Returns |
|---|---|---|
| `POST /admin/auth/login` | `{ username, password }` | `{ token, expiresAt }` |
| `GET  /admin/auth/me` | — | `{ username }` |
| `GET  /admin/units` | — | `Unit[]` (with live `status.online`) |
| `GET  /admin/units/:unitId` | — | `Unit` |
| `PATCH /admin/units/:unitId/config` | partial `UnitConfig` | `Unit` (bumps `configVersion`) |
| `POST /admin/units/:unitId/command` | `{ type: "reload" \| "identify" \| "restart" }` | `Unit` |
| `POST /admin/units/:unitId/rename` | `{ displayName }` | `Unit` |
| `POST /admin/units/:unitId/adopt` | — | `Unit` (applies the current defaults template, bumps `configVersion`, marks `adopted`) |
| `POST /admin/units/:unitId/unadopt` | — | `Unit` (returns the unit to "ready to adopt") |
| `DELETE /admin/units/:unitId` | — | `{ ok }` |
| `GET  /admin/defaults` | — | `UnitConfig` template (new units inherit this) |
| `PUT  /admin/defaults` | `UnitConfig` template | updated template |
| `POST /admin/jellyfin/test` | `{ serverUrl, username, password }` | `{ ok, serverName, version, libraries: [{id,name}] }` |

Commands flow **server → device** by being returned in the heartbeat response; the device
runs them and `POST`s an `ack`. `identify` flashes a full-screen marker so an operator can tell
which physical TV is which.

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
| `GET /Videos/{id}/stream?static=true&mediaSourceId=<id>&api_key=<token>` | Direct-play stream URL for `AVPlayer`. |
| `GET /Videos/{id}/master.m3u8?...&api_key=<token>` | HLS (used when transcoding / bitrate cap). |
| `POST /Sessions/Playing`, `/Sessions/Playing/Progress`, `/Sessions/Playing/Stopped` | Playback reporting (optional, nice for "now playing" telemetry). |

---

## 4. tvOS app structure (`Jellyfin/Jellyfin/`)

SwiftUI, tvOS 18+, Swift 5 language mode with `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`
(so types are MainActor-isolated by default — networking uses `async`/`await` off the main
actor where needed).

```
Jellyfin/
  JellyfinApp.swift          @main; builds AppModel, hosts RootView
  App/
    RootView.swift           routes on AppModel.phase; when ready, the Home/Library/Search tab bar
    AppModel.swift           @Observable state machine — pure appliance: requires the server, no local cache
    HomeFeed.swift           loads the home shelves (Continue Watching, Next Up, Recently Added)
    Navigation.swift         shared NavigationStack routing (item → detail / folder / series)
  Models/
    UnitConfig.swift         Codable mirror of UNIT_CONFIG_SCHEMA.json
    JellyfinModels.swift     auth, BaseItem, metadata helpers
  Services/
    DeviceIdentity.swift     persistent unitId + device token + management server address (UserDefaults)
    ManagementClient.swift   register / fetchConfig / heartbeat / ack
    JellyfinClient.swift     auth / views / items / resume / nextUp / latest / search / images / playback reporting
  DesignSystem/
    Theme.swift              colors, metrics, gradients (driven by the server's accentColorHex)
    CachedAsyncImage.swift   in-memory image cache + fade-in
    MediaCards.swift         poster + landscape focus cards
    MediaShelf.swift         horizontal shelf;   HeroBanner.swift  focus-driven cinematic hero
    Components.swift         LoadingView, ErrorView, ClockView
  Views/
    ConnectingView.swift     splash + "management server required" bootstrap + waiting-for-content + Identify
    HomeView.swift           hero + shelves (Watch Now)
    LibraryView.swift        libraries grid + folder / season browser
    SearchView.swift         Jellyfin search
    ItemDetailView.swift     cinematic detail with Play / Resume
    SeriesDetailView.swift   season picker + episode shelf
    PlayerView.swift         AVPlayer — resume + Jellyfin playback reporting
```

**The device is a pure managed appliance.** There is no on-device configuration and no local
cache: every launch must reach the management server to obtain its config. The only local input
is the management server address (the bootstrap), shown on the connection screen.

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
      index.ts               bootstrap, config, listen
      db.ts                  better-sqlite3 setup + migrations
      schema.ts              zod schemas mirroring UNIT_CONFIG_SCHEMA.json
      auth.ts                admin JWT + device-token middleware
      routes/devices.ts      register / config / heartbeat / ack
      routes/admin.ts        auth + units CRUD + defaults + jellyfin test + commands
      jellyfin.ts            server-side Jellyfin credential test
      defaults.ts            seed default UnitConfig template
    package.json, tsconfig.json, .env.example
  admin/                     React + Vite + MUI (Material Design) dashboard
    src/
      main.tsx, App.tsx, theme.ts
      api/client.ts          typed fetch wrapper + auth token storage
      pages/Login.tsx
      pages/UnitsDashboard.tsx   cards/table of all units, online dot, quick actions
      pages/UnitDetail.tsx       full config editor (tabs: General, Jellyfin, Appearance, Playback)
      pages/Defaults.tsx         shared Jellyfin account + default template
      components/…
  docker-compose.yml         server + admin (nginx) on the Linux box
  README.md                  install / run on Linux
```

Data store: **SQLite** (`better-sqlite3`) — one file, perfect for a single local box, no
external DB to operate. Admin password + JWT secret come from `.env`.

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
