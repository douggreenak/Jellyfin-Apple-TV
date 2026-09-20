import { Router, type Request, type Response } from "express";
import express from "express";
import {
  getUnitRow,
  insertUnitRow,
  updateUnitRow,
  getDefaultsTemplate,
  insertPlaybackEvent,
  type UnitRow,
} from "../db";
import { requireDevice } from "../auth";
import { makeDefaultConfig } from "../schema";
import {
  registerSchema,
  heartbeatSchema,
  ackSchema,
  unitConfigSchema,
  playbackReportSchema,
} from "../schema";
import type { UnitConfig } from "../schema";
import {
  toUnit,
  newToken,
  newId,
  deepMerge,
  emptyStatus,
  type UnitStatus,
  type PendingCommand,
} from "../util";
import { isLive, storeFrame } from "../liveScreen";
import { SERVER_VERSION } from "../serverVersion";

export const devicesRouter = Router();

/**
 * Exactly what UIDevice.current.name returns to a third-party tvOS app
 * without Apple's gated user-assigned-device-name entitlement — every unit
 * registers with this as its seed displayName. Used as the "has this unit
 * ever been given a real name" check for heartbeat's localName auto-adopt:
 * an exact match means it hasn't, so it's always safe to overwrite.
 */
const GENERIC_DEVICE_NAME = "Apple TV";

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
    // A unit keeps its device token across an app update (pushed via MDM), so it
    // never re-registers — appVersion is refreshed here on every heartbeat instead
    // of only at register, or the server's view of it would go stale forever.
    if (parsed.data.appVersion !== undefined) status.appVersion = parsed.data.appVersion;
    // Same reasoning: a tvOS software update can land between registers too.
    if (parsed.data.tvosVersion !== undefined) status.tvosVersion = parsed.data.tvosVersion;
    // The device itself clears identify state when the user dismisses the
    // overlay with the physical remote — see UnitStatus.identifying's doc
    // comment. Only ever sent `true`; there's nothing to do on its absence.
    if (parsed.data.identifyDismissed) status.identifying = false;

    // localName is the unit's real name, recovered client-side over Bonjour
    // (UIDevice.current.name is gated by Apple and just says "Apple TV" — see
    // DeviceIdentity.swift / LocalDeviceNameResolver.swift). Always recorded as
    // telemetry; auto-adopted into the operator-facing displayName only while
    // that's still the exact generic placeholder every unit registers with, so
    // an admin who has already renamed a unit never gets overwritten.
    let displayName = row.displayName;
    if (parsed.data.localName) {
      status.localNetworkName = parsed.data.localName;
      if (displayName === GENERIC_DEVICE_NAME) displayName = parsed.data.localName;
    }

    const updated: UnitRow = { ...row, displayName, status: JSON.stringify(status) };
    updateUnitRow(updated);

    const command: PendingCommand | null = row.pendingCommand
      ? (JSON.parse(row.pendingCommand) as PendingCommand)
      : null;

    res.json({
      ok: true,
      configVersion: row.configVersion,
      command,
      identifying: status.identifying ?? false,
      serverVersion: SERVER_VERSION,
    });
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

/**
 * GET /devices/:unitId/live
 * Cheap, frequent poll (every few seconds) telling the device whether a dashboard
 * operator currently has this unit's screen mirror open. Only while true should
 * the device incur the cost of capturing and uploading screenshots.
 */
devicesRouter.get(
  "/:unitId/live",
  requireDevice,
  (req: Request, res: Response) => {
    if (req.unitId !== req.params.unitId) {
      res.status(403).json({ error: "Token does not match unitId" });
      return;
    }
    res.json({ screenShare: isLive(req.params.unitId) });
  }
);

/**
 * POST /devices/:unitId/screenshot
 * Raw JPEG body (not JSON) — a captured frame of the device's own screen, kept
 * in memory only and overwriting any previous frame. Body parser is scoped to
 * this route alone so the global 1mb JSON limit is untouched.
 */
devicesRouter.post(
  "/:unitId/screenshot",
  requireDevice,
  express.raw({ type: "image/jpeg", limit: "1mb" }),
  (req: Request, res: Response) => {
    if (req.unitId !== req.params.unitId) {
      res.status(403).json({ error: "Token does not match unitId" });
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Expected a non-empty image/jpeg body" });
      return;
    }
    storeFrame(req.params.unitId, req.body, "image/jpeg");
    res.json({ ok: true });
  }
);

/**
 * GET /devices/:unitId/speedtest
 * A fixed-size payload the device downloads and times itself, to measure real
 * throughput to this server. Exists because tvOS gives third-party apps no way
 * to read actual Wi-Fi link speed or signal strength (that needs Apple's
 * `com.apple.developer.networking.wifi-info` entitlement, which must be
 * requested from Apple and still wouldn't expose a real Mbps figure) — an
 * actual measured transfer is the only number this app can produce without
 * that entitlement, and arguably more useful anyway: it reflects real usable
 * bandwidth to the server a unit actually talks to, not raw PHY rate. Sized at
 * 4 MB — big enough to smooth out connection-setup overhead on a LAN, small
 * enough to finish in well under a second on anything reasonable. The buffer
 * is precomputed once at module load, not per-request.
 */
const SPEEDTEST_PAYLOAD = Buffer.alloc(4 * 1024 * 1024);
devicesRouter.get(
  "/:unitId/speedtest",
  requireDevice,
  (req: Request, res: Response) => {
    if (req.unitId !== req.params.unitId) {
      res.status(403).json({ error: "Token does not match unitId" });
      return;
    }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.send(SPEEDTEST_PAYLOAD);
  }
);

/**
 * POST /devices/:unitId/playback-report
 * A playback session's quality summary (see PlaybackEventRow's doc comment),
 * sent once when a video stops. Best-effort on the device side — a failed
 * report just means one missing data point for the admin Data tab, nothing
 * the device should retry or block on.
 */
devicesRouter.post(
  "/:unitId/playback-report",
  requireDevice,
  (req: Request, res: Response) => {
    if (req.unitId !== req.params.unitId) {
      res.status(403).json({ error: "Token does not match unitId" });
      return;
    }
    const parsed = playbackReportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.format() });
      return;
    }
    if (!getUnitRow(req.params.unitId)) {
      res.status(404).json({ error: "Unit not found" });
      return;
    }
    insertPlaybackEvent({
      id: newId(),
      unitId: req.params.unitId,
      itemId: parsed.data.itemId ?? null,
      itemName: parsed.data.itemName ?? null,
      recordedAt: new Date().toISOString(),
      durationSeconds: parsed.data.durationSeconds,
      avgBitrateKbps: parsed.data.avgBitrateKbps ?? null,
      indicatedBitrateKbps: parsed.data.indicatedBitrateKbps ?? null,
      droppedFrames: parsed.data.droppedFrames ?? null,
      stalls: parsed.data.stalls ?? null,
      width: parsed.data.width ?? null,
      height: parsed.data.height ?? null,
    });
    res.json({ ok: true });
  }
);
