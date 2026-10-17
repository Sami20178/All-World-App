const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const http = require("node:http");
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
  const providerPort = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const providerBaseUrl = `http://127.0.0.1:${providerPort}`;
  const appleKeyPair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const applePrivateKey = appleKeyPair.privateKey.export({ type: "pkcs8", format: "pem" });
  const providerStub = http.createServer((req,res) => {
    res.setHeader("content-type","application/json");
    if (req.method === "POST" && req.url === "/token") {
      let body = "";
      req.on("data",chunk=>{body+=chunk;});
      req.on("end",()=>{
        const isX = (req.headers.authorization || "") === "Basic " + Buffer.from("test-x:test-secret").toString("base64");
        res.end(JSON.stringify({access_token:isX?"access-x":"access-roblox",token_type:"Bearer",expires_in:900}));
      });
      return;
    }
    if (req.method === "GET" && req.url === "/userinfo") {
      const isX = req.headers.authorization === "Bearer access-x";
      res.end(JSON.stringify(isX?{data:{id:"x-user-100",username:"TestX"}}:{sub:"roblox-user-100",preferred_username:"TestRoblox"}));
      return;
    }
    res.statusCode = 404; res.end(JSON.stringify({error:"not_found"}));
  });
  await new Promise((resolve,reject)=>{providerStub.once("error",reject);providerStub.listen(providerPort,"127.0.0.1",resolve);});
  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, NODE_ENV:"test", PORT:String(port), APP_ORIGIN:"http://localhost:5500", API_PUBLIC_URL:baseUrl, SESSION_SECRET:"ci-only-session-secret-not-used-in-production", DATA_DIR:dataDir, OAUTH_PROVIDERS_JSON:JSON.stringify({roblox:{clientId:"test-roblox",clientSecret:"test-secret",authorizeUrl:providerBaseUrl+"/authorize/roblox",tokenUrl:providerBaseUrl+"/token",userInfoUrl:providerBaseUrl+"/userinfo",scopes:"openid profile",idField:"sub",nameField:"preferred_username",pkce:true},x:{clientId:"test-x",clientSecret:"test-secret",authorizeUrl:providerBaseUrl+"/authorize/x",tokenUrl:providerBaseUrl+"/token",userInfoUrl:providerBaseUrl+"/userinfo",scopes:"users.read tweet.read offline.access",idField:"data.id",nameField:"data.username",clientAuthMethod:"basic",pkce:true},apple:{clientId:"com.example.allworld",teamId:"TESTTEAM123",keyId:"TESTKEY123",privateKey:applePrivateKey,scopes:"name email"}}) },
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
    const providerResponse=await request("/api/auth/providers");
    assert.equal(providerResponse.status,200);
    const providerList=(await providerResponse.json()).providers;
    for (const id of ["discord","spotify","gitlab","twitch"]) {
      assert.ok(providerList.some(provider=>provider.id===id&&!provider.enabled), id+" should be listed but disabled without server credentials");
      assert.equal((await request("/api/auth/oauth/"+id)).status,503, id+" should not pretend to work without credentials");
    }

    for (const id of ["roblox","x"]) {
      assert.ok(providerList.some(provider=>provider.id===id&&provider.enabled), id+" should enable when valid server config is supplied");
      const start=await request("/api/auth/oauth/"+id,{redirect:"manual"});
      assert.equal(start.status,302,id+" should redirect to the configured provider");
      assert.ok(cookieFrom(start),"OAuth flow should be bound to a session cookie");
      const authUrl=new URL(start.headers.get("location"));
      assert.equal(authUrl.searchParams.get("code_challenge_method"),"S256",id+" should use PKCE S256");
      assert.match(authUrl.searchParams.get("code_challenge")||"",/^[A-Za-z0-9_-]{43}$/,"PKCE challenge should be base64url SHA-256");
      assert.equal(authUrl.searchParams.get("state")?.length,64,"OAuth state should be random and session-bound");
    }

    for (const id of ["roblox","x"]) {
      const start=await request("/api/auth/oauth/"+id,{redirect:"manual"});
      const flowCookie=cookieFrom(start);
      const authUrl=new URL(start.headers.get("location"));
      const callback=await request("/api/auth/oauth/"+id+"/callback?code=test-code&state="+encodeURIComponent(authUrl.searchParams.get("state")),{headers:{cookie:flowCookie},redirect:"manual"});
      assert.equal(callback.status,303,id+" callback should finish with a safe frontend redirect");
      assert.match(callback.headers.get("location")||"",/oauth=success/,id+" callback should report success");
      const signedInCookie=cookieFrom(callback);
      assert.ok(signedInCookie,id+" callback should create a new authenticated session");
      const me=await request("/api/auth/me",{headers:{cookie:signedInCookie}});
      assert.equal(me.status,200,id+" OAuth session should authenticate against the API");
      assert.ok((await me.json()).user,id+" OAuth callback should create a local account");
    }

    assert.ok(providerList.some(provider=>provider.id==="apple"&&provider.enabled),"Apple should enable with a valid Services ID and private key");
    const appleStart=await request("/api/auth/oauth/apple",{redirect:"manual"});
    assert.equal(appleStart.status,302);
    const appleUrl=new URL(appleStart.headers.get("location"));
    assert.equal(appleUrl.origin,"https://appleid.apple.com");
    assert.equal(appleUrl.pathname,"/auth/authorize");
    assert.equal(appleUrl.searchParams.get("response_mode"),"form_post");
    assert.match(appleUrl.searchParams.get("nonce")||"",/^[A-Za-z0-9_-]{43}$/,"Apple flow should use a fresh nonce");
    assert.equal(appleUrl.searchParams.get("state")?.length,64,"Apple flow should use session-bound state");
    assert.ok(providerList.some(provider=>provider.id==="supercell"&&!provider.enabled),"Supercell ID should remain unavailable without a documented compatible provider flow");
    assert.equal((await request("/api/auth/oauth/supercell")).status,503);
    const badOrigin=spawnSync(process.execPath,[path.join(__dirname,"..","server.js")],{encoding:"utf8",timeout:5000,env:{...process.env,NODE_ENV:"production",SESSION_SECRET:"R".repeat(64),APP_ORIGIN:"http://example.invalid",PORT:"0",DATA_DIR:path.join(dataDir,"production-guard-origin")}});
    assert.notEqual(badOrigin.status,0,"production should refuse an insecure frontend origin");
    assert.match(badOrigin.stderr,/APP_ORIGIN must be the exact HTTPS frontend origin/,"production origin error should be actionable");
    const placeholderSecret=spawnSync(process.execPath,[path.join(__dirname,"..","server.js")],{encoding:"utf8",timeout:5000,env:{...process.env,NODE_ENV:"production",SESSION_SECRET:"replace-with-a-long-random-secret-before-production",APP_ORIGIN:"https://frontend.example.invalid",PORT:"0",DATA_DIR:path.join(dataDir,"production-guard-secret")}});
    assert.notEqual(placeholderSecret.status,0,"production should refuse placeholder session secrets");
    assert.match(placeholderSecret.stderr,/Set SESSION_SECRET to a real random secret/,"production secret error should be actionable");

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
    await new Promise(resolve=>providerStub.close(()=>resolve()));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
