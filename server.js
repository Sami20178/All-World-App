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
const SESSION_SECRET = process.env.SESSION_SECRET || (NODE_ENV === "production" ? "" : "development-only-secret-change-before-deployment");
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:5500";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATABASE_FILE = process.env.DATABASE_FILE || path.join(DATA_DIR, "all-world.sqlite");
const LEGACY_USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
if (NODE_ENV === "production" && SESSION_SECRET.length < 32) throw new Error("Set SESSION_SECRET to a random secret of at least 32 characters in production.");
if (NODE_ENV === "production") app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin(origin, cb) { if (!origin || origin === APP_ORIGIN) return cb(null, true); return cb(new Error("Origin not allowed by All World API CORS policy.")); }, credentials: true, methods: ["GET","POST","DELETE","OPTIONS"], allowedHeaders: ["Content-Type"] }));
app.use(express.json({ limit: "10kb" }));
const authLimiter = rateLimit({ windowMs: 15*60*1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Zu viele Versuche. Bitte warte kurz und versuche es erneut." } });
const usernamePattern = /^[a-zA-Z0-9_-]{3,32}$/;
let db;
class SqliteSessionStore extends session.Store {
 get(sid, cb) { try { const row=db.prepare("SELECT sess,expires FROM sessions WHERE sid=?").get(sid); if(!row)return cb(null,null); if(row.expires<=Date.now()){db.prepare("DELETE FROM sessions WHERE sid=?").run(sid);return cb(null,null);} cb(null,JSON.parse(row.sess)); } catch(e){cb(e);} }
 set(sid,sess,cb=()=>{}) { try { const exp=sess.cookie&&sess.cookie.expires?new Date(sess.cookie.expires).getTime():Date.now()+SESSION_MAX_AGE; const uid=typeof sess.userId==="string"?sess.userId:null; db.prepare("INSERT INTO sessions(sid,sess,expires,user_id) VALUES(?,?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess,expires=excluded.expires,user_id=excluded.user_id").run(sid,JSON.stringify(sess),exp,uid); cb(null); } catch(e){cb(e);} }
 touch(sid,sess,cb=()=>{}) { try { const exp=sess.cookie&&sess.cookie.expires?new Date(sess.cookie.expires).getTime():Date.now()+SESSION_MAX_AGE; db.prepare("UPDATE sessions SET expires=? WHERE sid=?").run(exp,sid); cb(null); } catch(e){cb(e);} }
 destroy(sid,cb=()=>{}) { try { db.prepare("DELETE FROM sessions WHERE sid=?").run(sid); cb(null); } catch(e){cb(e);} }
}
async function initializeDatabase() {
 await fs.mkdir(path.dirname(DATABASE_FILE),{recursive:true}); db=new Database(DATABASE_FILE); db.pragma("journal_mode=WAL"); db.pragma("foreign_keys=ON");
 db.exec(`
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT NOT NULL,username_normalized TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS users_created_at_idx ON users(created_at);
 CREATE TABLE IF NOT EXISTS sessions(sid TEXT PRIMARY KEY,sess TEXT NOT NULL,expires INTEGER NOT NULL,user_id TEXT);
 CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires);
 CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
 CREATE TABLE IF NOT EXISTS account_links(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,linked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TEXT NOT NULL,PRIMARY KEY(user_id,linked_user_id),CHECK(user_id<>linked_user_id));
 CREATE TABLE IF NOT EXISTS user_data(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,data_type TEXT NOT NULL,data_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 `);
 try { const legacy=JSON.parse(await fs.readFile(LEGACY_USERS_FILE,"utf8")); if(Array.isArray(legacy)){ const insert=db.prepare("INSERT OR IGNORE INTO users(id,username,username_normalized,password_hash,created_at) VALUES(@id,@username,@username_normalized,@password_hash,@created_at)"); db.transaction(rows=>{for(const u of rows){if(typeof u.id!=="string"||typeof u.username!=="string"||typeof u.passwordHash!=="string"||typeof u.createdAt!=="string")continue;insert.run({id:u.id,username:u.username,username_normalized:u.username.toLowerCase(),password_hash:u.passwordHash,created_at:u.createdAt});}})(legacy);}} catch(e){if(e.code!=="ENOENT"&&!(e instanceof SyntaxError))throw e;}
 db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
}
function publicUser(u){return {id:u.id,username:u.username,createdAt:u.created_at};}
function findUser(id){return db.prepare("SELECT id,username,username_normalized,password_hash,created_at FROM users WHERE id=?").get(id);}
function requireLogin(req,res,next){if(!req.session.userId||!findUser(req.session.userId))return res.status(401).json({error:"Bitte melde dich zuerst an."});next();}
function setUserSession(req,id,cb){req.session.regenerate(e=>{if(e)return cb(e);req.session.userId=id;req.session.save(cb);});}
app.use(session({name:"allworld.sid",secret:SESSION_SECRET,store:new SqliteSessionStore(),resave:false,saveUninitialized:false,rolling:true,cookie:{httpOnly:true,sameSite:"lax",secure:NODE_ENV==="production",maxAge:SESSION_MAX_AGE}}));
app.get("/api/health",(_req,res)=>res.json({ok:true,service:"all-world-api"}));
app.post("/api/auth/register",authLimiter,async(req,res,next)=>{try{const username=typeof req.body.username==="string"?req.body.username.trim():"";const password=typeof req.body.password==="string"?req.body.password:"";if(!usernamePattern.test(username))return res.status(400).json({error:"Der Benutzername muss 3–32 Zeichen lang sein und darf Buchstaben, Zahlen, _ und - enthalten."});if(password.length<8||password.length>72||Buffer.byteLength(password,"utf8")>72)return res.status(400).json({error:"Das Passwort muss 8–72 Zeichen lang sein."});const u={id:crypto.randomUUID(),username,username_normalized:username.toLowerCase(),password_hash:await bcrypt.hash(password,12),created_at:new Date().toISOString()};try{db.prepare("INSERT INTO users(id,username,username_normalized,password_hash,created_at) VALUES(@id,@username,@username_normalized,@password_hash,@created_at)").run(u);}catch(e){if(e.code==="SQLITE_CONSTRAINT_UNIQUE")return res.status(409).json({error:"Dieser Benutzername ist bereits vergeben."});throw e;}setUserSession(req,u.id,e=>{if(e)return next(e);res.status(201).json({user:publicUser(u)});});}catch(e){next(e);}});
app.post("/api/auth/login",authLimiter,async(req,res,next)=>{try{const username=typeof req.body.username==="string"?req.body.username.trim():"";const password=typeof req.body.password==="string"?req.body.password:"";const u=db.prepare("SELECT id,username,username_normalized,password_hash,created_at FROM users WHERE username_normalized=?").get(username.toLowerCase());if(!u||!(await bcrypt.compare(password,u.password_hash)))return res.status(401).json({error:"Benutzername oder Passwort ist falsch."});setUserSession(req,u.id,e=>{if(e)return next(e);res.json({user:publicUser(u)});});}catch(e){next(e);}});
app.get("/api/auth/me",(req,res,next)=>{try{if(!req.session.userId)return res.json({user:null});const u=findUser(req.session.userId);if(!u)return req.session.destroy(()=>{res.clearCookie("allworld.sid",{httpOnly:true,sameSite:"lax",secure:NODE_ENV==="production"});res.json({user:null});});res.json({user:publicUser(u)});}catch(e){next(e);}});
app.post("/api/auth/logout",(req,res,next)=>req.session.destroy(e=>{if(e)return next(e);res.clearCookie("allworld.sid",{httpOnly:true,sameSite:"lax",secure:NODE_ENV==="production"});res.json({ok:true});}));
app.get("/api/auth/linked",requireLogin,(req,res,next)=>{try{const linked=db.prepare("SELECT u.id,u.username,u.created_at FROM users u JOIN account_links l ON l.linked_user_id=u.id WHERE l.user_id=? ORDER BY u.username_normalized").all(req.session.userId);const current=findUser(req.session.userId);res.json({accounts:[publicUser(current),...linked.filter(u=>u.id!==current.id).map(publicUser)]});}catch(e){next(e);}});
app.post("/api/auth/link",requireLogin,authLimiter,async(req,res,next)=>{try{const username=typeof req.body.username==="string"?req.body.username.trim():"";const password=typeof req.body.password==="string"?req.body.password:"";if(!username||!password)return res.status(400).json({error:"Gib Benutzername und Passwort des Kontos ein, das du verbinden möchtest."});const target=db.prepare("SELECT id,username,username_normalized,password_hash,created_at FROM users WHERE username_normalized=?").get(username.toLowerCase());if(!target||!(await bcrypt.compare(password,target.password_hash)))return res.status(401).json({error:"Kontodaten stimmen nicht. Bestätige das andere Konto mit seinem Passwort."});if(target.id===req.session.userId)return res.status(400).json({error:"Dieses Konto ist bereits aktiv."});const now=new Date().toISOString();db.transaction(()=>{db.prepare("INSERT OR IGNORE INTO account_links(user_id,linked_user_id,created_at) VALUES(?,?,?)").run(req.session.userId,target.id,now);db.prepare("INSERT OR IGNORE INTO account_links(user_id,linked_user_id,created_at) VALUES(?,?,?)").run(target.id,req.session.userId,now);})();res.status(201).json({account:publicUser(target)});}catch(e){next(e);}});
app.post("/api/auth/switch",requireLogin,(req,res,next)=>{try{const id=typeof req.body.accountId==="string"?req.body.accountId:"";const allowed=db.prepare("SELECT 1 FROM account_links WHERE user_id=? AND linked_user_id=?").get(req.session.userId,id);const target=allowed&&findUser(id);if(!target)return res.status(403).json({error:"Dieses Konto ist nicht mit deinem aktiven Konto verbunden."});setUserSession(req,target.id,e=>{if(e)return next(e);res.json({user:publicUser(target)});});}catch(e){next(e);}});
app.delete("/api/account",requireLogin,async(req,res,next)=>{const id=req.session.userId;try{const password=typeof req.body.password==="string"?req.body.password:"";const u=findUser(id);if(!password||!u||!(await bcrypt.compare(password,u.password_hash)))return res.status(401).json({error:"Gib zur Bestätigung dein aktuelles Passwort ein."});db.transaction(()=>{db.prepare("DELETE FROM user_data WHERE user_id=?").run(id);db.prepare("DELETE FROM account_links WHERE user_id=? OR linked_user_id=?").run(id,id);db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);db.prepare("DELETE FROM users WHERE id=?").run(id);})();req.session.destroy(e=>{if(e)return next(e);res.clearCookie("allworld.sid",{httpOnly:true,sameSite:"lax",secure:NODE_ENV==="production"});res.json({ok:true,deleted:true});});}catch(e){next(e);}});
app.get("/api/account",requireLogin,(req,res,next)=>{try{const u=findUser(req.session.userId);if(!u)return res.status(401).json({error:"Bitte melde dich erneut an."});res.json({user:publicUser(u)});}catch(e){next(e);}});
app.use((req,res)=>res.status(404).json({error:"API-Endpunkt nicht gefunden."}));
app.use((e,_req,res,_next)=>{console.error("API error:",e.message);if(res.headersSent)return;res.status(500).json({error:"Interner Serverfehler."});});
initializeDatabase().then(()=>{const server=app.listen(PORT,"0.0.0.0",()=>console.log("All World API listening on port "+PORT));const shutdown=()=>server.close(()=>{if(db)db.close();process.exit(0);});process.once("SIGTERM",shutdown);process.once("SIGINT",shutdown);}).catch(e=>{console.error("Database initialization failed:",e.message);process.exitCode=1;});
