# Jellyfin for Apple TV

A polished, centrally-managed **Apple TV** app that plays your media from a
self-hosted **Jellyfin** server, plus a **management server** (Node API + Google
Material admin dashboard) that runs on a local Linux box and configures every TV
from one place.

> Operators manage every TV centrally. A new Apple TV needs **zero
> manual setup** — it registers itself, receives its configuration (including the
> shared Jellyfin account) from the management server, and starts browsing.

## What's in this repo

| Path | What it is |
|---|---|
| [`Jellyfin/`](Jellyfin/) | The **tvOS app** (SwiftUI). Open `Jellyfin/Jellyfin.xcodeproj` in Xcode. |
| [`management-server/server/`](management-server/server/) | **Node + TypeScript** API + SQLite (device + admin endpoints). |
| [`management-server/admin/`](management-server/admin/) | **React + MUI** admin dashboard (Material Design). |
| [`management-server/`](management-server/) | `docker-compose.yml`, `install-linux.sh`, deployment docs. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Full system design + the API contract. |
| [`docs/UNIT_CONFIG_SCHEMA.json`](docs/UNIT_CONFIG_SCHEMA.json) | Canonical config shape both halves obey. |

## How it fits together

```
Apple TV (tvOS app) ──HTTPS──► Management server (Linux box) ◄──► Admin (browser)
        │                           │  SQLite: units + config
        └──────────── Jellyfin REST (auth, browse, video stream) ──────────────┐
                                                                                ▼
                                                                    Jellyfin media server
```

1. On first launch the TV **registers** with the management server and is created
   from the **defaults template** (this is where you set the shared Jellyfin
   account, once).
2. The TV **authenticates to Jellyfin** with the pushed account and shows the
   libraries/folders.
3. A 30-second **heartbeat** keeps the dashboard's live status fresh and applies
   any config change (or `identify`/`reload` command) you make in the admin.
4. The Apple TV is a **pure managed appliance** — it has no on-device configuration and
   does nothing without the server. If the management server is unreachable it shows a
   "management server required" screen and keeps retrying until the server returns.

## Quick start

### 1. Run the management server (serves the dashboard + API on one URL)
```bash
cd management-server/admin && npm install && npm run build   # build the dashboard once
cd ../server && cp .env.example .env                          # set ADMIN_PASSWORD, JWT_SECRET
npm install && npm run build && npm start                     # UI + API on http://localhost:4000
```
Open **http://localhost:4000**, log in (`admin` / your `.env` password), go to
**Defaults**, enter **your** Jellyfin server URL + service account, and **Test connection**.
There is no demo/sample content — the dashboard starts empty until you connect a real server
and your Apple TVs register themselves.

> Hot-reload dev (optional): `npm run dev` in `server/`, plus `npm run dev` in `admin/`
> (dashboard on `http://localhost:5173`, proxying `/api` → `:4000`).

### 2. Run the Apple TV app
Open `Jellyfin/Jellyfin.xcodeproj` in Xcode, pick an **Apple TV** simulator (or a
real Apple TV), and Run. By default it points at the fleet's Linux box,
`http://172.16.50.100:4000` (`DeviceIdentity.managementBaseURL`) — real units on
that network need zero setup. Running the server on your own Mac for local dev
instead? Enter its address (e.g. `http://localhost:4000`, which the Simulator
reaches via your Mac's `localhost`) on the app's "management server required"
screen, or change it per-unit in the dashboard. The unit will appear in the
dashboard within a few seconds.

> Build from the command line:
> ```bash
> cd Jellyfin
> DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
>   -scheme Jellyfin -sdk appletvsimulator \
>   -destination 'platform=tvOS Simulator,name=Apple TV 4K (3rd generation)' build
> ```

### Building the Ad Hoc IPA for MDM (Mosyle)

[`builds/Jellyfin.ipa`](builds/Jellyfin.ipa) is a signed Ad Hoc build (team `THW3L89YM6`,
automatic signing) ready to host and push over MDM. Refresh it anytime with:

```bash
./scripts/build-ipa.sh
```

It's also kept in sync **automatically**: a `pre-push` git hook rebuilds and re-commits
`builds/Jellyfin.ipa` whenever a push includes changes under `Jellyfin/`, so the IPA in the
repo never falls behind the app source. One-time setup per clone (hooks aren't copied by
`git clone` on their own):

```bash
git config core.hooksPath scripts/git-hooks
```

Skip it for one push with `git push --no-verify`; undo the setup with
`git config --unset core.hooksPath`.

Every build gets a real, distinct version — `scripts/build-ipa.sh` stamps in a
monotonically-increasing build number (git commit count), so the app reports e.g. `"1.0 (42)"`
instead of always `"1.0"`. After pushing a new IPA via Mosyle, set that exact string as the
**Latest app version** on the dashboard's Defaults page — the Units page then flags any TV
still running an older build. See `docs/ARCHITECTURE.md` §2, "App version tracking".

### 3. Deploy the server to the Linux box
```bash
cd management-server
./install-linux.sh            # docker compose up -d --build
```
Point each Apple TV at `http://<box-ip>:8080` (or `:4000`). See
[`management-server/README.md`](management-server/README.md). **Put it behind HTTPS**
(reverse proxy / internal CA) so the pushed Jellyfin password isn't sent in clear text.

## Status

- ✅ tvOS app (tvOS 26.4 SDK) — a native Apple-TV **folder browser** (libraries → folders → videos); tapping a video opens the AVKit player directly, paused. A pure server-managed appliance: no on-device config, no local cache, no offline mode. Plays via Jellyfin **adaptive HLS**, forced SDR/8-bit, so MPEG-2/DVD-sourced content transcodes correctly and HDR/Dolby Vision sources don't hit tvOS's black-screen output-protection behavior. Ships with a custom App Icon & Top Shelf Image (tvOS Brand Assets), and recovers each unit's **real device name via Bonjour** (Apple gates `UIDevice.current.name` to a generic "Apple TV" otherwise).
- ✅ Management server (Node + TypeScript + SQLite): device + admin API, verified end-to-end (`management-server/server/smoke-test.mjs`).
- ✅ Admin dashboard (React + MUI, Google blue): live fleet status, self-service **adoption**, per-unit + default config, **bulk fleet actions**, **move-to-new-server** migration (re-point devices to a new server with no re-adoption), Apple TV **remote control + power pairing/scheduling**, **fleet app-version tracking** (flags TVs behind the latest build), and full **server-config export/import** for backup and settings migration.
- ⏳ Follow-ups: playback profiles for non-direct-play formats, optional Keychain storage for the pushed password, periodic playback-progress reporting during video (currently only start/stop are reported — see `docs/ARCHITECTURE.md`).
