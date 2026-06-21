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
  auto‑included — no pbxproj edits needed.
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
(DVD‑sourced, etc.) is MPEG‑2. **Always play via Jellyfin's adaptive HLS** (`/Videos/{id}/master.m3u8`
with `videoCodec=h264,hevc`), which direct‑streams compatible codecs and transcodes the rest.
Do **not** use static direct‑play (`stream?static=true`) — it silently fails on MPEG‑2.

## Server ↔ device contract
- Device endpoints: `register`, `GET/PUT config`, `heartbeat`, `ack`. Admin endpoints under
  `/admin`. Heartbeat (~30s) returns `{ok, configVersion, command}`; the device applies config
  changes (soft‑reconnect, never tearing down the UI) and runs commands (`reload`/`identify`/
  `restart`/`migrate`).
- **Adoption**: a new device registers `adopted:false` ("ready to adopt"); `POST /admin/units/:id/adopt`
  applies the defaults template (shared Jellyfin account) and marks it adopted.
- **Move to new server**: a `migrate` command carries the new management base URL (`command.data`);
  the device re‑points its `managementBaseURL` and reconnects with its existing identity (so the
  new server, with the migrated DB, recognizes it — no re‑adoption).

## Conventions
- SwiftUI, Swift 5 mode, `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` (types are MainActor‑isolated
  by default; network clients use `async`/`await`). Match the surrounding style.
- Server is TypeScript/CommonJS (better‑sqlite3 is CJS — do not switch to ESM). Validate with zod.
- After changing code, **build it** (don't trust diagnostics), and for app behavior, run it in the
  simulator and screenshot.
