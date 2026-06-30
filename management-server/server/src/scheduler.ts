/**
 * Power scheduler: every ~20s, fires any enabled schedule whose time + weekday
 * match "now" (server local time), powering its target devices on/off via pyatv.
 * Each schedule fires at most once per minute (deduped by a minute key).
 */
import {
  listSchedules,
  putSchedule,
  listUnitRows,
  getUnitPower,
  type PowerSchedule,
  type UnitRow,
} from "./db";
import { setAtvPower } from "./atv";

let timer: NodeJS.Timeout | null = null;
const firedAt = new Map<string, string>(); // scheduleId -> minute key already fired

/** Units a schedule applies to (adopted units matching its target). */
function targetRows(s: PowerSchedule): UnitRow[] {
  const adopted = listUnitRows().filter((r) => r.adopted === 1);
  if (s.targetType === "all") return adopted;
  if (s.targetType === "group") return adopted.filter((r) => r.groupId === s.targetValue);
  return adopted.filter((r) => r.unitId === s.targetValue); // "unit"
}

/** Execute a schedule now and record the outcome on it. Returns a summary string. */
export async function runSchedule(s: PowerSchedule): Promise<string> {
  const rows = targetRows(s);
  let ok = 0;
  let failed = 0;
  let notPaired = 0;
  for (const row of rows) {
    const power = getUnitPower(row.unitId);
    if (!power) {
      notPaired++;
      continue;
    }
    const r = await setAtvPower(power.atvId, power.credentials, s.action === "on");
    if (r.ok) ok++;
    else failed++;
  }
  const verb = s.action === "on" ? "Turned on" : "Slept";
  const parts = [`${verb} ${ok}/${rows.length}`];
  if (failed) parts.push(`${failed} failed`);
  if (notPaired) parts.push(`${notPaired} not paired`);
  const result = parts.join(", ");
  putSchedule({ ...s, lastRun: new Date().toISOString(), lastResult: result });
  console.log(`[schedule] "${s.name || s.id}": ${result}`);
  return result;
}

async function tick(): Promise<void> {
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const day = now.getDay();
  const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}T${hm}`;

  for (const s of listSchedules()) {
    if (!s.enabled) continue;
    if (s.time !== hm) continue;
    if (!s.days.includes(day)) continue;
    if (firedAt.get(s.id) === minuteKey) continue;
    firedAt.set(s.id, minuteKey);
    try {
      await runSchedule(s);
    } catch (err) {
      console.error(`[schedule] "${s.name || s.id}" failed:`, err);
    }
  }
}

export function startScheduler(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), 20_000);
  void tick();
}
