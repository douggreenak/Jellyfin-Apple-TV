# CLAUDE.md

Guidance for working in this repo. Read this first.

## What this is
A centrally‑managed **Apple TV** Jellyfin client for playing media on a fleet of TVs, plus a
**management server** (Node API + React/MUI admin) that runs on a local Linux box.

- `Jellyfin/` — the **tvOS app** (SwiftUI). Open `Jellyfin/Jellyfin.xcodeproj`.
- `management-server/server/` — Node + TypeScript API + SQLite.
- `management-server/admin/` — React + Vite + MUI dashboard ("Jellyfin — Fleet").
- `docs/ARCHITECTURE.md`, `docs/UNIT_CONFIG_SCHEMA.json` — the shared contract.

## Product principles (do not regress)
- The tvOS app is a **pure managed appliance**: no on‑device configuration, **no local cache**,
  and it does **nothing without the management server** (shows "Management server required" /
  auto‑retries). Every setting comes from the server.
- **No sample/demo content, ever.** Defaults ship with empty Jellyfin creds.
- The app is a **folder browser only** — libraries → folders → videos. There is **no** "watch
  now" dashboard/shelves and **no** search. Tapping a video opens the **player directly, paused**.
- Look like a **native Apple TV app**: focus engine, clean dark background (no colored wash),
  restrained typography, no publish‑year clutter.

## Build & run (gotchas matter)
- **tvOS build** — the active toolchain is Command Line Tools, so always prefix with
  `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`:
  ```bash
  cd "Jellyfin"
  DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
    -project Jellyfin.xcodeproj -scheme Jellyfin -sdk appletvsimulator \
    -destination 'platform=tvOS Simulator,name=Apple TV 4K (3rd generation),OS=26.4' \
    CODE_SIGNING_ALLOWED=NO build
  ```
  Bundle id `com.douggreenak.proremote.Jellyfin`. The project uses a
  `PBXFileSystemSynchronizedRootGroup`, so new `.swift` files under `Jellyfin/Jellyfin/` are
  auto‑included — no pbxproj edits needed. **A file literally named `Info.plist` does NOT
  belong under `Jellyfin/Jellyfin/`** for the same reason: Xcode auto‑adds it to Copy Bundle
  Resources too, conflicting with the auto‑generated one ("Multiple commands produce ...
  Info.plist"). The project already merges one in from `Jellyfin/Support/Info.plist` (a
  sibling, outside the synced folder) via `INFOPLIST_FILE` + `GENERATE_INFOPLIST_FILE = YES` —
  add new keys there, don't create another Info.plist inside `Jellyfin/Jellyfin/`.
- **The live SourceKit "Cannot find type X" / "card unavailable in macOS" diagnostics are FALSE.**
  `SDKROOT = auto` makes the indexer use the macOS SDK. Trust `xcodebuild -sdk appletvsimulator`,
  not the editor squiggles.
- **Find the built app** (avoid the `Index.noindex` copy, which has no bundle id):
  ```bash
  find ~/Library/Developer/Xcode/DerivedData -type d \
    -path "*/Build/Products/Debug-appletvsimulator/Jellyfin.app" -not -path "*Index.noindex*"
  ```
- **Server / admin** — `export PATH="/opt/homebrew/bin:$PATH"`; `better-sqlite3` must be v12+
  (v11 fails to native‑build on Node 26). Server: `npm run build && npm start` (needs `.env` from
  `.env.example`; admin defaults `admin`/`changeme`). The server **also serves the built admin**
  at `http://localhost:4000/` (`express.static`), so build the admin first (`npm run build`).
  End‑to‑end server test: `node smoke-test.mjs`.

## Testing the running app (simulator)
- Drive the tvOS remote via AppleScript key codes (needs macOS Accessibility granted to the host):
  Up `126`, Down `125`, Left `123`, Right `124`, Select `36`, Menu/Back `53`.
  ```bash
  osascript -e 'tell application "Simulator" to activate' -e 'delay 0.4' \
            -e 'tell application "System Events" to key code 36'
  ```
  (Hardware‑keyboard text entry into tvOS fields does **not** route reliably — type via the
  on‑screen keyboard or verify text fields manually.)
- Capture the device screen with `xcrun simctl io <UDID> screenshot out.png` (independent of the
  compositor). Sim: `Apple TV 4K (3rd generation)` `OS=26.4`.
- Read the app's logs: it uses `os.Logger(subsystem: "com.jellyfin.appletv")`; stream with
  `xcrun simctl spawn <UDID> log stream --level info --predicate 'subsystem == "com.jellyfin.appletv"'`.

## Playback (important)
Apple devices have **no MPEG‑2 decoder** and limited codec support; much real‑world content
(DVD‑sourced, etc.) is MPEG‑2. **Always play via Jellyfin's adaptive HLS** (`/Videos/{id}/master.m3u8`).
Do **not** use static direct‑play (`stream?static=true`) — it silently fails on MPEG‑2.

**The query parameter is `ApiKey`, not `api_key` — this was the real cause of the "black screen +
restricted‑content badge" bug, twice diagnosed wrong before this.** `api_key` is the legacy
Emby‑compatibility spelling (also used for `imageURL`/`image()`); Jellyfin 12+ silently 401s it on
every endpoint under `/Videos/`, same "legacy Emby shim removed" pattern as the
`X-Emby-Authorization` header below. `AVPlayer(url:)` can't attach a custom header, so this query
param is the *only* auth the playback request has — get the name wrong and the manifest 401s,
AVPlayer's item fails to load, and AVKit's `VideoPlayer` shows its "can't play this content" icon
(a circle with a diagonal slash) over a black, frozen transport. That looks exactly like an
HDCP/output‑protection block (and was misdiagnosed as one, including a whole `videoCodec` rewrite
that didn't fix anything because the library was already plain 8‑bit H.264 — the request was never
reaching real content at all). **Don't trust reasoning alone here — verify against the live
server.** `curl` the exact URL `playbackURL()` builds and check for a real `2xx` + a valid
`#EXTM3U` manifest (a Jellyfin **API key**, Dashboard → API Keys, is enough — no user password
needed); a full trust-nothing check plays it in the Simulator with a debug hook that bypasses the
management‑server/login flow and drops the URL straight into `AVKit.VideoPlayer` — this **does**
work in Simulator despite the HDCP note below, because a wrong query‑param name is a plain HTTP
401, nothing to do with real display output negotiation.

**`videoCodec` is `h264` only — don't add `hevc` back.** tvOS can decode HEVC fine, so it's tempting
to allow it for efficiency, but this client builds the HLS URL by hand instead of going through
Jellyfin's `/PlaybackInfo` negotiation (where a real `DeviceProfile` could declare "no 10‑bit/HDR
HEVC"). On the plain `master.m3u8` endpoint, the codec allow‑list is the direct‑play/direct‑stream
rejection rule that's most reliably enforced — `videoRangeType=SDR`/`maxVideoBitDepth=8` are kept as
best‑effort hints for when a transcode does happen, but excluding `hevc` guarantees one happens for
any non‑H.264 source, and ffmpeg's H.264 encoder only ever produces 8‑bit SDR. This fleet's current
library is already plain 8‑bit H.264 (so this wasn't the `ApiKey` bug's cause), but it's still worth
keeping: an HDR10/Dolby Vision source direct‑streamed as 10‑bit HEVC produces the *exact same*
symptom (black picture + restricted‑content badge, tvOS's real output‑protection policy this time,
not a 401) for any future content. Costs transcode CPU on sources that were already safe HEVC — the
right trade for a managed fleet where reliability beats efficiency. Unlike the `ApiKey` bug, *this*
specific failure mode genuinely can't be reproduced in the Simulator (no real HDMI/HDCP negotiation
there) — verify on a real Apple TV if HEVC/HDR content is ever added to the library.

## Jellyfin auth headers (both clients — tvOS app AND management-server/server/src/jellyfin.ts)
**Always send both `Authorization` and `X-Emby-Authorization`** with the identical
`MediaBrowser Client="...", Device="...", DeviceId="...", Version="..."` value on every Jellyfin
request. Jellyfin 12+ reads the standard `Authorization` header by default and only falls back to
the legacy `X-Emby-Authorization` when the server has "EnableLegacyAuthorization" turned on — a
client sending only the legacy header gets a `400 Bad Request` / "Error processing request." on
`Users/AuthenticateByName` (the server can't find `request.App`) *before it ever checks
credentials* — every login fails regardless of username/password. Confirmed against a live
Jellyfin 12.1.0 server: `X-Emby-Authorization` alone → 400; adding `Authorization` → normal
401 (bad creds) / 200 (good creds). Not a DRM/token issue, purely which header the server bothers
to parse.

## Server ↔ device contract
- Device endpoints: `register`, `GET/PUT config`, `heartbeat`, `ack`. Admin endpoints under
  `/admin`. Heartbeat (~3s — `AppModel.heartbeatInterval`, tuned tight since the fleet is one
  LAN) returns `{ok, configVersion, command}`; the device applies config changes
  (soft‑reconnect, never tearing down the UI) and runs commands (`reload`/`identify`/
  `restart`/`migrate`).
- **Adoption**: a new device registers `adopted:false` ("ready to adopt"); `POST /admin/units/:id/adopt`
  applies the defaults template (shared Jellyfin account) and marks it adopted.
- **Move to new server**: a `migrate` command carries the new management base URL (`command.data`);
  the device re‑points its `managementBaseURL` and reconnects with its existing identity (so the
  new server, with the migrated DB, recognizes it — no re‑adoption).
- **Device names are generic, not real**: `UIDevice.current.name` is gated by Apple (tvOS 16+)
  and returns the literal string `"Apple TV"` to any app without the special
  `com.apple.developer.device-information.user-assigned-device-name` entitlement (a formal
  Apple application, not something code can get around directly). `LocalDeviceNameResolver`
  recovers the real name via Bonjour instead — see `docs/ARCHITECTURE.md` §2, "Real device
  names via Bonjour" — which needs the ordinary Local Network permission
  (`Jellyfin/Support/Info.plist`), not the gated entitlement.

## Conventions
- SwiftUI, Swift 5 mode, `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` (types are MainActor‑isolated
  by default; network clients use `async`/`await`). Match the surrounding style.
- Server is TypeScript/CommonJS (better‑sqlite3 is CJS — do not switch to ESM). Validate with zod.
- After changing code, **build it** (don't trust diagnostics), and for app behavior, run it in the
  simulator and screenshot.
