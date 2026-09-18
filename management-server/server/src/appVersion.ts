import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The fleet's "latest app version" — generated automatically by
 * scripts/build-ipa.sh on every push (alongside the IPA itself) and committed
 * to the repo at VERSION_FILE, not admin-editable. See docs/ARCHITECTURE.md
 * §2, "App version tracking".
 *
 * Resolves relative to this module's own directory (`../` from either
 * `dist/appVersion.js` or `src/appVersion.ts`, both one level under
 * `management-server/server/`) so it works the same under `tsx src` and
 * `node dist`, mirroring how index.ts resolves ADMIN_DIST.
 */
const VERSION_FILE = resolve(__dirname, "../latest-app-version.json");

/**
 * Same file, straight from GitHub's `main` branch — the actual source of
 * truth for "what was most recently pushed," independent of whether this
 * server process's own local checkout has been `git pull`ed since. Without
 * this, every unit that picks up a fresh IPA via Mosyle looks permanently
 * "outdated" on any deployment that isn't re-pulled + restarted right after
 * each push (which nothing here automates) — the dashboard was comparing
 * against a stale local file, not reality.
 */
const GITHUB_RAW_URL =
  "https://raw.githubusercontent.com/douggreenak/Jellyfin-Apple-TV/main/management-server/server/latest-app-version.json";
const GITHUB_POLL_INTERVAL_MS = 10 * 60 * 1000; // GitHub raw content is itself CDN-cached for a bit; no need to hammer it.
const GITHUB_FETCH_TIMEOUT_MS = 5_000;

interface VersionFile {
  version: string;
}

let fileCache: { mtimeMs: number; version: string | undefined } | undefined;
/** Last version successfully read from GitHub; undefined until the first poll succeeds. */
let githubVersion: string | undefined;

function parseVersionFile(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as VersionFile;
    return typeof parsed.version === "string" && parsed.version.trim() ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads VERSION_FILE, re-reading only when its mtime changes rather than on
 * every call. Used as the fallback when GitHub hasn't been reached yet (right
 * after process start) or can't be reached at all (no outbound internet,
 * GitHub down, repo moved) — so this never regresses to "unknown" just
 * because of a network hiccup.
 */
function readLocalVersion(): string | undefined {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(VERSION_FILE).mtimeMs;
  } catch {
    fileCache = undefined;
    return undefined;
  }

  if (fileCache && fileCache.mtimeMs === mtimeMs) return fileCache.version;

  let version: string | undefined;
  try {
    version = parseVersionFile(readFileSync(VERSION_FILE, "utf8"));
  } catch {
    version = undefined;
  }
  fileCache = { mtimeMs, version };
  return version;
}

async function pollGitHub(): Promise<void> {
  try {
    const res = await fetch(GITHUB_RAW_URL, { signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS) });
    if (!res.ok) return; // keep the last known-good value (GitHub's or the local file's)
    const version = parseVersionFile(await res.text());
    if (version) githubVersion = version;
  } catch {
    // Network hiccup, rate limit, GitHub outage — keep the last known-good value.
  }
}

/**
 * Starts polling GitHub for the fleet's real "latest version," so it reflects
 * what was actually pushed rather than this process's own possibly-stale
 * local checkout. Call once at startup (see index.ts). Fires an immediate
 * poll plus a background interval; `.unref()` so it never keeps the process
 * alive on its own.
 */
export function startAppVersionPolling(): void {
  void pollGitHub();
  setInterval(() => void pollGitHub(), GITHUB_POLL_INTERVAL_MS).unref();
}

/**
 * Backs GET /admin/app-version and each admin units-list request. Prefers the
 * GitHub-sourced version; falls back to the local file if GitHub hasn't
 * answered yet or can't be reached. Returns undefined only if neither source
 * has a value — callers treat that as "unknown".
 */
export function getLatestAppVersion(): string | undefined {
  return githubVersion ?? readLocalVersion();
}
