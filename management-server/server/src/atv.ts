/**
 * Remote Apple TV power control via pyatv's `atvremote` CLI.
 *
 * Apple TVs can't be powered on/off by an app — only over the network via Apple's
 * Companion protocol. pyatv implements it: `turn_on` wakes the TV, `turn_off` puts
 * it to sleep (Apple TVs have no true hard-off). Each TV must be paired once on the
 * server box to obtain Companion credentials:
 *
 *   atvremote --id <AppleTV-identifier> --protocol companion pair
 *
 * The resulting credentials string + the device identifier are stored per unit and
 * used here. pyatv must be installed on the server (`pipx install pyatv`); override
 * the binary path with ATVREMOTE_BIN if needed.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

const ATV_BIN = process.env.ATVREMOTE_BIN ?? "atvremote";
const ATVSCRIPT_BIN = process.env.ATVSCRIPT_BIN ?? "atvscript";
const TIMEOUT_MS = 25_000;

interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  notFound: boolean; // the atvremote binary isn't installed
}

function run(args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(ATV_BIN, args, { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        resolve({ ok: false, stdout: "", stderr: "", notFound: true });
        return;
      }
      resolve({ ok: !err, stdout: stdout ?? "", stderr: stderr ?? "", notFound: false });
    });
  });
}

let availableCache: boolean | null = null;

/** Whether pyatv's `atvremote` is installed on the server (cached after first check). */
export async function atvAvailable(): Promise<boolean> {
  if (availableCache !== null) return availableCache;
  const r = await run(["--version"]);
  availableCache = !r.notFound;
  return availableCache;
}

export interface PowerResult {
  ok: boolean;
  error?: string;
}

/** Wake (`on`) or sleep (`off`) a paired Apple TV. */
export async function setAtvPower(
  atvId: string,
  credentials: string,
  on: boolean
): Promise<PowerResult> {
  if (!atvId || !credentials) {
    return { ok: false, error: "This unit isn't paired for power control yet." };
  }
  const r = await run([
    "--id",
    atvId,
    "--companion-credentials",
    credentials,
    on ? "turn_on" : "turn_off",
  ]);
  if (r.notFound) {
    return {
      ok: false,
      error: "pyatv (atvremote) is not installed on the management server.",
    };
  }
  if (!r.ok) {
    const last = (r.stderr || r.stdout || "").trim().split("\n").filter(Boolean).pop();
    return { ok: false, error: last || "Power command failed (could not reach the Apple TV)." };
  }
  return { ok: true };
}

/* ------------------------- Discovery + pairing ----------------------------- */

export interface AtvDevice {
  identifier: string;
  name: string;
  address: string;
}

/** Discover Apple TVs on the local network (via `atvscript scan`, JSON output). */
export async function scanAtv(): Promise<{ ok: boolean; devices?: AtvDevice[]; error?: string }> {
  return new Promise((resolve) => {
    execFile(
      ATVSCRIPT_BIN,
      ["scan"],
      { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
          resolve({ ok: false, error: "pyatv (atvscript) is not installed on the server." });
          return;
        }
        const text = (stdout || "").trim();
        try {
          // atvscript emits one JSON object; tolerate trailing/leading lines.
          const line = text.split("\n").find((l) => l.trim().startsWith("{")) ?? text;
          const data = JSON.parse(line);
          const devices: AtvDevice[] = (data.devices ?? [])
            .map((d: Record<string, unknown>) => ({
              identifier: String(d.identifier ?? ""),
              name: String(d.name ?? "Apple TV"),
              address: String(d.address ?? ""),
            }))
            .filter((d: AtvDevice) => d.identifier);
          resolve({ ok: true, devices });
        } catch {
          resolve({ ok: false, error: (stderr || text || "Scan failed.").trim().split("\n").pop() });
        }
      }
    );
  });
}

/**
 * Interactive Companion pairing, driven from the browser:
 *  - beginPairing(atvId) spawns `atvremote ... pair` (the TV shows a PIN) and keeps
 *    the process alive, keyed by a pairingId.
 *  - finishPairing(pairingId, pin) feeds the PIN, waits for completion, and returns
 *    the credentials parsed from the output.
 * Sessions self-expire after 2 minutes.
 */
interface PairSession {
  child: ChildProcess;
  atvId: string;
  out: string;
  timer: NodeJS.Timeout;
}
const sessions = new Map<string, PairSession>();
const PAIR_TIMEOUT_MS = 120_000;

export function beginPairing(atvId: string): { ok: boolean; pairingId?: string; error?: string } {
  if (!atvId) return { ok: false, error: "Missing Apple TV identifier." };
  let child: ChildProcess;
  try {
    child = spawn(ATV_BIN, ["--id", atvId, "--protocol", "companion", "pair"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    return { ok: false, error: "Could not start pairing." };
  }
  const pairingId = randomUUID();
  const session: PairSession = {
    child,
    atvId,
    out: "",
    timer: setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      sessions.delete(pairingId);
    }, PAIR_TIMEOUT_MS),
  };
  child.stdout?.on("data", (d) => (session.out += d.toString()));
  child.stderr?.on("data", (d) => (session.out += d.toString()));
  child.on("error", () => {
    /* surfaced on finish */
  });
  sessions.set(pairingId, session);
  return { ok: true, pairingId };
}

/** Extract the credentials token from atvremote's pairing output (version-tolerant). */
function parseCredentials(out: string): string | null {
  for (const line of out.split("\n")) {
    const m = line.match(/credential[s]?[:=\s]+(\S+)/i);
    if (m && m[1].length >= 16) return m[1];
  }
  const tokens = out
    .split(/\s+/)
    .filter((t) => t.length >= 40 && /^[A-Za-z0-9:_+/=-]+$/.test(t));
  return tokens.length ? tokens[tokens.length - 1] : null;
}

export function finishPairing(
  pairingId: string,
  pin: string
): Promise<{ ok: boolean; atvId?: string; credentials?: string; error?: string }> {
  const s = sessions.get(pairingId);
  if (!s) return Promise.resolve({ ok: false, error: "Pairing session expired — start again." });
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: { ok: boolean; atvId?: string; credentials?: string; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(s.timer);
      sessions.delete(pairingId);
      resolve(r);
    };
    s.child.on("close", () => {
      const creds = parseCredentials(s.out);
      if (creds) done({ ok: true, atvId: s.atvId, credentials: creds });
      else
        done({
          ok: false,
          error:
            s.out.trim().split("\n").filter(Boolean).pop() ||
            "Pairing failed — check the PIN and try again.",
        });
    });
    s.child.on("error", () =>
      done({ ok: false, error: "pyatv (atvremote) is not installed on the server." })
    );
    try {
      s.child.stdin?.write(`${pin.trim()}\n`);
    } catch {
      done({ ok: false, error: "Could not send the PIN to the pairing process." });
    }
  });
}

export function cancelPairing(pairingId: string): void {
  const s = sessions.get(pairingId);
  if (!s) return;
  clearTimeout(s.timer);
  try {
    s.child.kill();
  } catch {
    /* ignore */
  }
  sessions.delete(pairingId);
}
