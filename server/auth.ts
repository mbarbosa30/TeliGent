import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db } from "./db";
import { users, sessions } from "@shared/schema";
import { eq } from "drizzle-orm";

const PgSession = connectPg(session);

function createRateLimiter(windowMs: number, maxAttempts: number, message: string) {
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
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const entry = store.get(ip);

    if (entry && now < entry.resetAt) {
      if (entry.count >= maxAttempts) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        res.set("Retry-After", String(retryAfter));
        return res.status(429).json({ message });
      }
      entry.count++;
    } else {
      store.set(ip, { count: 1, resetAt: now + windowMs });
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
        if (!secret && process.env.NODE_ENV === "production") {
          throw new Error("SESSION_SECRET environment variable must be set in production");
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
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ message: "Session error" });
        }
        const { passwordHash: _, ...safeUser } = user;
        res.status(201).json(safeUser);
      });
    } catch (err: any) {
      console.error("Register error:", err);
      res.status(500).json({ message: "Registration failed" });
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
      res.json(safeUser);
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
