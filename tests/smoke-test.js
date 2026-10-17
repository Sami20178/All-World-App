const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "all-world-api-test-"));
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, NODE_ENV:"test", PORT:String(port), APP_ORIGIN:"http://localhost:5500", SESSION_SECRET:"ci-only-session-secret-not-used-in-production", DATA_DIR:dataDir },
    stdio:["ignore","pipe","pipe"]
  });
  let logs="";
  child.stdout.on("data",chunk=>{logs+=chunk.toString();});
  child.stderr.on("data",chunk=>{logs+=chunk.toString();});
  const request=(route,options={})=>fetch(baseUrl+route,options);
  const jsonRequest=(route,payload,cookie)=>request(route,{method:"POST",headers:{"content-type":"application/json",...(cookie?{cookie}:{})},body:JSON.stringify(payload)});
  const cookieFrom=response=>{const match=(response.headers.get("set-cookie")||"").match(/allworld\.sid=[^;]*/);return match?match[0]:"";};
  try {
    let ready=false;
    for(let i=0;i<80;i++){if(child.exitCode!==null)throw new Error("API process exited before ready. "+logs);try{const r=await request("/api/health");if(r.ok&&(await r.json()).service==="all-world-api"){ready=true;break;}}catch(_){}await delay(100);}
    assert.equal(ready,true,"API did not become ready. "+logs);
    assert.equal((await request("/api/health")).status,200);

    assert.equal((await jsonRequest("/api/auth/register",{username:"x",password:"short"})).status,400);
    const username="ci_"+Date.now().toString(36), password="Test-password-2026!";
    const registered=await jsonRequest("/api/auth/register",{username,password});
    assert.equal(registered.status,201);
    const first=(await registered.json()).user; let firstCookie=cookieFrom(registered);
    assert.ok(firstCookie,"registration should set a session cookie");

    const dbPath=path.join(dataDir,"all-world.sqlite");
    await fs.access(dbPath);
    let database=new Database(dbPath,{readonly:true});
    try {
      const stored=database.prepare("SELECT username,password_hash FROM users WHERE username_normalized=?").get(username.toLowerCase());
      assert.ok(stored,"account should be saved in SQLite");
      assert.notEqual(stored.password_hash,password,"password must not be plaintext");
      assert.match(stored.password_hash,/^\$2[aby]\$/i,"password should be bcrypt hashed");
      assert.ok(database.prepare("SELECT sid FROM sessions WHERE user_id=?").get(first.id),"session should be stored persistently");
    } finally { database.close(); }

    assert.equal((await jsonRequest("/api/auth/register",{username,password})).status,409);
    assert.equal((await request("/api/auth/me",{headers:{cookie:firstCookie}})).status,200);
    assert.equal((await request("/api/account",{headers:{cookie:firstCookie}})).status,200);
    assert.equal((await jsonRequest("/api/auth/logout",{},firstCookie)).status,200);
    assert.equal((await request("/api/account")).status,401);

    const badLogin=await jsonRequest("/api/auth/login",{username,password:"incorrect-password"});
    assert.equal(badLogin.status,401);
    const login=await jsonRequest("/api/auth/login",{username,password});
    assert.equal(login.status,200);
    const loginCookie=cookieFrom(login);
    assert.ok(loginCookie,"login should create a session after logout");
    assert.equal((await jsonRequest("/api/auth/logout",{},loginCookie)).status,200);
    const reloginFirst=await jsonRequest("/api/auth/login",{username,password});
    assert.equal(reloginFirst.status,200);
    firstCookie=cookieFrom(reloginFirst);

    const secondName="ci_second_"+Date.now().toString(36), secondPassword="Second-password-2026!";
    const secondReg=await jsonRequest("/api/auth/register",{username:secondName,password:secondPassword});
    assert.equal(secondReg.status,201);
    const second=(await secondReg.json()).user, secondCookie=cookieFrom(secondReg);
    const relink=await jsonRequest("/api/auth/link",{username:secondName,password:secondPassword},firstCookie);
    assert.equal(relink.status,201,"linking must verify the second account's password");
    const linked=await request("/api/auth/linked",{headers:{cookie:firstCookie}});
    assert.equal(linked.status,200);
    assert.ok((await linked.json()).accounts.some(a=>a.id===second.id),"linked account should appear in account selector");

    const switched=await jsonRequest("/api/auth/switch",{accountId:second.id},firstCookie);
    assert.equal(switched.status,200,"switching to a verified linked account should work");
    const switchedCookie=cookieFrom(switched);
    assert.equal((await (await request("/api/auth/me",{headers:{cookie:switchedCookie}})).json()).user.username,secondName);

    // Seed sample account-owned data and verify account deletion removes it and invalidates access.
    database=new Database(dbPath);
    try {
      const now=new Date().toISOString();
      database.prepare("INSERT INTO user_data(id,user_id,data_type,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?)").run("test-data-"+second.id,second.id,"test","{}",now,now);
    } finally { database.close(); }
    const deleteWithoutPassword=await request("/api/account",{method:"DELETE",headers:{"content-type":"application/json",cookie:switchedCookie},body:"{}"});
    assert.equal(deleteWithoutPassword.status,401,"account deletion must require password confirmation");
    const deleted=await request("/api/account",{method:"DELETE",headers:{"content-type":"application/json",cookie:switchedCookie},body:JSON.stringify({password:secondPassword})});
    assert.equal(deleted.status,200,"confirmed account deletion should succeed");
    assert.equal((await deleted.json()).deleted,true);
    database=new Database(dbPath,{readonly:true});
    try {
      assert.equal(database.prepare("SELECT id FROM users WHERE id=?").get(second.id),undefined,"deleted account must be removed from database");
      assert.equal(database.prepare("SELECT id FROM user_data WHERE user_id=?").get(second.id),undefined,"account-owned data must be removed");
      assert.equal(database.prepare("SELECT sid FROM sessions WHERE user_id=?").get(second.id),undefined,"deleted account sessions must be revoked");
      assert.equal(database.prepare("SELECT user_id FROM account_links WHERE user_id=? OR linked_user_id=?").get(second.id,second.id),undefined,"links to deleted account must be removed");
    } finally { database.close(); }
    assert.equal((await jsonRequest("/api/auth/login",{username:secondName,password:secondPassword})).status,401,"deleted account must no longer be able to log in");
    assert.equal((await jsonRequest("/api/auth/login",{username,password})).status,200,"other linked account should remain usable");
    assert.equal((await (await request("/api/auth/me",{headers:{cookie:secondCookie}})).json()).user,null,"deleted account session must no longer authenticate");

    console.log("Passed: SQLite persistence, bcrypt, registration, duplicate protection, login/logout, durable sessions, account linking/switching, password-confirmed deletion, user-data cleanup, link cleanup and deleted-account login denial.");
  } finally {
    if(child.exitCode===null){const exited=new Promise(resolve=>child.once("exit",resolve));child.kill("SIGTERM");await Promise.race([exited,delay(1500)]);if(child.exitCode===null)child.kill("SIGKILL");}
    await fs.rm(dataDir,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
