import { randomUUID, randomBytes } from "node:crypto";
import type { UnitConfig } from "./schema";
import type { UnitRow } from "./db";

/** ID used for commands and misc identifiers. */
export function newId(): string {
  return randomUUID();
}

/** Opaque device token (URL-safe). */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Server-side status shape (stored as JSON in the units.status column). */
export interface UnitStatus {
  online: boolean;
  lastSeenAt: string | null;
  appVersion: string | null;
  tvosVersion: string | null;
  model: string | null;
  ipAddress: string | null;
  nowPlaying: Record<string, unknown> | null;
  lastError: string | null;
}

/** A fresh, blank status (used for newly registered or imported units). */
export function emptyStatus(): UnitStatus {
  return {
    online: false,
    lastSeenAt: null,
    appVersion: null,
    tvosVersion: null,
    model: null,
    ipAddress: null,
    nowPlaying: null,
    lastError: null,
  };
}

export interface PendingCommand {
  id: string;
  type: "reload" | "identify" | "restart" | "migrate";
  issuedAt: string;
  /** For "migrate": the new management server base URL. */
  data?: string;
}

/** API-facing Unit object (no deviceToken — never leaked). */
export interface UnitApi {
  unitId: string;
  displayName: string;
  groupId: string | null;
  config: UnitConfig;
  status: UnitStatus;
  pendingCommand: PendingCommand | null;
  registeredAt: string;
  adopted: boolean;
  /** Whether this unit is paired for remote power control (set by admin routes). */
  powerConfigured?: boolean;
  /** How this unit's reported appVersion compares to the fleet's latest (set by admin routes). */
  appVersionStatus?: AppVersionStatus;
}

export type AppVersionStatus = "current" | "outdated" | "unknown";

/**
 * Compares a unit's reported `status.appVersion` against the fleet's configured
 * "latest" value. Exact string equality — appVersion is "marketing (build)"
 * (e.g. "1.0 (42)") and the build number is a monotonically increasing counter
 * stamped in at export time, so there's no meaningful ordering to parse: a
 * mismatch just means "not the build we most recently cut."
 * "unknown" means there isn't enough information to say either way (the fleet
 * has no latest version configured yet, or this unit hasn't reported one).
 */
export function computeAppVersionStatus(
  reported: string | null | undefined,
  latest: string | undefined
): AppVersionStatus {
  if (!latest || !reported) return "unknown";
  return reported === latest ? "current" : "outdated";
}

let onlineWindowSeconds = 90;
export function setOnlineWindowSeconds(seconds: number): void {
  if (Number.isFinite(seconds) && seconds > 0) onlineWindowSeconds = seconds;
}
export function getOnlineWindowSeconds(): number {
  return onlineWindowSeconds;
}

/** Derive `online` from lastSeenAt relative to ONLINE_WINDOW_SECONDS. */
export function deriveOnline(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false;
  const t = Date.parse(lastSeenAt);
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= onlineWindowSeconds * 1000;
}

/**
 * Shape a raw DB row into the Unit API object with freshly derived
 * status.online. Strips deviceToken.
 */
export function toUnit(row: UnitRow): UnitApi {
  const config = JSON.parse(row.config) as UnitConfig;
  const status = JSON.parse(row.status) as UnitStatus;
  const pendingCommand = row.pendingCommand
    ? (JSON.parse(row.pendingCommand) as PendingCommand)
    : null;
  return {
    unitId: row.unitId,
    displayName: row.displayName,
    groupId: row.groupId,
    config,
    status: { ...status, online: deriveOnline(status.lastSeenAt) },
    pendingCommand,
    registeredAt: row.registeredAt,
    adopted: !!row.adopted,
  };
}

type Plain = Record<string, unknown>;

function isPlainObject(v: unknown): v is Plain {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.prototype.toString.call(v) === "[object Object]"
  );
}

/**
 * Recursively deep-merge `partial` into `target`, returning a new object.
 * Plain objects are merged key-by-key; arrays and scalars are replaced
 * wholesale. `undefined` values in the partial are skipped (so absent keys
 * never clobber). `null` IS a real value and overwrites.
 */
export function deepMerge<T>(target: T, partial: unknown): T {
  if (!isPlainObject(partial)) {
    return (partial === undefined ? target : (partial as T));
  }
  const base: Plain = isPlainObject(target) ? { ...(target as Plain) } : {};
  for (const [key, value] of Object.entries(partial)) {
    if (value === undefined) continue;
    if (isPlainObject(value) && isPlainObject(base[key])) {
      base[key] = deepMerge(base[key], value);
    } else {
      base[key] = value;
    }
  }
  return base as T;
}
