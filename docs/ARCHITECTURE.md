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
| `appearance.accentColorHex` | string | `#RRGGBB`, drives focus/selection tint. Fixed at the default (`#5E5CE6`) for every unit — not exposed as an editable setting anywhere in the admin dashboard by product decision (the dashboard's own theme color, a separate per-browser preference, is what's actually pickable — see §2, "Dashboard theme color"). |
| `appearance.showClock` | bool | Show a clock in the top bar. |
| `appearance.showItemTitles` | bool | Titles under posters. |
| `appearance.posterStyle` | `"poster" \| "thumb" \| "wide"` | Card aspect ratio. |
| `playback.autoplayNext` | bool | Auto-advance within a folder. |
| `playback.maxBitrateMbps` | number | `0` = "Unlimited" in the admin UI, which sends a generous fixed 100 Mbps ceiling (`JellyfinClient.unlimitedBitrateBps`), not an actually unbounded request — see below. |
| `playback.preferDirectPlay` | bool | Currently has no effect on the playback URL — kept in the schema/UI as a real per-unit setting, but nothing reads it since `videoCodec=h264` (§3) already forces a transcode for any non-H.264 source regardless, and an already-H.264 source direct-plays/remuxes either way. |
| `configVersion` | integer | Bumped by the server on every change; device polls this. |
| `updatedAt` | string (ISO-8601) | Last modification time. |

A server-side **`Unit`** record wraps the config with telemetry (see schema): `status.online`,
`status.lastSeenAt`, `appVersion`, `tvosVersion`, `model`, `ipAddress`, `nowPlaying`,
`status.localNetworkName` (§2, "Real device names via Bonjour"), `pendingCommand`,
`registeredAt`, **`adopted`** — `false` until an admin adopts the device (a freshly-registered
unit shows up as "ready to adopt" in the dashboard **only while it's online** — this is purely a
dashboard-side filter, `UnitsDashboard.tsx`'s `pending` list, not server state: an unadopted unit
that goes offline before anyone adopts it just disappears rather than lingering forever; offline
tracking is reserved for units you've actually adopted) — and **`powerConfigured`**, whether this
unit has been paired for Apple TV remote control/power (§2, "Remote control & power"). It also
carries a computed **`appVersionStatus`** (`"current" | "outdated" | "unknown"`) — see §2, "App
version tracking".

`status.appVersion` is `"<marketing> (<build>)"`, e.g. `"1.0 (42)"` — `scripts/build-ipa.sh`
stamps a fresh, monotonically-increasing build number (git commit count) into every Ad Hoc
export, so it changes on every real build even when the marketing version doesn't. It's
reported at register **and on every heartbeat**, because a unit keeps its device token across
an app update pushed via MDM (it never re-registers), so relying on register alone would let
the server's view of a unit's version go stale forever after the first install.

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
| `POST /devices/:unitId/heartbeat` | `{ ipAddress, nowPlaying, lastError, appVersion, localName }` | `{ ok, configVersion, command }` | Every ~3 s (the fleet is one LAN — see `AppModel.heartbeatInterval`). Updates `lastSeenAt` and (when present) `status.appVersion`/`status.localNetworkName` — the latter also renames the unit if its `displayName` is still the generic "Apple TV" placeholder, see "Real device names via Bonjour" below. Returns current `configVersion` (device re-fetches config if it changed) and any pending `command`. |
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
| `GET  /admin/app-version` | — | `{ latestVersion: string \| null, counts: {current,outdated,unknown} }` — the fleet's "latest" version (§2, "App version tracking") plus a live tally. Read-only: there is deliberately no PUT, see below. |
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

### App version tracking

The server can't push app updates itself (distribution is Ad Hoc via Mosyle, not silent/managed
MDM app updates), so it instead tracks what units are actually running and flags the ones behind
— entirely automatically, with **no admin-editable setting anywhere in the dashboard**. Every
push that touches `Jellyfin/` runs `scripts/build-ipa.sh` (via the `pre-push` git hook), which
writes `management-server/server/latest-app-version.json` (`{ version, generatedAt }`) alongside
the IPA and commits it.

The deployed server's own "latest version" comes from **GitHub, not its local checkout**:
`appVersion.ts` polls `latest-app-version.json` straight off the `main` branch on
`raw.githubusercontent.com` every 10 minutes (plus once at startup — `startAppVersionPolling()`,
called from `index.ts`), and that GitHub-sourced value takes priority whenever it's available. The
local file is only a fallback for right after process start (before the first poll lands) or if
GitHub can't be reached at all. This matters because nothing here auto-deploys: a `git pull` +
restart on the production box is a manual step, and without the GitHub check, any deployment that
lags even one push behind would have a stale local file — meaning the dashboard would flag every
unit that picked up the real latest IPA (via Mosyle) as "outdated" forever, even though it's
actually current. Polling the repo directly makes "latest" mean what was actually pushed,
independent of when this particular server process last redeployed.

Each unit's real version arrives via register + every heartbeat (never stale, even across an app
update — see §1), and `appVersionStatus` on each `Unit` — `"current"`, `"outdated"`, or `"unknown"`
(neither source has a version yet, or the unit hasn't reported one) — is a straight string-equality
check: `status.appVersion` already encodes an always-increasing build number, so there's no
ordering to parse, just "is this the exact build we most recently cut." The Units dashboard badges
outdated units.

The management server (backend + admin dashboard, which ship together) gets a version from the
same counter: `scripts/build-ipa.sh` stamps `1.0.<BUILD_NUMBER>` into both `package.json` files on
every push, so the tvOS build (`1.0 (42)`) and the web app (`1.0.42`) that shipped it are always
traceable to the same commit. `GET /api/v1/health` returns `{ ok, version }` (read straight from
`package.json`, no separate file); the dashboard shows it as a quiet `v1.0.42` caption under
"Signed in as" in the sidebar footer (`AppShell.tsx`).

### Dashboard theme color

The admin dashboard's own accent color (buttons, active nav, focus rings) is a **per-browser,
admin-only preference** — the palette icon next to the dark/light toggle, persisted to
`localStorage` (`admin-theme-accent`), with zero relationship to `UnitConfig.appearance.
accentColorHex`. Picking dashboard colors and TV colors were originally meant to be the same
control; kept separate by explicit product decision — the TVs always use their fixed default
regardless of what the operator picks for their own browser.

### Real device names via Bonjour

Every new unit registers with `deviceName` = `UIDevice.current.name` as its seed `displayName` —
but since tvOS 16, Apple gates that API: without a special, formally-applied-for entitlement
(`com.apple.developer.device-information.user-assigned-device-name`), it returns the generic
model name, literally `"Apple TV"`, to every third-party app. So every fresh unit's card would
otherwise say the same generic string forever.

Workaround (`LocalDeviceNameResolver.swift`): every Apple device also broadcasts its real name as
the Bonjour *instance name* of standard services it already advertises (AirPlay, Companion Link,
sleep proxy, remote-control link). The tvOS app browses those (needs the ordinary Local Network
permission — `NSLocalNetworkUsageDescription`/`NSBonjourServices` in `Support/Info.plist`, **not**
the gated entitlement), matches the record whose address is one of its own local IPs, and sends
the result as `localName` on every heartbeat once resolved. Best-effort, not guaranteed: an
unattended unit whose Local Network permission prompt nobody has answered just keeps failing
resolution gracefully (falls back to the generic name, nothing breaks).

The heartbeat handler always records this as `status.localNetworkName` (telemetry), and — only
while `displayName` is still the exact literal `"Apple TV"` placeholder — auto-adopts it into
`displayName` too, which is what the dashboard cards actually show as the title. An admin who has
already renamed a unit to anything else never gets overwritten; the resolved name still shows up
in Unit Detail's telemetry as a hint in that case.

---

## 3. Jellyfin REST endpoints the app uses

Auth header for all requests — sent as **both** `Authorization` and `X-Emby-Authorization` (same
value, both headers):
`MediaBrowser Client="Jellyfin Apple TV", Device="<name>", DeviceId="<unitId>", Version="<appVersion>"`
After login add `, Token="<accessToken>"`. Jellyfin 12+ reads the standard `Authorization` header
by default and only honors the legacy `X-Emby-Authorization` when the server has
"EnableLegacyAuthorization" on — sending only the legacy header gets a 400 on
`AuthenticateByName` before credentials are even checked (confirmed against a live 12.1.0 server).
Sending both covers old and new servers; `management-server/server/src/jellyfin.ts` (a separate,
server-side Jellyfin client used for admin "Test connection" and the folder-lock picker) does the
same for the same reason.

| Call | Purpose |
|---|---|
| `POST /Users/AuthenticateByName` `{ Username, Pw }` | Login → `{ AccessToken, User: { Id } }`. |
| `GET /UserViews?userId=<id>` (a.k.a. `/Users/{id}/Views`) | Top-level libraries. |
| `GET /Items?userId=<id>&parentId=<id>&SortBy=SortName&Fields=...` | Children of a folder/library. |
| `GET /Items/{id}/Images/Primary?fillHeight=...&tag=...` | Poster/thumbnail image URL (no auth needed if `ApiKey` query is added — **not** `api_key`, see below). |
| `GET /Videos/{id}/master.m3u8?videoCodec=h264&videoRangeType=SDR&maxVideoBitDepth=8&...&ApiKey=<token>` | **Always** used for playback — Jellyfin's adaptive HLS direct-streams codecs `AVPlayer` can decode and transcodes anything it can't (e.g. MPEG-2, VC-1, HEVC). Static direct-play (`stream?static=true`) is intentionally **not used**: Apple devices have no MPEG-2 decoder, so it silently fails on that content. |
| `POST /Sessions/Playing`, `/Sessions/Playing/Progress`, `/Sessions/Playing/Stopped` | Playback reporting so Jellyfin tracks watched state + resume. **Note:** the app currently reports Start (on open) and Stopped (on back-navigation) but not periodic Progress — see the app-structure notes below. |

**`ApiKey` vs `api_key`:** `api_key` is the legacy Emby-compatibility spelling; Jellyfin 12+ silently
returns 401 for it on every `/Videos/` endpoint, same "legacy Emby shim removed" pattern as the
`X-Emby-Authorization` header above. `AVPlayer(url:)` can't attach a custom header, so this query
parameter is the *only* auth the playback request has — get the name wrong and the manifest request
401s, the `AVPlayerItem` fails to load, and AVKit's `VideoPlayer` shows its "can't play this content"
icon (a circle with a diagonal slash) over a black, frozen transport. This was misdiagnosed twice as
an HDCP/output-protection problem before being root-caused: confirmed live against a Jellyfin 12.1.0
server (`api_key` → 401 on `master.m3u8`; `ApiKey` → 200, full manifest, and real `video/mp2t` segment
bytes), then confirmed visually by pointing a debug build's `AVKit.VideoPlayer` straight at the fixed
URL in the tvOS Simulator (bypassing the management-server/login flow) and watching real video play.
A wrong query-param name is a plain HTTP 401 and has nothing to do with real display output
negotiation, so — unlike genuine HDCP issues — it reproduces fine in Simulator; that's what makes it
worth `curl`-testing the exact URL `playbackURL()` builds (a Jellyfin API key from Dashboard → API
Keys is enough for this, no user password needed) before trusting any theory about a black screen.

`videoCodec` is kept to `h264` only (excluding `hevc`) as a separate, independent hardening: this
client builds the HLS URL by hand instead of going through `/PlaybackInfo` negotiation, so the codec
allow-list is the direct-play/direct-stream rejection rule most reliably enforced on the plain
`master.m3u8` endpoint — `videoRangeType=SDR`/`maxVideoBitDepth=8` are sent as best-effort hints but
aren't honored as rejection reasons there. An HDR10/Dolby Vision source direct-streamed as 10-bit
HEVC produces the same visual symptom (black picture + restricted-content badge) as the `ApiKey` bug,
but from tvOS's real output-protection policy rather than an HTTP error — genuinely not reproducible
in the Simulator (no real HDMI/HDCP negotiation there). This fleet's library is currently plain 8-bit
H.264, so this wasn't the cause of the bug above, but forecloses the same symptom for any future HEVC
content, at the cost of transcode CPU on sources that were already safe.

**`VideoBitRate` is the parameter that actually controls transcode quality on this endpoint —
`maxStreamingBitrate` does nothing here.** A first attempt at fixing a real "trash quality" report
sent only `maxStreamingBitrate` (always, even at the admin's "Unlimited" (0) setting, which maps to
a fixed 100 Mbps ceiling — `JellyfinClient.unlimitedBitrateBps` — not an actually unbounded
request). That did **not** fix the report. Direct `curl` testing against the live server (an
essential step — the first fix looked reasonable and still didn't work) found that `maxStreamingBitrate`
is silently ignored by this plain `master.m3u8` endpoint: with it at 100 Mbps, or omitted entirely
(the original factory-default behavior), a 1920×1080 HEVC source transcoded down to **416×234 at
256 kbps** — Jellyfin's rock-bottom default tier. Adding explicit `maxWidth`/`maxHeight` didn't fix
it either. Only adding `VideoBitRate` did: verified against two more real sources on the live
server — a 1920×1080 HEVC item transcoded to full 1920×1080 H.264, and a 3840×2160 HEVC item to
full 3840×2160 H.264 at ~13 Mbps (correctly *higher* than its ~6 Mbps HEVC source, since H.264
needs more bits than HEVC for equivalent quality). Confirmed a third way, beyond `curl`: a debug
build with a temporary hook (bypassing the whole management-server/login flow, reverted before
commit) loaded each fixed URL straight into a real `AVPlayer` in the tvOS Simulator and read back
`AVPlayerItem.presentationSize` live — `1920×1080` and `3840×2160` respectively, matching source
exactly, with visibly sharp, detailed video. `maxStreamingBitrate` is still sent too (harmless,
possibly meaningful to other server versions), but `VideoBitRate` is the one load-bearing here.
The manifest's advertised `BANDWIDTH` attribute is not a reliable signal either way for checking
this: it read a flat `256000` in every failing test regardless of source bitrate or params,
evidently a cosmetic quirk of this endpoint rather than the real delivered rate — trust actual
decoded resolution/segment bytes, not the manifest header, when verifying bitrate or quality
changes here.

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
    LocalDeviceNameResolver.swift  recovers the unit's real name via Bonjour (§2, "Real device names")
  DesignSystem/
    Theme.swift              colors, metrics, gradients (driven by the server's accentColorHex)
    CachedAsyncImage.swift   in-memory image cache + fade-in (avoids AsyncImage's re-fetch-on-rerender)
    MediaCards.swift         poster / landscape / library focus cards (tvOS `.card` button style);
                             the resume-progress bar only ever shows on playable items, never on
                             folder/series/season tiles (their aggregate watched % isn't "how far
                             into this I am" and just reads as clutter on a folder icon)
    Components.swift         LoadingView, ErrorView, ClockView, SectionHeaderView
  Views/
    ConnectingView.swift     splash + "management server required" bootstrap + waiting-for-content + Identify
    LibraryView.swift        the folder browser: libraries grid, then folder/season contents
    PlayerView.swift         AVPlayer — starts paused on the first frame, resumes from saved position,
                             reports start/stop to Jellyfin + the management server. That initial
                             pause gets a large "Paused / Press Play to start …" overlay
                             (`PlayerController.isPrimedPause`) — AVKit's own transport UI only shows
                             a small pause glyph, easy to mistake for a stuck/broken player on first
                             open. Goes away for good on the user's first real Play press; later
                             pauses mid-viewing don't need the same explanation.
```

`Jellyfin/Support/Info.plist` (a sibling of `Jellyfin/Jellyfin/`, deliberately **outside** it) supplies
`NSBonjourServices`/`NSLocalNetworkUsageDescription` for `LocalDeviceNameResolver`, merged into the
otherwise auto-generated Info.plist via `INFOPLIST_FILE` alongside `GENERATE_INFOPLIST_FILE = YES`.
It has to live outside `Jellyfin/Jellyfin/` — that folder is a `PBXFileSystemSynchronizedRootGroup`
(everything under it auto-joins the target), and a file literally named `Info.plist` inside it gets
auto-added to Copy Bundle Resources too, conflicting with the merge step ("Multiple commands
produce ... Info.plist").

**The device is a pure managed appliance and a folder browser only.** There is no on-device
configuration and no local cache: every launch must reach the management server to obtain its
config. The only local input is the management server address (the bootstrap), shown on the
connection screen. There is no "watch now" dashboard, no shelves, and no search — libraries →
folders → videos, and tapping a video opens the player directly, paused on the first frame. A quiet
`appVersion` caption (fine light grey, `DeviceIdentity.appVersion`) sits at the very bottom of the
browse root — but only there: `BrowseRootView` binds its own `NavigationPath` and gates the caption
on `path.isEmpty`, so it disappears the moment you drill into a folder rather than following you
around.

**State machine (`AppModel.phase`):** `launching → registering → connectingJellyfin → ready`, plus
`waitingForContent` (server reachable, no Jellyfin assigned yet), `needsManagementServer` (server
unreachable — the app is **blocked** and keeps retrying), and `error(message)`. `needsManagementServer`
renders one of two different screens depending on whether this unit has ever connected before
(`DeviceIdentity.deviceToken == nil`): a unit that's never registered doesn't know its server yet,
so it gets `ManagementSetupView` (the address-entry prompt); a unit that already has a device token
has connected before, so losing the connection later isn't a setup problem — it gets a plain
`ErrorView` ("Lost connection to the management server… retrying automatically") instead. Showing
the address-entry screen again in that second case used to be confusing: the app already knows its
server and is already retrying in the background, so prompting to re-enter the address it never
lost read as if the unit had forgotten its configuration. A background loop
heartbeats every 3 s when connected (applying config changes and admin commands live — tuned
tight since the whole fleet is on one LAN; see `AppModel.heartbeatInterval`), retrying every 2 s
while blocked; if the server disappears it blocks after 8 failed heartbeats (~24 s+) and
auto-recovers when it returns. That threshold (`AppModel.failuresBeforeBlock`) is deliberately
generous relative to the fast heartbeat: blocking tears down `BrowseRootView`'s `NavigationStack`
(RootView's phase switch replaces the whole content view), so a threshold as low as 3 — fine at
the old 30s heartbeat, ~90s of real silence needed — got tripped by a routine multi-second network
blip at the new 3s heartbeat (starting video playback is exactly the kind of event that causes
one: a burst of HLS segment requests to Jellyfin), bouncing the user from the player straight back
to the library root mid-tap.

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
      appVersion.ts          reads latest-app-version.json (generated by build-ipa.sh, mtime-cached)
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
