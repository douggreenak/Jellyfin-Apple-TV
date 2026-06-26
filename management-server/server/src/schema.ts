import { z } from "zod";
import { DEFAULT_TEMPLATE } from "./defaults";

/**
 * Zod schemas mirroring the canonical UnitConfig JSON Schema EXACTLY.
 * Source of truth: docs/UNIT_CONFIG_SCHEMA.json
 *
 * - All objects use .strict() so unknown keys are rejected.
 * - Enums, hex pattern, and PIN pattern match the schema.
 * - deepPartial variants are exported for PATCH (deep-merge) bodies.
 */

const hexColor = z
  .string()
  .regex(/^#([0-9a-fA-F]{6})$/, "accentColorHex must be #RRGGBB");

const pin = z
  .string()
  .regex(/^[0-9]{4}$/, "settingsPin must be exactly 4 digits");

export const jellyfinSchema = z
  .object({
    serverUrl: z.string(),
    username: z.string(),
    password: z.string(),
  })
  .strict();

export const browseSchema = z
  .object({
    mode: z.enum(["full", "curated", "kiosk"]),
    homeLibraryId: z.string().nullable(),
    allowedLibraryIds: z.array(z.string()),
    hiddenLibraryIds: z.array(z.string()),
  })
  .strict();

export const appearanceSchema = z
  .object({
    appTitle: z.string(),
    theme: z.enum(["system", "light", "dark"]),
    accentColorHex: hexColor,
    showClock: z.boolean(),
    showItemTitles: z.boolean(),
    posterStyle: z.enum(["poster", "thumb", "wide"]),
  })
  .strict();

export const playbackSchema = z
  .object({
    autoplayNext: z.boolean(),
    maxBitrateMbps: z.number().min(0),
    preferDirectPlay: z.boolean(),
  })
  .strict();

export const securitySchema = z
  .object({
    settingsPinEnabled: z.boolean(),
    settingsPin: pin.nullable(),
  })
  .strict();

export const unitConfigSchema = z
  .object({
    unitId: z.string(),
    displayName: z.string(),
    groupId: z.string().nullable().default(null),
    jellyfin: jellyfinSchema,
    browse: browseSchema,
    appearance: appearanceSchema,
    playback: playbackSchema,
    security: securitySchema,
    configVersion: z.number().int().min(1),
    updatedAt: z.string(),
  })
  .strict();

export type UnitConfig = z.infer<typeof unitConfigSchema>;
export type Jellyfin = z.infer<typeof jellyfinSchema>;
export type Browse = z.infer<typeof browseSchema>;
export type Appearance = z.infer<typeof appearanceSchema>;
export type Playback = z.infer<typeof playbackSchema>;
export type Security = z.infer<typeof securitySchema>;

/**
 * Deep-partial schema for PATCH /admin/units/:unitId/config bodies.
 *
 * Every nested object is partial + strict so callers can send any subset of
 * fields. unitId/configVersion/updatedAt are intentionally NOT patchable here;
 * the server owns those. They are stripped if present (we omit them from the
 * shape entirely, and strict() rejects them) — keep them out of the body.
 */
export const unitConfigPatchSchema = z
  .object({
    displayName: z.string(),
    groupId: z.string().nullable(),
    jellyfin: jellyfinSchema.partial().strict(),
    browse: browseSchema.partial().strict(),
    appearance: appearanceSchema.partial().strict(),
    playback: playbackSchema.partial().strict(),
    security: securitySchema.partial().strict(),
  })
  .partial()
  .strict();

export type UnitConfigPatch = z.infer<typeof unitConfigPatchSchema>;

/** Status fields a device may report on heartbeat. */
export const nowPlayingSchema = z
  .object({
    title: z.string(),
    itemId: z.string(),
    positionTicks: z.number(),
  })
  .partial()
  .strict()
  .nullable();

export const heartbeatSchema = z
  .object({
    ipAddress: z.string().optional(),
    nowPlaying: nowPlayingSchema.optional(),
    lastError: z.string().nullable().optional(),
  })
  .strict();

export type HeartbeatBody = z.infer<typeof heartbeatSchema>;

/** Device registration body. */
export const registerSchema = z
  .object({
    unitId: z.string().min(1),
    deviceName: z.string().min(1),
    model: z.string().optional(),
    tvosVersion: z.string().optional(),
    appVersion: z.string().optional(),
  })
  .strict();

export type RegisterBody = z.infer<typeof registerSchema>;

export const ackSchema = z.object({ commandId: z.string() }).strict();

export const commandSchema = z
  .object({
    type: z.enum(["reload", "identify", "restart", "migrate"]),
    // For "migrate": the new management server base URL the device should switch to.
    data: z.string().optional(),
  })
  .strict();

/** Bulk action over many units (fleet management). */
export const bulkActionSchema = z
  .object({
    unitIds: z.array(z.string()).min(1),
    action: z.enum([
      "adopt",
      "unadopt",
      "reload",
      "identify",
      "restart",
      "delete",
      "migrate",
    ]),
    // For "migrate": the new management server base URL.
    data: z.string().optional(),
  })
  .strict();

export const renameSchema = z.object({ displayName: z.string().min(1) }).strict();

export const loginSchema = z
  .object({ username: z.string(), password: z.string() })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
  })
  .strict();

export const jellyfinTestSchema = z
  .object({
    serverUrl: z.string().min(1),
    username: z.string(),
    password: z.string(),
  })
  .strict();

/** Browse the Jellyfin tree (top-level when parentId omitted) for the lock-to-folder picker. */
export const jellyfinBrowseSchema = z
  .object({
    serverUrl: z.string().min(1),
    username: z.string(),
    password: z.string(),
    parentId: z.string().optional(),
  })
  .strict();

/** Resolve a single item id to its name/type (to display what a TV is locked to). */
export const jellyfinResolveSchema = z
  .object({
    serverUrl: z.string().min(1),
    username: z.string(),
    password: z.string(),
    itemId: z.string().min(1),
  })
  .strict();

/* ----------------------- Full server config import ----------------------- */

/** One unit inside an exported server-config snapshot. */
export const serverImportUnitSchema = z
  .object({
    unitId: z.string().min(1),
    displayName: z.string().min(1),
    groupId: z.string().nullable().optional(),
    config: unitConfigSchema,
    configVersion: z.number().int().min(1).optional(),
    registeredAt: z.string().optional(),
    adopted: z.boolean(),
    // Optional: carrying the token lets migrated devices reconnect without re-adoption.
    deviceToken: z.string().nullable().optional(),
  })
  .strict();

/**
 * A full server-config snapshot produced by GET /admin/export. `version` and
 * `exportedAt` are informational; `defaults` + `units` are restored on import.
 */
export const serverImportSchema = z
  .object({
    version: z.number().optional(),
    exportedAt: z.string().optional(),
    defaults: unitConfigSchema,
    units: z.array(serverImportUnitSchema),
  })
  .strict();

export type ServerImport = z.infer<typeof serverImportSchema>;

/** Re-export the editable defaults template for convenience. */
export { DEFAULT_TEMPLATE };

/**
 * Factory: deep-clone a base template into a fresh UnitConfig for a unit.
 * Sets unitId + displayName, resets configVersion to 1 and updatedAt to now.
 * If no base is provided, the built-in DEFAULT_TEMPLATE is used.
 */
export function makeDefaultConfig(
  unitId: string,
  displayName: string,
  base: UnitConfig = DEFAULT_TEMPLATE
): UnitConfig {
  const clone: UnitConfig = JSON.parse(JSON.stringify(base));
  clone.unitId = unitId;
  clone.displayName = displayName;
  clone.configVersion = 1;
  clone.updatedAt = new Date().toISOString();
  return clone;
}
