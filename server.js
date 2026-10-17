require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const Database = require("better-sqlite3");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || "development";
const SESSION_SECRET = process.env.SESSION_SECRET;
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:5500";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATABASE_FILE = process.env.DATABASE_FILE || path.join(DATA_DIR, "all-world.sqlite");
const LEGACY_USERS_FILE = path.join(DATA_DIR, "users.json");

if (NODE_ENV === "production" && (!SESSION_SECRET || SESSION_SECRET.length < 32)) {
  throw new Error("Set SESSION_SECRET to a random secret of at least 32 characters in production.");
}
if (NODE_ENV === "production") app.set("trust proxy", 1);

app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || origin === APP_ORIGIN) return callback(null, true);
    return callback(new Error("Origin not allowed by All World API CORS policy."));
  },
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json({ limit: "10kb" }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Zu viele Versuche. Bitte warte kurz und versuche es erneut." }
});
const usernamePattern = /^[a-zA-Z0-9_-]{3,32}$/;

let db;
async function initializeDatabase() {
  await fs.mkdir(path.dirname(DATABASE_FILE), { recursive: true });
  db = new Database(DATABASE_FILE);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      username_normalized TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS users_created_at_idx ON users(created_at);
  `);

  // Import valid accounts from the old JSON prototype once, without deleting its backup.
  try {
    const legacy = JSON.parse(await fs.readFile(LEGACY_USERS_FILE, "utf8"));
    if (Array.isArray(legacy)) {
      const insert = db.prepare(`
        INSERT OR IGNORE INTO users (id, username, username_normalized, password_hash, created_at)
        VALUES (@id, @username, @username_normalized, @password_hash, @created_at)
      `);
      db.transaction(rows => {
        for (const user of rows) {
          if (typeof user.id !== "string" || typeof user.username !== "string" ||
              typeof user.passwordHash !== "string" || typeof user.createdAt !== "string") continue;
          insert.run({
            id: user.id, username: user.username,
            username_normalized: user.username.toLowerCase(),
            password_hash: user.passwordHash, created_at: user.createdAt
          });
        }
      })(legacy);
    }
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
}

function publicUser(user) {
  return { id: user.id, username: user.username, createdAt: user.created_at };
}
function findUserById(id) {
  return db.prepare("SELECT id, username, username_normalized, password_hash, created_at FROM users WHERE id = ?").get(id);
}
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Bitte melde dich zuerst an." });
  next();
}

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "all-world-api" }));

app.post("/api/auth/register", authLimiter, async (req, res, next) => {
  try {
    const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";
    if (!usernamePattern.test(username)) {
      return res.status(400).json({ error: "Der Benutzername muss 3–32 Zeichen lang sein und darf Buchstaben, Zahlen, _ und - enthalten." });
    }
    if (password.length < 8 || password.length > 72 || Buffer.byteLength(password, "utf8") > 72) {
      return res.status(400).json({ error: "Das Passwort muss 8–72 Zeichen lang sein." });
    }

    const user = {
      id: crypto.randomUUID(),
      username,
      username_normalized: username.toLowerCase(),
      password_hash: await bcrypt.hash(password, 12),
      created_at: new Date().toISOString()
    };
    try {
      db.prepare("INSERT INTO users (id, username, username_normalized, password_hash, created_at) VALUES (@id, @username, @username_normalized, @password_hash, @created_at)").run(user);
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return res.status(409).json({ error: "Dieser Benutzername ist bereits vergeben." });
      }
      throw error;
    }

    req.session.userId = user.id;
    req.session.save(error => {
      if (error) return next(error);
      res.status(201).json({ user: publicUser(user) });
    });
  } catch (error) { next(error); }
});

app.post("/api/auth/login", authLimiter, async (req, res, next) => {
  try {
    const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const user = db.prepare("SELECT id, username, username_normalized, password_hash, created_at FROM users WHERE username_normalized = ?").get(username.toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Benutzername oder Passwort ist falsch." });
    }
    req.session.regenerate(error => {
      if (error) return next(error);
      req.session.userId = user.id;
      req.session.save(saveError => {
        if (saveError) return next(saveError);
        res.json({ user: publicUser(user) });
      });
    });
  } catch (error) { next(error); }
});

app.get("/api/auth/me", (req, res, next) => {
  try {
    if (!req.session.userId) return res.json({ user: null });
    const user = findUserById(req.session.userId);
    if (!user) return req.session.destroy(() => res.json({ user: null }));
    res.json({ user: publicUser(user) });
  } catch (error) { next(error); }
});

app.post("/api/auth/logout", (req, res, next) => {
  req.session.destroy(error => {
    if (error) return next(error);
    res.clearCookie("allworld.sid", { httpOnly: true, sameSite: "lax", secure: NODE_ENV === "production" });
    res.json({ ok: true });
  });
});

app.get("/api/account", requireLogin, (req, res, next) => {
  try {
    const user = findUserById(req.session.userId);
    if (!user) return res.status(401).json({ error: "Bitte melde dich erneut an." });
    res.json({ user: publicUser(user) });
  } catch (error) { next(error); }
});

app.use((req, res) => res.status(404).json({ error: "API-Endpunkt nicht gefunden." }));
app.use((error, _req, res, _next) => {
  console.error("API error:", error.message);
  if (res.headersSent) return;
  res.status(500).json({ error: "Interner Serverfehler." });
});

initializeDatabase().then(() => {
  const server = app.listen(PORT, "0.0.0.0", () => console.log("All World API listening on port " + PORT));
  const shutdown = () => server.close(() => {
    if (db) db.close();
    process.exit(0);
  });
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}).catch(error => {
  console.error("Database initialization failed:", error.message);
  process.exitCode = 1;
});
