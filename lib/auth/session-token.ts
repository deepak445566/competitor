// Stateless signed session token: "<expiresAtMs>.<hmac>".
// Kept free of Next.js imports so proxy.ts can use it too.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";

export const SESSION_COOKIE = "cm_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function secret(): string {
  if (config.sessionSecret) return config.sessionSecret;
  // Fallback: derive from the admin credentials, so changing the password logs everyone out.
  return createHash("sha256")
    .update(`cm:${config.adminUsername}:${config.adminPassword}`)
    .digest("hex");
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function createSessionToken(): string {
  const exp = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  return `${exp}.${sign(`${config.adminUsername}.${exp}`)}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token || !config.adminUsername || !config.adminPassword) return false;
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!sig || !Number.isFinite(exp) || exp < Date.now()) return false;
  return safeEqual(sig, sign(`${config.adminUsername}.${exp}`));
}

/** Constant-time credential check against ADMIN_USERNAME / ADMIN_PASSWORD. */
export function checkCredentials(username: string, password: string): boolean {
  if (!config.adminUsername || !config.adminPassword) return false;
  const userOk = safeEqual(hash(username), hash(config.adminUsername));
  const passOk = safeEqual(hash(password), hash(config.adminPassword));
  return userOk && passOk;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
