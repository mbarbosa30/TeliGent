import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { users, sessions } from "@shared/schema";
import { eq } from "drizzle-orm";

const PgSession = connectPg(session);

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
      secret: process.env.SESSION_SECRET || "telegent-secret-key-change-me",
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
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { email, password, firstName, lastName } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
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
        firstName: firstName?.trim() || null,
        lastName: lastName?.trim() || null,
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

  app.post("/api/auth/login", async (req: Request, res: Response) => {
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

  app.post("/api/admin/login", (req: Request, res: Response) => {
    const { passphrase } = req.body;
    const adminPassphrase = process.env.ADMIN_PASSPHRASE;

    if (!adminPassphrase) {
      return res.status(503).json({ message: "Admin access is not configured" });
    }

    if (!passphrase || passphrase !== adminPassphrase) {
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
