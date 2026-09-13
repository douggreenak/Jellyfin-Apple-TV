import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The fleet's "latest app version" — generated automatically by
 * scripts/build-ipa.sh on every push (alongside the IPA itself) and committed
 * to the repo at VERSION_FILE, not admin-editable. The deployed server picks
 * it up on its next `git pull` + restart, same as any other source change —
 * no dashboard action, no API write path. See docs/ARCHITECTURE.md §2,
 * "App version tracking".
 *
 * Resolves relative to this module's own directory (`../` from either
 * `dist/appVersion.js` or `src/appVersion.ts`, both one level under
 * `management-server/server/`) so it works the same under `tsx src` and
 * `node dist`, mirroring how index.ts resolves ADMIN_DIST.
 */
const VERSION_FILE = resolve(__dirname, "../latest-app-version.json");

interface VersionFile {
  version: string;
}

let cache: { mtimeMs: number; version: string | undefined } | undefined;

/**
 * Reads VERSION_FILE, re-reading only when its mtime changes (so a `git
 * pull` without a full process restart is still picked up) rather than on
 * every call — this backs GET /admin/app-version and each admin units list
 * request. Returns undefined if the file is missing or malformed (no build
 * has been pushed since this feature shipped, or a fresh checkout that
 * hasn't run the build script yet) — callers treat that as "unknown".
 */
export function getLatestAppVersion(): string | undefined {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(VERSION_FILE).mtimeMs;
  } catch {
    cache = undefined;
    return undefined;
  }

  if (cache && cache.mtimeMs === mtimeMs) return cache.version;

  let version: string | undefined;
  try {
    const parsed = JSON.parse(readFileSync(VERSION_FILE, "utf8")) as VersionFile;
    version = typeof parsed.version === "string" && parsed.version.trim() ? parsed.version : undefined;
  } catch {
    version = undefined;
  }
  cache = { mtimeMs, version };
  return version;
}
