import { Router, type Request, type Response } from "express";
import {
  getUnitRow,
  insertUnitRow,
  updateUnitRow,
  getDefaultsTemplate,
  type UnitRow,
} from "../db";
import { requireDevice } from "../auth";
import { makeDefaultConfig } from "../schema";
import {
  registerSchema,
  heartbeatSchema,
  ackSchema,
  unitConfigSchema,
} from "../schema";
import type { UnitConfig } from "../schema";
import {
  toUnit,
  newToken,
  deepMerge,
  emptyStatus,
  type UnitStatus,
  type PendingCommand,
} from "../util";

export const devicesRouter = Router();

/**
 * POST /devices/register
 * Idempotent on unitId. New unit -> deep-clone defaults template, set
 * unitId+displayName(deviceName). Re-register -> keep config, refresh status,
 * keep existing token (or issue one if somehow missing). Always returns a token.
 */
devicesRouter.post("/register", (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.format() });
    return;
  }
  const { unitId, deviceName, model, tvosVersion, appVersion } = parsed.data;
  const now = new Date().toISOString();

  const existing = getUnitRow(unitId);
  if (existing) {
    // Idempotent re-register: keep config, refresh telemetry, ensure a token.
    const status = JSON.parse(existing.status) as UnitStatus;
    status.lastSeenAt = now;
    if (model !== undefined) status.model = model;
    if (tvosVersion !== undefined) status.tvosVersion = tvosVersion;
    if (appVersion !== undefined) status.appVersion = appVersion;

    const token = existing.deviceToken ?? newToken();
    const updated: UnitRow = {
      ...existing,
      status: JSON.stringify(status),
      deviceToken: token,
    };
    updateUnitRow(updated);
    res.json({ unit: toUnit(updated), token });
    return;
  }

  // New unit from the editable defaults template.
  const config = makeDefaultConfig(unitId, deviceName, getDefaultsTemplate());
  const status = emptyStatus();
  status.lastSeenAt = now;
  status.model = model ?? null;
  status.tvosVersion = tvosVersion ?? null;
  status.appVersion = appVersion ?? null;

  const token = newToken();
  const row: UnitRow = {
    unitId,
    displayName: deviceName,
    groupId: config.groupId,
    config: JSON.stringify(config),
    status: JSON.stringify(status),
    pendingCommand: null,
    deviceToken: token,
    configVersion: config.configVersion,
    registeredAt: now,
    adopted: 0, // newly registered units are pending adoption
  };
  insertUnitRow(row);
  res.status(201).json({ unit: toUnit(row), token });
});

/**
 * GET /devices/:unitId/config
 * Requires valid device token. Supports ETag via configVersion -> 304.
 */
devicesRouter.get(
  "/:unitId/config",
  requireDevice,
  (req: Request, res: Response) => {
    if (req.unitId !== req.params.unitId) {
      res.status(403).json({ error: "Token does not match unitId" });
      return;
    }
    const row = getUnitRow(req.params.unitId);
    if (!row) {
      res.status(404).json({ error: "Unit not found" });
      return;
    }
    const etag = `"${row.configVersion}"`;
    res.setHeader("ETag", etag);

    const ifNoneMatch = req.header("if-none-match");
    if (ifNoneMatch && ifNoneMatch.trim() === etag) {
      res.status(304).end();
      return;
    }
    res.json(JSON.parse(row.config));
  }
);

/**
 * PUT /devices/:unitId/config
 * Lets a unit save an on-device settings edit back to the server. The body is a
 * full UnitConfig; it is merged over the current config, server-owned fields are
 * enforced, configVersion is bumped, and the resulting UnitConfig is returned.
 */
devicesRouter.put(
  "/:unitId/config",
  requireDevice,
  (req: Request, res: Response) => {
    if (req.unitId !== req.params.unitId) {
      res.status(403).json({ error: "Token does not match unitId" });
      return;
    }
    const row = getUnitRow(req.params.unitId);
    if (!row) {
      res.status(404).json({ error: "Unit not found" });
      return;
    }

    const current = JSON.parse(row.config) as UnitConfig;
    let merged = deepMerge(current, req.body ?? {});

    // Server-owned fields cannot be set by the device.
    merged.unitId = row.unitId;
    merged.configVersion = row.configVersion + 1;
    merged.updatedAt = new Date().toISOString();

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
    res.json(finalConfig);
  }
);

/**
 * POST /devices/:unitId/heartbeat
 * Updates lastSeenAt and merges reported status fields. Returns the current
 * configVersion and any pending command.
 */
devicesRouter.post(
  "/:unitId/heartbeat",
  requireDevice,
  (req: Request, res: Response) => {
    if (req.unitId !== req.params.unitId) {
      res.status(403).json({ error: "Token does not match unitId" });
      return;
    }
    const parsed = heartbeatSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid body", details: parsed.error.format() });
      return;
    }
    const row = getUnitRow(req.params.unitId);
    if (!row) {
      res.status(404).json({ error: "Unit not found" });
      return;
    }

    const status = JSON.parse(row.status) as UnitStatus;
    status.lastSeenAt = new Date().toISOString();
    if (parsed.data.ipAddress !== undefined) status.ipAddress = parsed.data.ipAddress;
    if (parsed.data.nowPlaying !== undefined)
      status.nowPlaying = parsed.data.nowPlaying as Record<string, unknown> | null;
    // A device reports its current health each heartbeat; an empty/null value
    // means "healthy now", which clears any previously stored error.
    if (parsed.data.lastError !== undefined)
      status.lastError = parsed.data.lastError ? parsed.data.lastError : null;

    const updated: UnitRow = { ...row, status: JSON.stringify(status) };
    updateUnitRow(updated);

    const command: PendingCommand | null = row.pendingCommand
      ? (JSON.parse(row.pendingCommand) as PendingCommand)
      : null;

    res.json({ ok: true, configVersion: row.configVersion, command });
  }
);

/**
 * POST /devices/:unitId/ack
 * Clears the pending command if its id matches.
 */
devicesRouter.post(
  "/:unitId/ack",
  requireDevice,
  (req: Request, res: Response) => {
    if (req.unitId !== req.params.unitId) {
      res.status(403).json({ error: "Token does not match unitId" });
      return;
    }
    const parsed = ackSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid body", details: parsed.error.format() });
      return;
    }
    const row = getUnitRow(req.params.unitId);
    if (!row) {
      res.status(404).json({ error: "Unit not found" });
      return;
    }
    const pending: PendingCommand | null = row.pendingCommand
      ? (JSON.parse(row.pendingCommand) as PendingCommand)
      : null;
    if (pending && pending.id === parsed.data.commandId) {
      updateUnitRow({ ...row, pendingCommand: null });
    }
    res.json({ ok: true });
  }
);
