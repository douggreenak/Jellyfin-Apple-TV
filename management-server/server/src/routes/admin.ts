import { Router, type Request, type Response } from "express";
import {
  getUnitRow,
  listUnitRows,
  insertUnitRow,
  updateUnitRow,
  deleteUnitRow,
  getDefaultsTemplate,
  putDefaultsTemplate,
  type UnitRow,
} from "../db";
import { requireAdmin, adminLogin, changeAdminPassword } from "../auth";
import {
  loginSchema,
  changePasswordSchema,
  unitConfigPatchSchema,
  commandSchema,
  renameSchema,
  jellyfinSchema,
  jellyfinTestSchema,
  jellyfinBrowseSchema,
  jellyfinResolveSchema,
  unitConfigSchema,
  bulkActionSchema,
  serverImportSchema,
} from "../schema";
import type { UnitConfig } from "../schema";
import { testJellyfin, browseJellyfin, resolveJellyfinItem } from "../jellyfin";
import {
  toUnit,
  deepMerge,
  newId,
  emptyStatus,
  type PendingCommand,
} from "../util";

export const adminRouter = Router();

type CommandType = "reload" | "identify" | "restart" | "migrate";

/** Apply the current defaults template to a unit and mark it adopted. Returns the saved row. */
function adoptRow(row: UnitRow): UnitRow {
  const template = getDefaultsTemplate();
  const config: UnitConfig = {
    ...template,
    unitId: row.unitId,
    displayName: row.displayName, // keep the device's own name
    configVersion: row.configVersion + 1,
    updatedAt: new Date().toISOString(),
  };
  const updated: UnitRow = {
    ...row,
    adopted: 1,
    groupId: config.groupId,
    config: JSON.stringify(config),
    configVersion: config.configVersion,
  };
  updateUnitRow(updated);
  return updated;
}

/** Queue a command (optionally with data, e.g. the migrate target URL) on a unit. */
function queueCommand(row: UnitRow, type: CommandType, data?: string): UnitRow {
  const command: PendingCommand = {
    id: newId(),
    type,
    issuedAt: new Date().toISOString(),
    ...(data !== undefined ? { data } : {}),
  };
  const updated: UnitRow = { ...row, pendingCommand: JSON.stringify(command) };
  updateUnitRow(updated);
  return updated;
}

/* -------------------------------- Auth ---------------------------------- */

adminRouter.post("/auth/login", (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  const result = adminLogin(parsed.data.username, parsed.data.password);
  if (!result) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  res.json(result);
});

adminRouter.get("/auth/me", requireAdmin, (req: Request, res: Response) => {
  res.json({ username: req.admin?.username });
});

/**
 * POST /auth/change-password
 * Change the admin password (requires the current one). The new hash is persisted,
 * so it survives restarts. Existing tokens stay valid until they expire.
 */
adminRouter.post(
  "/auth/change-password",
  requireAdmin,
  (req: Request, res: Response) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ ok: false, error: "New password must be at least 8 characters." });
      return;
    }
    const result = changeAdminPassword(
      parsed.data.currentPassword,
      parsed.data.newPassword
    );
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error });
      return;
    }
    res.json({ ok: true });
  }
);

/* -------------------------------- Units --------------------------------- */

adminRouter.get("/units", requireAdmin, (_req: Request, res: Response) => {
  const units = listUnitRows().map(toUnit);
  res.json(units);
});

adminRouter.get("/units/:unitId", requireAdmin, (req: Request, res: Response) => {
  const row = getUnitRow(req.params.unitId);
  if (!row) {
    res.status(404).json({ error: "Unit not found" });
    return;
  }
  res.json(toUnit(row));
});

/**
 * PATCH /units/:unitId/config
 * Deep-partial body deep-merged into config. Bumps configVersion + updatedAt
 * so devices notice via heartbeat. unitId/configVersion/updatedAt are server
 * owned and cannot be set by the caller.
 */
adminRouter.patch(
  "/units/:unitId/config",
  requireAdmin,
  (req: Request, res: Response) => {
    const parsed = unitConfigPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid config patch", details: parsed.error.format() });
      return;
    }
    const row = getUnitRow(req.params.unitId);
    if (!row) {
      res.status(404).json({ error: "Unit not found" });
      return;
    }

    const current = JSON.parse(row.config) as UnitConfig;
    const { displayName: patchDisplayName, ...configPatch } = parsed.data;

    let merged = deepMerge(current, configPatch);
    if (patchDisplayName !== undefined) merged.displayName = patchDisplayName;

    // Server-owned fields.
    merged.unitId = row.unitId;
    merged.configVersion = row.configVersion + 1;
    merged.updatedAt = new Date().toISOString();

    // Validate the fully merged result against the strict config schema.
    const valid = unitConfigSchema.safeParse(merged);
    if (!valid.success) {
      res
        .status(400)
        .json({ error: "Resulting config invalid", details: valid.error.format() });
      return;
    }
    const finalConfig = valid.data;

    const updated: UnitRow = {
      ...row,
      displayName: finalConfig.displayName,
      groupId: finalConfig.groupId,
      config: JSON.stringify(finalConfig),
      configVersion: finalConfig.configVersion,
    };
    updateUnitRow(updated);
    res.json(toUnit(updated));
  }
);

/**
 * POST /units/:unitId/command
 * Sets a pending command with a generated id.
 */
adminRouter.post(
  "/units/:unitId/command",
  requireAdmin,
  (req: Request, res: Response) => {
    const parsed = commandSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid command type" });
      return;
    }
    if (parsed.data.type === "migrate" && !parsed.data.data?.trim()) {
      res.status(400).json({ error: "migrate requires a new server URL in 'data'" });
      return;
    }
    const row = getUnitRow(req.params.unitId);
    if (!row) {
      res.status(404).json({ error: "Unit not found" });
      return;
    }
    res.json(toUnit(queueCommand(row, parsed.data.type, parsed.data.data)));
  }
);

/**
 * POST /units/:unitId/rename
 * Renames the unit. Mirrors displayName into config + bumps configVersion so
 * the device picks up the new name.
 */
adminRouter.post(
  "/units/:unitId/rename",
  requireAdmin,
  (req: Request, res: Response) => {
    const parsed = renameSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid displayName" });
      return;
    }
    const row = getUnitRow(req.params.unitId);
    if (!row) {
      res.status(404).json({ error: "Unit not found" });
      return;
    }
    const config = JSON.parse(row.config) as UnitConfig;
    config.displayName = parsed.data.displayName;
    config.configVersion = row.configVersion + 1;
    config.updatedAt = new Date().toISOString();

    const updated: UnitRow = {
      ...row,
      displayName: parsed.data.displayName,
      config: JSON.stringify(config),
      configVersion: config.configVersion,
    };
    updateUnitRow(updated);
    res.json(toUnit(updated));
  }
);

/**
 * POST /units/:unitId/adopt
 * Accepts a newly-connected unit: applies the current defaults template (so it
 * receives the shared Jellyfin account + default appearance), bumps configVersion
 * so the device picks it up, and marks it adopted.
 */
adminRouter.post(
  "/units/:unitId/adopt",
  requireAdmin,
  (req: Request, res: Response) => {
    const row = getUnitRow(req.params.unitId);
    if (!row) {
      res.status(404).json({ error: "Unit not found" });
      return;
    }
    res.json(toUnit(adoptRow(row)));
  }
);

/**
 * POST /units/bulk
 * Apply an action to many units at once (fleet management). For action="migrate",
 * `data` is the new management server base URL pushed to each device.
 */
adminRouter.post("/units/bulk", requireAdmin, (req: Request, res: Response) => {
  const parsed = bulkActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid bulk request", details: parsed.error.format() });
    return;
  }
  const { unitIds, action, data } = parsed.data;
  if (action === "migrate" && !data?.trim()) {
    res.status(400).json({ error: "migrate requires a new server URL in 'data'" });
    return;
  }
  let affected = 0;
  for (const unitId of unitIds) {
    const row = getUnitRow(unitId);
    if (!row) continue;
    switch (action) {
      case "delete":
        if (deleteUnitRow(unitId)) affected++;
        break;
      case "adopt":
        adoptRow(row);
        affected++;
        break;
      case "unadopt":
        updateUnitRow({ ...row, adopted: 0 });
        affected++;
        break;
      default: // reload | identify | restart | migrate
        queueCommand(row, action, action === "migrate" ? data : undefined);
        affected++;
    }
  }
  res.json({ ok: true, affected });
});

/**
 * POST /units/push-jellyfin
 * Fleet-wide: apply this Jellyfin server/account to EVERY unit's config (only the
 * `jellyfin` section — per-unit appearance/browse/etc. are preserved), bumping each
 * configVersion so devices switch servers on their next heartbeat. Used by the
 * "push this server to all TVs" button on the Defaults → Jellyfin tab.
 */
adminRouter.post(
  "/units/push-jellyfin",
  requireAdmin,
  (req: Request, res: Response) => {
    const parsed = jellyfinSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "Invalid Jellyfin config" });
      return;
    }
    const jellyfin = parsed.data;
    let affected = 0;
    for (const row of listUnitRows()) {
      const current = JSON.parse(row.config) as UnitConfig;
      const merged: UnitConfig = {
        ...current,
        jellyfin,
        configVersion: row.configVersion + 1,
        updatedAt: new Date().toISOString(),
      };
      const valid = unitConfigSchema.safeParse(merged);
      if (!valid.success) continue;
      updateUnitRow({
        ...row,
        config: JSON.stringify(valid.data),
        configVersion: valid.data.configVersion,
      });
      affected++;
    }
    res.json({ ok: true, affected });
  }
);

/**
 * POST /units/:unitId/unadopt
 * Returns a unit to the "ready to adopt" list (leaves its config untouched).
 */
adminRouter.post(
  "/units/:unitId/unadopt",
  requireAdmin,
  (req: Request, res: Response) => {
    const row = getUnitRow(req.params.unitId);
    if (!row) {
      res.status(404).json({ error: "Unit not found" });
      return;
    }
    const updated: UnitRow = { ...row, adopted: 0 };
    updateUnitRow(updated);
    res.json(toUnit(updated));
  }
);

adminRouter.delete(
  "/units/:unitId",
  requireAdmin,
  (req: Request, res: Response) => {
    const ok = deleteUnitRow(req.params.unitId);
    if (!ok) {
      res.status(404).json({ error: "Unit not found" });
      return;
    }
    res.json({ ok: true });
  }
);

/* ------------------------------- Defaults ------------------------------- */

adminRouter.get("/defaults", requireAdmin, (_req: Request, res: Response) => {
  res.json(getDefaultsTemplate());
});

adminRouter.put("/defaults", requireAdmin, (req: Request, res: Response) => {
  const parsed = unitConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid template", details: parsed.error.format() });
    return;
  }
  // Keep updatedAt fresh; template is a blueprint so configVersion stays as-is.
  const template: UnitConfig = {
    ...parsed.data,
    updatedAt: new Date().toISOString(),
  };
  putDefaultsTemplate(template);
  res.json(template);
});

/* ---------------------------- Export / Import ---------------------------- */

/**
 * GET /export
 * A full server-config snapshot: the defaults template plus every unit's config,
 * adoption state, and device token. Lets an operator back up the fleet or seed a
 * replacement server. Live status/telemetry is intentionally omitted.
 */
adminRouter.get("/export", requireAdmin, (_req: Request, res: Response) => {
  // The snapshot contains plaintext Jellyfin credentials and per-device tokens.
  // It's admin-authed; also tell browsers/proxies not to cache the secrets bundle.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Disposition", 'attachment; filename="jellyfin-fleet-config.json"');
  const defaults = getDefaultsTemplate();
  const units = listUnitRows().map((row) => ({
    unitId: row.unitId,
    displayName: row.displayName,
    groupId: row.groupId,
    config: JSON.parse(row.config) as UnitConfig,
    configVersion: row.configVersion,
    registeredAt: row.registeredAt,
    adopted: row.adopted === 1,
    deviceToken: row.deviceToken,
  }));
  res.json({ version: 1, exportedAt: new Date().toISOString(), defaults, units });
});

/**
 * POST /import?replace=true
 * Restore a snapshot from GET /export: replaces the defaults template and upserts
 * every unit. With ?replace=true, units not present in the snapshot are deleted
 * (full restore); otherwise existing extra units are left untouched (merge). Live
 * status is preserved for units that already exist.
 */
adminRouter.post("/import", requireAdmin, (req: Request, res: Response) => {
  const parsed = serverImportSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid config file", details: parsed.error.format() });
    return;
  }
  const replace = req.query.replace === "true" || req.query.replace === "1";
  const { defaults, units } = parsed.data;

  putDefaultsTemplate({ ...defaults, updatedAt: new Date().toISOString() });

  const now = new Date().toISOString();
  const incoming = new Set(units.map((u) => u.unitId));
  let imported = 0;
  let removed = 0;

  for (const u of units) {
    const existing = getUnitRow(u.unitId);
    // Keep the `configVersion` column and the config body's internal version in
    // lockstep (every other write path does), so the device's heartbeat-vs-stored
    // comparison can't get wedged into re-fetching forever.
    const version = u.configVersion ?? u.config.configVersion ?? 1;
    const config: UnitConfig = { ...u.config, unitId: u.unitId, configVersion: version };
    const row: UnitRow = {
      unitId: u.unitId,
      displayName: u.displayName,
      groupId: u.groupId ?? config.groupId ?? null,
      config: JSON.stringify(config),
      status: existing ? existing.status : JSON.stringify(emptyStatus()),
      pendingCommand: existing ? existing.pendingCommand : null,
      deviceToken: u.deviceToken ?? existing?.deviceToken ?? null,
      configVersion: version,
      registeredAt: u.registeredAt ?? existing?.registeredAt ?? now,
      adopted: u.adopted ? 1 : 0,
    };
    if (existing) updateUnitRow(row);
    else insertUnitRow(row);
    imported++;
  }

  if (replace) {
    for (const row of listUnitRows()) {
      if (!incoming.has(row.unitId) && deleteUnitRow(row.unitId)) removed++;
    }
  }

  res.json({ ok: true, imported, removed });
});

/* ------------------------------- Jellyfin ------------------------------- */

adminRouter.post(
  "/jellyfin/test",
  requireAdmin,
  async (req: Request, res: Response) => {
    const parsed = jellyfinTestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "Invalid body" });
      return;
    }
    const result = await testJellyfin(parsed.data);
    res.json(result);
  }
);

/**
 * POST /jellyfin/children
 * List the children of a folder (or top-level libraries when no parentId), used
 * by the admin's "lock to a library/folder" picker to drill the Jellyfin tree.
 */
adminRouter.post(
  "/jellyfin/children",
  requireAdmin,
  async (req: Request, res: Response) => {
    const parsed = jellyfinBrowseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "Invalid body" });
      return;
    }
    const { parentId, ...creds } = parsed.data;
    res.json(await browseJellyfin(creds, parentId));
  }
);

/**
 * POST /jellyfin/resolve
 * Resolve a single item id to its name/type, so the admin can show which folder a
 * TV is locked to (the id alone is meaningless to an operator).
 */
adminRouter.post(
  "/jellyfin/resolve",
  requireAdmin,
  async (req: Request, res: Response) => {
    const parsed = jellyfinResolveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "Invalid body" });
      return;
    }
    const { itemId, ...creds } = parsed.data;
    res.json(await resolveJellyfinItem(creds, itemId));
  }
);
