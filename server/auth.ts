import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db, pool } from "./db";
import { users, sessions, emailVerificationTokens, passwordResetTokens, type User } from "@shared/schema";
import { eq, and, gt, isNull, lt } from "drizzle-orm";
import { sendVerificationEmail, sendPasswordResetEmail } from "./email/mailer";

type SafeUser = Omit<User, "passwordHash">;

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

// Build the canonical origin used inside email links. We refuse to trust
// request-supplied host or x-forwarded-* headers here because tokenized
// verification/reset links would otherwise be vulnerable to host-header
// poisoning (an attacker triggering a password reset on a victim's account
// could redirect the email link to their own server). Always prefer the
// APP_URL env var. The req fallback is only for local development before
// APP_URL is configured.
function getEmailOrigin(req: Request): string {
  const configured = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    console.warn("[auth] APP_URL is not set in production — falling back to request host for email links. Set APP_URL to a trusted canonical origin.");
  }
  return `${req.protocol}://${req.get("host")}`;
}

async function issueAndSendVerificationEmail(user: User, origin: string): Promise<void> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);
  await db.insert(emailVerificationTokens).values({ tokenHash, userId: user.id, expiresAt });
  const link = `${origin}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  await sendVerificationEmail(user.email, link).catch((err) => {
    console.error("[auth] verification email send failed:", err?.message || err);
  });
}

async function destroySessionsForUser(userId: string): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM sessions WHERE (sess::jsonb)->>'userId' = $1`,
      [userId]
    );
  } catch (err: any) {
    console.error("[auth] failed to destroy sessions for user:", err?.message || err);
  }
}

export function requireVerifiedEmail(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  db.select().from(users).where(eq(users.id, req.session.userId)).limit(1)
    .then(([user]) => {
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (!user.emailVerified) {
        return res.status(403).json({
          code: "EMAIL_NOT_VERIFIED",
          message: "Please verify your email address to continue. Check your inbox or request a new verification link from the Account page.",
        });
      }
      next();
    })
    .catch(() => res.status(500).json({ message: "Server error" }));
}

// Normalize a paid plan to "free" once planPeriodEnd has elapsed, so the
// dashboard never shows a stale paid badge after a period expires (especially
// for crypto rails which have no Stripe webhook to mark expiry). Also clears
// teliPaid for the same reason.
function normalizePlanForResponse(safeUser: SafeUser): SafeUser {
  const periodEnd = safeUser.planPeriodEnd ? new Date(safeUser.planPeriodEnd).getTime() : 0;
  const planActive = !!safeUser.plan && safeUser.plan !== "free" && periodEnd > Date.now();
  return {
    ...safeUser,
    plan: planActive ? safeUser.plan : "free",
    teliPaid: !!(safeUser.teliPaid && planActive),
  };
}

const PgSession = connectPg(session);

function createRateLimiter(windowMs: number, maxAttempts: number, message: string) {
  return createKeyedRateLimiter(windowMs, maxAttempts, message, (req) => req.ip || req.socket.remoteAddress || "unknown");
}

// Generic keyed rate limiter. The keyFn receives the request and returns the
// bucket key (e.g. user id, normalized email, IP). Returning null skips
// rate limiting for that request (e.g. body missing required field).
function createKeyedRateLimiter(
  windowMs: number,
  maxAttempts: number,
  message: string,
  keyFn: (req: Request) => string | null,
) {
  const store = new Map<string, { count: number; resetAt: number }>();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now >= entry.resetAt) {
        store.delete(key);
      }
    }
  }, 60 * 1000);

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyFn(req);
    if (!key) return next();
    const now = Date.now();
    const entry = store.get(key);

    if (entry && now < entry.resetAt) {
      if (entry.count >= maxAttempts) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        res.set("Retry-After", String(retryAfter));
        return res.status(429).json({ message });
      }
      entry.count++;
    } else {
      store.set(key, { count: 1, resetAt: now + windowMs });
    }

    next();
  };
}

declare module "express-session" {
  interface SessionData {
    userId?: string;
    adminAuthenticated?: boolean;
  }
}

export function setupAuth(app: Express) {
  app.set("trust proxy", 1);

  app.use(
    session({
      store: new PgSession({
        conObject: {
          connectionString: process.env.DATABASE_URL,
        },
        createTableIfMissing: true,
        tableName: "sessions",
      }),
      secret: (() => {
        const secret = process.env.SESSION_SECRET;
        const isProd = process.env.NODE_ENV === "production";
        if (isProd) {
          if (!secret) {
            throw new Error("SESSION_SECRET environment variable must be set in production");
          }
          if (secret === "telegent-dev-secret-key" || secret.length < 32) {
            throw new Error("SESSION_SECRET must be a strong unique value (>=32 chars) in production — refusing to boot");
          }
        }
        return secret || "telegent-dev-secret-key";
      })(),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 30 * 24 * 60 * 60 * 1000,
        sameSite: "lax",
      },
    })
  );
}

export function isAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (req.session?.userId) {
    return next();
  }
  res.status(401).json({ message: "Unauthorized" });
}

export function isAdminAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.adminAuthenticated) {
    return res.status(401).json({ message: "Admin access required" });
  }
  next();
}

export function registerAuthRoutes(app: Express) {
  const authRateLimit = createRateLimiter(15 * 60 * 1000, 10, "Too many attempts. Please try again in 15 minutes.");
  const adminRateLimit = createRateLimiter(15 * 60 * 1000, 5, "Too many attempts. Please try again in 15 minutes.");

  app.post("/api/auth/register", authRateLimit, async (req: Request, res: Response) => {
    try {
      const { email, password, firstName, lastName } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }
      if (typeof email !== "string" || email.length > 255) {
        return res.status(400).json({ message: "Email must be 255 characters or fewer" });
      }
      if (typeof password !== "string" || password.length > 128) {
        return res.status(400).json({ message: "Password must be 128 characters or fewer" });
      }
      if (firstName && (typeof firstName !== "string" || firstName.length > 100)) {
        return res.status(400).json({ message: "First name must be 100 characters or fewer" });
      }
      if (lastName && (typeof lastName !== "string" || lastName.length > 100)) {
        return res.status(400).json({ message: "Last name must be 100 characters or fewer" });
      }
      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      const emailLower = email.toLowerCase().trim();
      const existing = await db.select().from(users).where(eq(users.email, emailLower)).limit(1);
      if (existing.length > 0) {
        return res.status(409).json({ message: "An account with this email already exists" });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const [user] = await db.insert(users).values({
        email: emailLower,
        passwordHash,
        firstName: firstName?.trim().slice(0, 100) || null,
        lastName: lastName?.trim().slice(0, 100) || null,
      }).returning();

      req.session.userId = user.id;
      req.session.save(async (err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ message: "Session error" });
        }
        try {
          await issueAndSendVerificationEmail(user, getEmailOrigin(req));
        } catch (mailErr: any) {
          // Don't fail the registration if email delivery hiccups — the user
          // can request a fresh verification link from the Account page.
          console.error("[auth] verification email failed at register:", mailErr?.message || mailErr);
        }
        const { passwordHash: _, ...safeUser } = user;
        res.status(201).json(safeUser);
      });
    } catch (err: any) {
      console.error("Register error:", err);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  // Verify an email using a token from the verification link. Public.
  // GET so that clicking the link in an email immediately verifies and
  // redirects the browser to the account page with a success flag — no
  // client-side roundtrip required. We always redirect (302) so that even
  // failures land on a familiar page that explains how to recover.
  app.get("/api/auth/verify-email", authRateLimit, async (req: Request, res: Response) => {
    const fallbackOk = "/account?verified=1";
    const fallbackErr = "/account?verified=0";
    try {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      if (!token) return res.redirect(302, fallbackErr);
      const tokenHash = hashToken(token);
      const [record] = await db.select().from(emailVerificationTokens)
        .where(and(eq(emailVerificationTokens.tokenHash, tokenHash), gt(emailVerificationTokens.expiresAt, new Date())))
        .limit(1);
      if (!record) return res.redirect(302, fallbackErr);
      await db.update(users)
        .set({ emailVerified: true, emailVerifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, record.userId));
      // Burn this token + any other pending verification tokens for the same user.
      await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, record.userId));
      // Cleanup expired tokens opportunistically.
      await db.delete(emailVerificationTokens).where(lt(emailVerificationTokens.expiresAt, new Date())).catch(() => {});
      return res.redirect(302, fallbackOk);
    } catch (err: any) {
      console.error("Verify email error:", err);
      return res.redirect(302, fallbackErr);
    }
  });

  // Resend a verification email to the currently signed-in user.
  // Tightly rate limited per-user (1 per minute) so an attacker cannot use
  // a stolen session to flood a victim's inbox.
  const resendVerificationLimit = createKeyedRateLimiter(
    60 * 1000,
    1,
    "Please wait a minute before requesting another verification email.",
    (req) => req.session?.userId || null,
  );
  app.post("/api/auth/resend-verification", resendVerificationLimit, async (req: Request, res: Response) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const [user] = await db.select().from(users).where(eq(users.id, req.session.userId)).limit(1);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (user.emailVerified) {
        return res.json({ alreadyVerified: true });
      }
      await issueAndSendVerificationEmail(user, getEmailOrigin(req));
      res.json({ sent: true });
    } catch (err: any) {
      console.error("Resend verification error:", err);
      res.status(500).json({ message: "Failed to send verification email" });
    }
  });

  // Forgot-password: always returns success to avoid leaking which emails exist.
  // Rate limited per-email (3/hour) and per-IP (10/15min via authRateLimit) so
  // that a single bad actor cannot spam any specific account.
  const forgotPasswordPerEmail = createKeyedRateLimiter(
    60 * 60 * 1000,
    3,
    "Too many password reset requests for that email. Try again later.",
    (req) => {
      const email = (req.body?.email || "").toString().toLowerCase().trim();
      return email ? `forgot:${email}` : null;
    },
  );
  app.post("/api/auth/forgot-password", authRateLimit, forgotPasswordPerEmail, async (req: Request, res: Response) => {
    try {
      const { email } = req.body || {};
      if (!email || typeof email !== "string") {
        return res.status(400).json({ message: "Email is required" });
      }
      const emailLower = email.toLowerCase().trim();
      const [user] = await db.select().from(users).where(eq(users.email, emailLower)).limit(1);
      if (user) {
        const token = generateToken();
        const tokenHash = hashToken(token);
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
        await db.insert(passwordResetTokens).values({ tokenHash, userId: user.id, expiresAt });
        const link = `${getEmailOrigin(req)}/reset-password?token=${encodeURIComponent(token)}`;
        await sendPasswordResetEmail(user.email, link).catch((err) => {
          console.error("[auth] reset email send failed:", err?.message || err);
        });
      }
      res.json({ ok: true });
    } catch (err: any) {
      console.error("Forgot password error:", err);
      res.json({ ok: true });
    }
  });

  // Complete a password reset using a token. Public.
  app.post("/api/auth/reset-password", authRateLimit, async (req: Request, res: Response) => {
    try {
      const { token, password } = req.body || {};
      if (!token || typeof token !== "string") {
        return res.status(400).json({ message: "Reset token is required" });
      }
      if (!password || typeof password !== "string" || password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }
      if (password.length > 128) {
        return res.status(400).json({ message: "Password must be 128 characters or fewer" });
      }
      const tokenHash = hashToken(token);
      const [record] = await db.select().from(passwordResetTokens)
        .where(and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          gt(passwordResetTokens.expiresAt, new Date()),
          isNull(passwordResetTokens.usedAt),
        ))
        .limit(1);
      if (!record) {
        return res.status(400).json({ message: "This reset link has expired or has already been used. Request a new one." });
      }
      const newHash = await bcrypt.hash(password, 12);
      // Note: we deliberately do NOT flip emailVerified here. Verification and
      // password reset are kept as independent flows; if a reset is performed
      // on an unverified account, the user still needs to verify before
      // hitting paid features.
      await db.update(users)
        .set({ passwordHash: newHash, updatedAt: new Date() })
        .where(eq(users.id, record.userId));
      await db.update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.tokenHash, tokenHash));
      // Force sign-out from any other active sessions for this user.
      await destroySessionsForUser(record.userId);
      // Opportunistic cleanup.
      await db.delete(passwordResetTokens).where(lt(passwordResetTokens.expiresAt, new Date())).catch(() => {});
      res.json({ ok: true });
    } catch (err: any) {
      console.error("Reset password error:", err);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  app.post("/api/auth/login", authRateLimit, async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      const emailLower = email.toLowerCase().trim();
      const [user] = await db.select().from(users).where(eq(users.email, emailLower)).limit(1);
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      req.session.userId = user.id;
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ message: "Session error" });
        }
        const { passwordHash: _, ...safeUser } = user;
        res.json(safeUser);
      });
    } catch (err: any) {
      console.error("Login error:", err);
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.get("/api/auth/user", async (req: Request, res: Response) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const [user] = await db.select().from(users).where(eq(users.id, req.session.userId)).limit(1);
      if (!user) {
        req.session.destroy(() => {});
        return res.status(401).json({ message: "Unauthorized" });
      }
      const { passwordHash: _, ...safeUser } = user;
      res.json(normalizePlanForResponse(safeUser));
    } catch (err: any) {
      res.status(500).json({ message: "Server error" });
    }
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.clearCookie("connect.sid");
      res.json({ message: "Logged out" });
    });
  });

  app.post("/api/admin/login", adminRateLimit, (req: Request, res: Response) => {
    const { passphrase } = req.body;
    const adminPassphrase = process.env.ADMIN_PASSPHRASE;

    if (!adminPassphrase) {
      return res.status(503).json({ message: "Admin access is not configured" });
    }

    if (!passphrase || typeof passphrase !== "string") {
      return res.status(401).json({ message: "Invalid passphrase" });
    }
    const inputBuf = Buffer.from(passphrase, "utf8");
    const expectedBuf = Buffer.from(adminPassphrase, "utf8");
    if (inputBuf.byteLength !== expectedBuf.byteLength ||
        !crypto.timingSafeEqual(inputBuf, expectedBuf)) {
      return res.status(401).json({ message: "Invalid passphrase" });
    }

    req.session.regenerate((err) => {
      if (err) {
        return res.status(500).json({ message: "Session error" });
      }
      req.session.adminAuthenticated = true;
      req.session.save((saveErr) => {
        if (saveErr) {
          return res.status(500).json({ message: "Session error" });
        }
        res.json({ authenticated: true });
      });
    });
  });

  app.patch("/api/auth/user", async (req: Request, res: Response) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const { firstName, lastName, email } = req.body;
      const updates: Record<string, any> = {};
      if (firstName !== undefined) {
        if (typeof firstName !== "string" || firstName.length > 100) {
          return res.status(400).json({ message: "First name must be 100 characters or fewer" });
        }
        updates.firstName = firstName.trim().slice(0, 100) || null;
      }
      if (lastName !== undefined) {
        if (typeof lastName !== "string" || lastName.length > 100) {
          return res.status(400).json({ message: "Last name must be 100 characters or fewer" });
        }
        updates.lastName = lastName.trim().slice(0, 100) || null;
      }
      if (email !== undefined) {
        if (typeof email !== "string" || email.length > 255) {
          return res.status(400).json({ message: "Email must be 255 characters or fewer" });
        }
        const emailLower = email.toLowerCase().trim();
        if (!emailLower || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
          return res.status(400).json({ message: "Please enter a valid email address" });
        }
        const existing = await db.select().from(users).where(eq(users.email, emailLower)).limit(1);
        if (existing.length > 0 && existing[0].id !== req.session.userId) {
          return res.status(409).json({ message: "An account with this email already exists" });
        }
        updates.email = emailLower;
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No fields to update" });
      }
      updates.updatedAt = new Date();
      const [updated] = await db.update(users).set(updates).where(eq(users.id, req.session.userId)).returning();
      if (!updated) {
        return res.status(404).json({ message: "User not found" });
      }
      const { passwordHash: _, ...safeUser } = updated;
      res.json(safeUser);
    } catch (err: any) {
      console.error("Update user error:", err);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  app.patch("/api/auth/password", async (req: Request, res: Response) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Current and new password are required" });
      }
      if (typeof newPassword !== "string" || newPassword.length < 6) {
        return res.status(400).json({ message: "New password must be at least 6 characters" });
      }
      if (typeof newPassword !== "string" || newPassword.length > 128) {
        return res.status(400).json({ message: "New password must be 128 characters or fewer" });
      }
      const [user] = await db.select().from(users).where(eq(users.id, req.session.userId)).limit(1);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: "Current password is incorrect" });
      }
      const newHash = await bcrypt.hash(newPassword, 12);
      await db.update(users).set({ passwordHash: newHash, updatedAt: new Date() }).where(eq(users.id, req.session.userId));
      res.json({ message: "Password updated" });
    } catch (err: any) {
      console.error("Password update error:", err);
      res.status(500).json({ message: "Failed to update password" });
    }
  });

  app.get("/api/admin/check", (req: Request, res: Response) => {
    res.json({ authenticated: !!req.session?.adminAuthenticated });
  });

  app.post("/api/admin/logout", (req: Request, res: Response) => {
    if (req.session) {
      req.session.adminAuthenticated = false;
      req.session.save((err) => {
        if (err) {
          return res.status(500).json({ message: "Logout failed" });
        }
        res.json({ message: "Admin logged out" });
      });
    } else {
      res.json({ message: "Admin logged out" });
    }
  });
}
