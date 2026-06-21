# Jellyfin — Apple TV Management Server

This is the **control center** for a fleet of Apple TVs that play media
from your self-hosted **Jellyfin** media server.

You run this on **one Linux box** on your network. It gives you:

- A **web dashboard** to see every Apple TV, whether it's online, and what it's playing.
- One place to change each TV's **settings** (which libraries to show, the look, the
  Jellyfin login, a settings PIN, etc.) — changes push out to the TVs automatically.
- A shared **Jellyfin service account** that gets handed to the TVs so nobody types
  passwords into a television.

The Apple TVs set themselves up: a TV registers with this server on first boot, pulls
its configuration, and starts playing. You manage everything from the dashboard.

> The Apple TV app itself is built and installed separately (see the `Jellyfin/` Xcode
> project). This folder is only the **server + dashboard**.

For the full picture of how the pieces fit together, see
[`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

---

## What's in here

```
management-server/
  server/            Node + TypeScript backend (the API), SQLite database
  admin/             React + Material UI dashboard (served by nginx)
  docker-compose.yml Runs both with one command
  install-linux.sh   Friendly installer for a Linux box
  systemd/           Optional service unit if you run WITHOUT Docker
  data/              Your SQLite database lives here (created on first run)
```

---

## Prerequisites

**For the easy path (Docker):**

- A Linux box (Ubuntu/Debian/Fedora/etc.) on the same network as the Apple TVs and
  the Jellyfin server.
- **Docker** with the **Compose** plugin.
  Install: https://docs.docker.com/engine/install/ — then check:
  ```bash
  docker --version
  docker compose version
  ```

**For the manual path (no Docker):**

- **Node.js 20 or newer** and npm.
- A C/C++ toolchain so the SQLite driver can compile (`build-essential` on
  Debian/Ubuntu, or `python3 make gcc-c++` on Fedora).

---

## Quick start (Docker) — recommended

From this `management-server/` folder:

```bash
chmod +x install-linux.sh
./install-linux.sh
```

The installer will:

1. Check Docker + Compose are ready.
2. Create `server/.env` from the template (and generate a random `JWT_SECRET`).
3. Offer to open `server/.env` so you can **set the admin password**.
4. Build and start both containers.
5. Print the URLs you need.

When it finishes you'll have:

| Thing | URL |
|---|---|
| **Admin dashboard** | `http://<box-ip>:8080` |
| **Device API** (via dashboard proxy) | `http://<box-ip>:8080/api/v1` |
| **Device API** (direct to backend) | `http://<box-ip>:4000/api/v1` |

Log in to the dashboard with the username/password from `server/.env`.

Day-to-day commands (run from this folder):

```bash
docker compose ps          # is it running?
docker compose logs -f     # watch what it's doing
docker compose down        # stop it (your data is kept)
docker compose up -d        # start it again
docker compose up -d --build  # rebuild after a code update
```

### Don't want the installer?

You can do it by hand:

```bash
cp server/.env.example server/.env
nano server/.env           # set ADMIN_PASSWORD and JWT_SECRET
docker compose up -d --build
```

---

## Setting the admin password

The dashboard login is controlled by **`server/.env`**:

```ini
ADMIN_USERNAME=admin
ADMIN_PASSWORD=pick-a-good-one
```

The server hashes the password (bcrypt) when it starts — you only ever put the
plaintext in `server/.env`. **Change `ADMIN_PASSWORD` from the default before this is
reachable on any network.** After editing, restart so it takes effect:

```bash
docker compose up -d        # Docker
# or: sudo systemctl restart jellyfin-management-server   (systemd path)
```

Also set **`JWT_SECRET`** to a long random value (the installer does this for you).
Generate one anytime with:

```bash
openssl rand -hex 32
```

---

## Pointing the Apple TVs at this server

Each Apple TV needs the **base address of this box**. Use either:

- `http://<box-ip>:8080`  — goes through the dashboard's nginx (one port for
  everything), **or**
- `http://<box-ip>:4000`  — talks to the backend directly.

The app appends `/api/v1/...` itself, so the device API ends up at
`http://<box-ip>:8080/api/v1` or `http://<box-ip>:4000/api/v1`. Both work — pick one
and be consistent.

Find the box's IP with `hostname -I` (or `ip addr`). A **fixed/reserved IP** (or a
DNS name like `jellyfin.lan`) is strongly recommended so the address never
changes under the TVs.

Once a TV is pointed here, it shows up in the dashboard automatically — no per-TV
setup. From there you rename it, choose its libraries, set the look, and so on.

---

## HTTPS — please read before going live

By design, this server stores the **shared Jellyfin account password** and **pushes it
to each Apple TV**. Over plain `http://` that password (and the admin login) travel in
**clear text** on your network. On a trusted, isolated LAN that may be
acceptable to start, but for anything beyond that you should put this behind **HTTPS**:

- Run a reverse proxy (nginx, Caddy, or Traefik) in front of port 8080 with a TLS
  certificate — either from your **internal CA** or a public one (Let's
  Encrypt) if the box is reachable by a real hostname.
- Caddy is the least fiddly: a two-line `Caddyfile` (`yourname.example.com { reverse_proxy localhost:8080 }`)
  gets you automatic certificates.
- Point the Apple TVs at the **`https://`** address once TLS is in place.

See [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) (§6 Security) for the rationale.

---

## Where your data is stored

Everything lives in **one SQLite file** — no separate database to run or back up.

- **Docker:** the host folder **`management-server/data/`** is mounted into the
  container, and the database file is `data/jellyfin.db` (path set by `DB_PATH` in
  `server/.env`). To back up, copy that folder while the server is stopped (or use
  `sqlite3 data/jellyfin.db ".backup backup.db"` while it's running).
- **Manual / systemd:** same file, under wherever you put the project
  (`server/data/jellyfin.db` by default).

To start completely fresh, stop the server and delete the file in `data/`.

---

## Manual start (no Docker)

If you'd rather not use Docker:

**1. Build and run the backend**

```bash
cd server
cp .env.example .env        # set ADMIN_PASSWORD, JWT_SECRET, etc.
npm ci                       # installs deps; compiles the SQLite driver
npm run build                # TypeScript -> dist/
npm start                    # runs node dist/index.js on PORT (4000)
```

The API is now at `http://<box-ip>:4000/api/v1`.

**2. Build and serve the dashboard**

```bash
cd ../admin
npm ci
npm run build                # outputs static files to admin/dist/
```

Then serve `admin/dist/` with any static web server and make sure requests to
`/api/` reach the backend on port 4000. The simplest options:

- Use the Docker admin image (it already bundles the right nginx config), **or**
- Drop `admin/dist/` into your own nginx and reuse the proxy rules in
  [`admin/nginx.conf`](admin/nginx.conf) (change `proxy_pass` to
  `http://localhost:4000`), **or**
- For a quick test only: `npm run preview` (Vite's preview server).

> In the manual path the Apple TVs can simply point at `http://<box-ip>:4000` and skip
> nginx entirely — the backend serves the device API directly.

### Run the backend as a service (systemd)

To keep the backend running across reboots without Docker, use the provided unit:
[`systemd/jellyfin-management-server.service`](systemd/jellyfin-management-server.service). It has
step-by-step install notes in its header comments — in short:

```bash
sudo cp systemd/jellyfin-management-server.service /etc/systemd/system/
sudo nano /etc/systemd/system/jellyfin-management-server.service   # fix paths + User
sudo systemctl daemon-reload
sudo systemctl enable --now jellyfin-management-server
journalctl -u jellyfin-management-server -f                         # logs
```

---

## Troubleshooting

| Symptom | Try |
|---|---|
| `Cannot talk to the Docker daemon` | Is Docker running? You may need `sudo`, or add yourself to the `docker` group and re-login. |
| Dashboard loads but **login fails** | Check `ADMIN_USERNAME`/`ADMIN_PASSWORD` in `server/.env`, then `docker compose up -d` to restart. |
| Dashboard shows but **no units / API errors** | Confirm the backend is up: `docker compose logs server`. The dashboard proxies `/api/` to it. |
| A TV doesn't appear | Make sure it's pointed at `http://<box-ip>:8080` (or `:4000`) and is on the same network; check `docker compose logs server` for its register/heartbeat. |
| `better-sqlite3` fails to build (manual path) | Install a C++ toolchain: `build-essential` (Debian/Ubuntu) or `python3 make gcc-c++` (Fedora), then `npm ci` again. |
| Port 8080 or 4000 already in use | Change the host-side port in `docker-compose.yml` (e.g. `"9090:80"`), then `docker compose up -d`. |

---

## Related docs

- [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) — full system design, API reference, security model.
- [`../docs/UNIT_CONFIG_SCHEMA.json`](../docs/UNIT_CONFIG_SCHEMA.json) — the canonical config contract shared with the Apple TV app.
