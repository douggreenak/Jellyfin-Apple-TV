import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getUnitRow, getSetting, putSetting } from "./db";

/**
 * Admin + device authentication.
 *
 * Admin: single account. The password starts from ADMIN_PASSWORD in .env (hashed
 * once at boot), but once an admin changes it from the dashboard the new hash is
 * persisted in the DB and takes precedence over the env value on every later boot.
 * Device: X-Unit-Id + X-Unit-Token compared against the stored deviceToken.
 */

interface AdminConfig {
  username: string;
  passwordHash: string;
  jwtSecret: string;
}

let adminConfig: AdminConfig | null = null;

/** Settings-table key holding the (bcrypt) admin password hash once changed. */
const ADMIN_PASSWORD_HASH_KEY = "adminPasswordHash";

export function initAuth(opts: {
  username: string;
  password: string;
  jwtSecret: string;
}): void {
  // A password set from the dashboard (stored hash) wins over the env password,
  // so changes survive restarts even though .env still has the original value.
  const storedHash = getSetting(ADMIN_PASSWORD_HASH_KEY);
  const passwordHash = storedHash ?? bcrypt.hashSync(opts.password, 10);
  adminConfig = {
    username: opts.username,
    passwordHash,
    jwtSecret: opts.jwtSecret,
  };
}

/**
 * Change the admin password: verify the current one, then hash + persist the new
 * one (in memory and in the DB). Returns an error string on failure.
 */
export function changeAdminPassword(
  currentPassword: string,
  newPassword: string
): { ok: true } | { ok: false; error: string } {
  const c = cfg();
  if (!bcrypt.compareSync(currentPassword, c.passwordHash)) {
    return { ok: false, error: "Current password is incorrect." };
  }
  const newHash = bcrypt.hashSync(newPassword, 10);
  c.passwordHash = newHash;
  putSetting(ADMIN_PASSWORD_HASH_KEY, newHash);
  return { ok: true };
}

function cfg(): AdminConfig {
  if (!adminConfig) throw new Error("Auth not initialized. Call initAuth().");
  return adminConfig;
}

export interface AdminLoginResult {
  token: string;
  expiresAt: string;
}

const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12 hours

/** Validate credentials and issue a JWT. Returns null on failure. */
export function adminLogin(
  username: string,
  password: string
): AdminLoginResult | null {
  const c = cfg();
  const userOk = username === c.username;
  // Always run a bcrypt compare to keep timing roughly uniform.
  const passOk = bcrypt.compareSync(password, c.passwordHash);
  if (!userOk || !passOk) return null;
  return signJwt(username);
}

export function signJwt(username: string): AdminLoginResult {
  const c = cfg();
  const token = jwt.sign({ sub: username }, c.jwtSecret, {
    expiresIn: TOKEN_TTL_SECONDS,
  });
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString();
  return { token, expiresAt };
}

export interface AdminAuth {
  username: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AdminAuth;
      unitId?: string;
    }
  }
}

/** Require a valid admin Bearer JWT. */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const header = req.header("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }
  try {
    const payload = jwt.verify(match[1], cfg().jwtSecret) as jwt.JwtPayload;
    req.admin = { username: String(payload.sub ?? "") };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/** Require valid device headers matching a stored deviceToken. */
export function requireDevice(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const unitId = req.header("x-unit-id");
  const token = req.header("x-unit-token");
  if (!unitId || !token) {
    res.status(401).json({ error: "Missing X-Unit-Id or X-Unit-Token" });
    return;
  }
  const row = getUnitRow(unitId);
  if (!row || !row.deviceToken || row.deviceToken !== token) {
    res.status(401).json({ error: "Invalid device credentials" });
    return;
  }
  req.unitId = unitId;
  next();
}
