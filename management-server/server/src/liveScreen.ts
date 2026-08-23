/**
 * Ephemeral, in-memory-only state for the live screen mirror. Deliberately NOT
 * persisted to SQLite: this is a "what does it look like right now" feature, not
 * an archive — a server restart just means a dashboard operator re-opens the
 * panel and the device picks a screen-share session back up within a few seconds.
 *
 * Two pieces of state per unit:
 *  - a short-lived "someone is watching" flag, refreshed by the admin dashboard
 *    while its Remote & Screen panel is open (`keepAlive`/`isLive`)
 *  - the latest uploaded screenshot frame (`storeFrame`/`getFrame`), overwritten
 *    on every upload — only the most recent frame is ever kept.
 */

const LIVE_TTL_MS = 10_000;

const liveUntil = new Map<string, number>();

/** Mark a unit as actively being watched for the next LIVE_TTL_MS. */
export function keepAlive(unitId: string): void {
  liveUntil.set(unitId, Date.now() + LIVE_TTL_MS);
}

/** Whether a unit currently has a dashboard operator watching its screen. */
export function isLive(unitId: string): boolean {
  const until = liveUntil.get(unitId);
  return until !== undefined && until > Date.now();
}

export interface ScreenFrame {
  buf: Buffer;
  mime: string;
  capturedAt: number;
}

const frames = new Map<string, ScreenFrame>();

/** Store the latest captured screenshot for a unit, replacing any previous frame. */
export function storeFrame(unitId: string, buf: Buffer, mime: string): void {
  frames.set(unitId, { buf, mime, capturedAt: Date.now() });
}

/** The most recently uploaded screenshot for a unit, if any. */
export function getFrame(unitId: string): ScreenFrame | undefined {
  return frames.get(unitId);
}
