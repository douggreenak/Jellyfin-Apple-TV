import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getUnitRow } from "./db";

/**
 * Admin + device authentication.
 *
 * Admin: single account from env. ADMIN_PASSWORD may be plaintext in .env;
 * we hash it once at boot and compare with bcrypt so the codepath is uniform.
 * Device: X-Unit-Id + X-Unit-Token compared against the stored deviceToken.
 */

interface AdminConfig {
  username: string;
  passwordHash: string;
  jwtSecret: string;
}

let adminConfig: AdminConfig | null = null;

export function initAuth(opts: {
  username: string;
  password: string;
  jwtSecret: string;
}): void {
  const passwordHash = bcrypt.hashSync(opts.password, 10);
  adminConfig = {
    username: opts.username,
    passwordHash,
    jwtSecret: opts.jwtSecret,
  };
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
