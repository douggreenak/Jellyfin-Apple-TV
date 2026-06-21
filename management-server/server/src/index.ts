import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import { initDb } from "./db";
import { initAuth } from "./auth";
import { setOnlineWindowSeconds } from "./util";
import { devicesRouter } from "./routes/devices";
import { adminRouter } from "./routes/admin";
import path from "path";
import fs from "fs";

function requireEnv(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

const PORT = Number(process.env.PORT ?? 4000);
const ADMIN_USERNAME = requireEnv("ADMIN_USERNAME", "admin");
const ADMIN_PASSWORD = requireEnv("ADMIN_PASSWORD", "changeme");
const JWT_SECRET = requireEnv("JWT_SECRET", "replace-me");
const ONLINE_WINDOW_SECONDS = Number(process.env.ONLINE_WINDOW_SECONDS ?? 90);
const DB_PATH = process.env.DB_PATH ?? "./data/jellyfin.db";
const ADMIN_ORIGIN = process.env.ADMIN_ORIGIN ?? "http://localhost:5173";
// Built admin dashboard (React) — served by this server so the web UI and the
// API share one origin/URL. Resolves for both `tsx src` and `node dist` runs.
const ADMIN_DIST = process.env.ADMIN_DIST ?? path.resolve(__dirname, "../../admin/dist");

// ----- Init subsystems -----
initDb(DB_PATH);
initAuth({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD, jwtSecret: JWT_SECRET });
setOnlineWindowSeconds(ONLINE_WINDOW_SECONDS);

// ----- Build app -----
const app = express();

// helmet's default Content-Security-Policy (script-src 'self' +
// upgrade-insecure-requests) breaks the bundled admin SPA when served over plain
// HTTP on a LAN. We keep helmet's other protections but disable CSP here; put the
// server behind an HTTPS reverse proxy for transport security.
app.use(helmet({ contentSecurityPolicy: false }));

/**
 * CORS: the admin dashboard runs on ADMIN_ORIGIN (browser, needs CORS).
 * Device requests come from the Apple TV app (not a browser, no Origin header),
 * so they are unaffected by CORS. We allow the admin origin and no-origin
 * (curl / native app) requests.
 */
// Allow same-origin requests (the served dashboard and the native device app)
// plus the dev admin origin. Same-origin requests still send an Origin header for
// non-GET and for module scripts, so we must reflect them — otherwise static
// assets and POSTs from the served dashboard get a 403.
app.use(
  cors((req, cb) => {
    const origin = req.headers.origin;
    const host = req.headers.host;
    const sameOrigin =
      !origin || origin === `http://${host}` || origin === `https://${host}`;
    if (sameOrigin || origin === ADMIN_ORIGIN) {
      cb(null, { origin: true, credentials: true });
    } else {
      cb(null, { origin: false });
    }
  })
);

app.use(express.json({ limit: "1mb" }));

// ----- Routes -----
const api = express.Router();
api.get("/health", (_req, res) => res.json({ ok: true }));
api.use("/devices", devicesRouter);
api.use("/admin", adminRouter);
app.use("/api/v1", api);

// Unknown API routes -> JSON 404.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ----- Serve the admin web dashboard (built React app) -----
const adminBuilt = fs.existsSync(path.join(ADMIN_DIST, "index.html"));
if (adminBuilt) {
  app.use(express.static(ADMIN_DIST));
  // SPA fallback: any non-API GET returns index.html so client-side routing works.
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.sendFile(path.join(ADMIN_DIST, "index.html"));
  });
} else {
  app.get("/", (_req, res) => {
    res
      .status(200)
      .type("html")
      .send(
        "<h1>Jellyfin management server</h1><p>The API is running at <code>/api/v1</code>. " +
          "Build the dashboard (<code>cd ../admin &amp;&amp; npm install &amp;&amp; npm run build</code>) " +
          "to serve the web UI from here.</p>"
      );
  });
}

// Final catch-all 404.
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Central error handler (e.g. malformed JSON, CORS rejections).
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    if (err && err.message === "Not allowed by CORS") {
      res.status(403).json({ error: "CORS: origin not allowed" });
      return;
    }
    if (err && err.name === "SyntaxError") {
      res.status(400).json({ error: "Malformed JSON body" });
      return;
    }
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
);

app.listen(PORT, () => {
  console.log(`Jellyfin management server listening on http://localhost:${PORT}`);
  console.log(`  Dashboard:     http://localhost:${PORT}/${adminBuilt ? "" : "  (run: cd ../admin && npm run build)"}`);
  console.log(`  API base:      http://localhost:${PORT}/api/v1`);
  console.log(`  DB:            ${DB_PATH}`);
});
