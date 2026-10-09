require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const fs = require("node:fs/promises");
const path = require("node:path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || "development";
const SESSION_SECRET = process.env.SESSION_SECRET;
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:5500";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

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
app.use(session({
  name: "allworld.sid",
  secret: SESSION_SECRET || "development-only-change-this-session-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Zu viele Versuche. Bitte warte kurz und versuche es erneut." } });
const usernamePattern = /^[a-zA-Z0-9_-]{3,32}$/;

async function readUsers() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const content = await fs.readFile(USERS_FILE, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.writeFile(USERS_FILE, "[]\n", { mode: 0o600 });
      return [];
    }
    throw error;
  }
}
async function writeUsers(users) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temp = USERS_FILE + ".tmp";
  await fs.writeFile(temp, JSON.stringify(users, null, 2) + "\n", { mode: 0o600 });
  await fs.rename(temp, USERS_FILE);
}
function publicUser(user) {
  return { id: user.id, username: user.username, createdAt: user.createdAt };
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
    if (!usernamePattern.test(username)) return res.status(400).json({ error: "Der Benutzername muss 3–32 Zeichen lang sein und darf Buchstaben, Zahlen, _ und - enthalten." });
    if (password.length < 8 || password.length > 72) return res.status(400).json({ error: "Das Passwort muss 8–72 Zeichen lang sein." });
    const users = await readUsers();
    if (users.some(user => user.username.toLowerCase() === username.toLowerCase())) {
      return res.status(409).json({ error: "Dieser Benutzername ist bereits vergeben." });
    }
    const user = { id: require("node:crypto").randomUUID(), username, passwordHash: await bcrypt.hash(password, 12), createdAt: new Date().toISOString() };
    users.push(user);
    await writeUsers(users);
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
    const users = await readUsers();
    const user = users.find(item => item.username.toLowerCase() === username.toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
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

app.get("/api/auth/me", async (req, res, next) => {
  try {
    if (!req.session.userId) return res.json({ user: null });
    const users = await readUsers();
    const user = users.find(item => item.id === req.session.userId);
    if (!user) { req.session.destroy(() => {}); return res.json({ user: null }); }
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

app.get("/api/account", requireLogin, async (req, res, next) => {
  try {
    const users = await readUsers();
    const user = users.find(item => item.id === req.session.userId);
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

app.listen(PORT, "0.0.0.0", () => console.log("All World API listening on port " + PORT));