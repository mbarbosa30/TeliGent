import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const CSRF_COOKIE = "csrf_token";
const CSRF_HEADER = "x-csrf-token";
const TOKEN_BYTES = 32;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const EXEMPT_PREFIXES = [
  "/api/telegram-webhook/",
  "/api/widget/",
  "/api/agent/",
  "/api/public/",
];

const EXEMPT_EXACT = new Set<string>([
  "/api/billing/webhook",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/admin/login",
]);

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  const parts = header.split(";");
  for (const raw of parts) {
    const idx = raw.indexOf("=");
    if (idx === -1) continue;
    const key = raw.slice(0, idx).trim();
    if (key === name) {
      try {
        return decodeURIComponent(raw.slice(idx + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function isExempt(path: string): boolean {
  if (EXEMPT_EXACT.has(path)) return true;
  for (const prefix of EXEMPT_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.byteLength !== bb.byteLength) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function csrfMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Issue / refresh the double-submit cookie on every request that doesn't
  // already have one. Non-HttpOnly so the SPA can read and echo it back.
  let cookieToken = readCookie(req, CSRF_COOKIE);
  if (!cookieToken || cookieToken.length < 16) {
    cookieToken = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    res.cookie(CSRF_COOKIE, cookieToken, {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    });
  }

  if (SAFE_METHODS.has(req.method)) return next();
  if (!req.path.startsWith("/api/")) return next();
  if (isExempt(req.path)) return next();

  const headerValue = req.header(CSRF_HEADER);
  if (!headerValue || !timingSafeStringEqual(headerValue, cookieToken)) {
    res.status(403).json({ message: "Invalid or missing CSRF token" });
    return;
  }

  next();
}
