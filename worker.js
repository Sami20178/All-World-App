const BASE = "https://all-world-app.docc-samisoliman.workers.dev";
const PRIVATE_SETTINGS_HTML = "<!doctype html>\n<html lang=\"de\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex,nofollow,noarchive,nosnippet\"><meta name=\"referrer\" content=\"no-referrer\"><meta name=\"theme-color\" content=\"#05060a\"><title>All World · ChatGPT Plugin</title>\n<style>\n:root{color-scheme:dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;background:#05060a;color:#f5f7ff}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 50% 0,#17224b 0,transparent 48%),#05060a;padding:24px}main{width:min(800px,100%);margin:5vh auto;background:#0d111e;border:1px solid #2a3450;border-radius:22px;padding:clamp(22px,5vw,42px)}.brand{color:#bdc8ff;font-weight:900;letter-spacing:.14em}h1{font-size:clamp(32px,6vw,48px);line-height:1.08;margin:18px 0}p,li{color:#c5cadb;line-height:1.65}.panel{border:1px solid #2c3650;background:#090d17;padding:18px;border-radius:14px;margin:18px 0}.row{display:flex;gap:14px;align-items:flex-start;padding:14px 0;border-bottom:1px solid #222b40}.row:last-child{border-bottom:0}.row input{width:20px;height:20px;margin-top:3px;accent-color:#b8c6ff}.row label{flex:1}.row strong{display:block}.muted{font-size:14px;color:#aab2c8}.btn{border:0;border-radius:10px;padding:13px 18px;background:#dce4ff;color:#111626;font-size:16px;font-weight:850;cursor:pointer}.btn.secondary{background:#171e30;color:#dbe2ff;border:1px solid #384464}.actions{display:flex;gap:12px;flex-wrap:wrap}.warning{border-left:3px solid #e4b45b;padding-left:14px}.status{margin-top:14px;min-height:24px;color:#cbd6ff}.full{border:1px solid #6a5b37;background:#17150f}.full strong{color:#f4d28b}a{color:#bdc8ff}\n</style></head><body><main><div class=\"brand\">✦ ALL WORLD · CHATGPT</div><h1>Plugin-Berechtigungen</h1><p>Diese private Einstellungsansicht wird über einen kurzlebigen, einmaligen Link aus dem MCP-Plugin geöffnet. Sie ist nicht in Suchmaschinen gelistet. Wähle bewusst aus, welche Funktionen freigegeben werden sollen.</p><div class=\"panel\"><div class=\"row\"><input type=\"checkbox\" id=\"health\" checked><label for=\"health\"><strong>API-Status prüfen</strong><span class=\"muted\">Öffentlichen Gesundheitsstatus lesen.</span></label></div><div class=\"row\"><input type=\"checkbox\" id=\"site\" checked><label for=\"site\"><strong>Website- und Repository-Informationen</strong><span class=\"muted\">Öffentliche Projektmetadaten lesen.</span></label></div><div class=\"row\"><input type=\"checkbox\" id=\"account\"><label for=\"account\"><strong>Kontofunktionen (in Vorbereitung)</strong><span class=\"muted\">Anmeldung, Kontoerstellung, Profil und weitere Kontofunktionen sind erst aktiv, wenn sie mit echter Sitzung, Datenbank und serverseitigen Zugriffsprüfungen verbunden sind.</span></label></div><div class=\"row\"><input type=\"checkbox\" id=\"write\"><label for=\"write\"><strong>Änderungen ausführen (in Vorbereitung)</strong><span class=\"muted\">Schreibaktionen benötigen einzeln definierte Berechtigungen und eine Bestätigung vor wichtigen Änderungen.</span></label></div></div><div class=\"panel full\"><strong>Full Connect</strong><p>Ein zukünftiger Gesamtzugriff kann alle unterstützten, ausdrücklich freigegebenen Funktionen umfassen. <b>Abmelden und Konto löschen bleiben ausgeschlossen.</b> Diese Schaltfläche aktiviert derzeit keine nicht implementierten Kontofunktionen.</p><div class=\"row\"><input type=\"checkbox\" id=\"full\"><label for=\"full\"><strong>Full Connect vormerken</strong><span class=\"muted\">Wählt alle derzeit verfügbaren sicheren Funktionen und merkt den Wunsch für spätere unterstützte Funktionen vor.</span></label></div></div><div class=\"actions\"><button class=\"btn\" id=\"save\">Auswahl speichern</button><button class=\"btn secondary\" id=\"reset\" type=\"button\">Auswahl zurücksetzen</button></div><div class=\"status\" id=\"status\" role=\"status\" aria-live=\"polite\"></div><p class=\"muted\">Sicherheitsinfo: Diese Seite speichert nur deine Auswahl für diese Browseransicht. Der aktuelle MCP-Server stellt noch keine persönlichen All-World-Kontofunktionen bereit. Teile diesen Link nicht mit anderen.</p></main><script>\nconst ids=[\"health\",\"site\",\"account\",\"write\",\"full\"];const statusEl=document.getElementById(\"status\");\nfunction applyFull(){if(document.getElementById(\"full\").checked){document.getElementById(\"health\").checked=true;document.getElementById(\"site\").checked=true;document.getElementById(\"account\").checked=true;document.getElementById(\"write\").checked=true;}}\ndocument.getElementById(\"full\").addEventListener(\"change\",applyFull);\ndocument.getElementById(\"save\").addEventListener(\"click\",()=>{const prefs={};ids.forEach(id=>prefs[id]=document.getElementById(id).checked);sessionStorage.setItem(\"allworld-mcp-preferences\",JSON.stringify(prefs));statusEl.textContent=\"Auswahl in dieser Browser-Sitzung gespeichert. Nicht implementierte Funktionen wurden dadurch nicht aktiviert.\";});\ndocument.getElementById(\"reset\").addEventListener(\"click\",()=>{ids.forEach(id=>document.getElementById(id).checked=id===\"health\"||id===\"site\");sessionStorage.removeItem(\"allworld-mcp-preferences\");statusEl.textContent=\"Auswahl zurückgesetzt.\";});\ntry{const saved=JSON.parse(sessionStorage.getItem(\"allworld-mcp-preferences\")||\"null\");if(saved)ids.forEach(id=>document.getElementById(id).checked=!!saved[id]);}catch{}\n</script></body></html>";
const RESOURCE = BASE + "/mcp";
const SCOPES = ["mcp:read"];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
  "Cache-Control": "no-store"
};
const TOOLS = [
  {name:"get_api_health",description:"Read the public health status of the All World API.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
  {name:"get_site_info",description:"Read public All World website and repository metadata.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
  {name:"open_plugin_settings",description:"Create a short-lived, one-time link to the private All World ChatGPT plugin settings page. Return this link to the user to open in a browser.",inputSchema:{type:"object",properties:{},additionalProperties:false}}
];
const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS oauth_clients (client_id TEXT PRIMARY KEY, client_name TEXT NOT NULL, redirect_uris TEXT NOT NULL, created_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS oauth_codes (code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, code_challenge TEXT NOT NULL, scope TEXT NOT NULL, expires_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS oauth_tokens (token_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, scope TEXT NOT NULL, resource TEXT NOT NULL, expires_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS mcp_launches (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)"
];
let schemaReady;
async function init(env) {
  if (!schemaReady) schemaReady = Promise.all(SCHEMA.map(sql => env.OAUTH_DB.prepare(sql).run()));
  try { await schemaReady; } catch (e) { schemaReady = null; throw e; }
}
function json(data,status=200,extra={}) {
  return new Response(JSON.stringify(data),{status,headers:{...CORS,...extra,"Content-Type":"application/json; charset=utf-8"}});
}
function html(body,status=200) {
  return new Response(body,{status,headers:{...CORS,"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"}});
}
function page(title,body) {
  return `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · All World</title><style>body{margin:0;background:#070910;color:#f4f5ff;font:16px system-ui;display:grid;place-items:center;min-height:100vh;padding:20px;box-sizing:border-box}main{max-width:660px;background:#111522;border:1px solid #303750;border-radius:20px;padding:28px}h1{font-size:clamp(28px,5vw,42px)}p,li{line-height:1.65;color:#c9cee0}a{color:#bdc9ff}button,.button{border:0;border-radius:10px;padding:13px 18px;background:#dce4ff;color:#101526;font-weight:800;font-size:16px;cursor:pointer}.muted{color:#f2cb7c}.box{overflow-wrap:anywhere;background:#080b13;padding:12px;border-radius:8px}</style><main><p>✦ ALL WORLD</p><h1>${title}</h1>${body}</main></html>`;
}
function safeRedirect(uri) {
  try { const u=new URL(uri); return u.protocol==="https:" || ((u.hostname==="localhost"||u.hostname==="127.0.0.1"||u.hostname==="[::1]") && u.protocol==="http:"); } catch { return false; }
}
function b64url(bytes) { let s=""; for(const b of bytes)s+=String.fromCharCode(b); return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,""); }
async function sha256(text) { return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text)))); }
function randomToken(n=32) { const b=new Uint8Array(n); crypto.getRandomValues(b); return b64url(b); }
async function form(request) { return new URLSearchParams(await request.text()); }
async function registeredClient(env,id,redirect) {
  const row=await env.OAUTH_DB.prepare("SELECT client_id,client_name,redirect_uris FROM oauth_clients WHERE client_id=?").bind(id).first();
  if(!row) return null;
  let uris=[]; try{uris=JSON.parse(row.redirect_uris)}catch{}
  if(redirect!==undefined && !uris.includes(redirect)) return null;
  return {...row,uris};
}
async function handle(request,env) {
  await init(env);
  const url=new URL(request.url), path=url.pathname;
  if(request.method==="OPTIONS") return new Response(null,{status:204,headers:CORS});
  if(request.method==="GET" && path==="/mcp") {
    return new Response(null,{status:302,headers:{...CORS,Location:BASE+"/mcp/"}});
  }
  if(request.method==="GET" && path==="/mcp/") {
    return html(page("All World MCP Marketplace",`<p>Entdecke und verwalte All-World-MCP-Verbindungen.</p><p><a class="button" href="/mcp/chatgpt">Plugin-Informationen</a></p><p>Der MCP-Endpunkt ist <code>${RESOURCE}</code>. Aktuell verfügbare Tools sind öffentliche Lesezugriffe.</p>`));
  }
  if(request.method==="GET" && path==="/mcp/chatgpt") {
    const launch=url.searchParams.get("launch");
    if(!launch || launch.length>100) return html(page("Plugin-Seite nicht direkt verfügbar",`<p>Diese Einstellungsseite lässt sich nur über einen kurzlebigen Link aus dem All-World-MCP-Plugin öffnen.</p><p>Rufe in ChatGPT das Tool <code>open_plugin_settings</code> auf, um einen einmaligen Zugriffslink zu erhalten.</p><meta name="robots" content="noindex,nofollow,noarchive">`),404);
    const launchHash=await sha256(launch);
    const row=await env.OAUTH_DB.prepare("DELETE FROM mcp_launches WHERE token_hash=? AND expires_at>? RETURNING token_hash").bind(launchHash,Date.now()).first();
    if(!row) return html(page("Link abgelaufen",`<p>Dieser einmalige Link wurde bereits verwendet oder ist abgelaufen. Öffne das Plugin in ChatGPT und fordere einen neuen Link an.</p>`),410);
    const headers=new Headers({"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store, private","X-Robots-Tag":"noindex, nofollow, noarchive, nosnippet","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'self' 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"});
    return new Response(PRIVATE_SETTINGS_HTML,{status:200,headers});
  }
  if(request.method==="GET" && (path==="/.well-known/oauth-protected-resource" || path==="/.well-known/oauth-protected-resource/mcp" || path==="/mcp/.well-known/oauth-protected-resource")) {
    return json({resource:RESOURCE,authorization_servers:[BASE],scopes_supported:SCOPES,bearer_methods_supported:["header"],resource_documentation:BASE+"/mcp"});
  }
  if(request.method==="GET" && path==="/.well-known/oauth-authorization-server") {
    return json({issuer:BASE,authorization_endpoint:BASE+"/oauth/authorize",token_endpoint:BASE+"/oauth/token",registration_endpoint:BASE+"/oauth/register",response_types_supported:["code"],response_modes_supported:["query"],grant_types_supported:["authorization_code"],code_challenge_methods_supported:["S256"],token_endpoint_auth_methods_supported:["none"],scopes_supported:SCOPES,client_id_metadata_document_supported:false});
  }
  if(request.method==="POST" && path==="/oauth/register") {
    let body; try{body=await request.json()}catch{return json({error:"invalid_client_metadata"},400)}
    const uris=body.redirect_uris;
    if(!Array.isArray(uris)||!uris.length||uris.length>10||uris.some(x=>typeof x!=="string"||!safeRedirect(x))) return json({error:"invalid_redirect_uri",error_description:"Only exact HTTPS or loopback redirect URIs are allowed."},400);
    const id="aw_"+randomToken(24), name=typeof body.client_name==="string"?body.client_name.slice(0,100):"MCP Client";
    await env.OAUTH_DB.prepare("INSERT INTO oauth_clients(client_id,client_name,redirect_uris,created_at) VALUES(?,?,?,?)").bind(id,name,JSON.stringify([...new Set(uris)]),Date.now()).run();
    return json({client_id:id,client_name:name,redirect_uris:[...new Set(uris)],grant_types:["authorization_code"],response_types:["code"],token_endpoint_auth_method:"none",scope:SCOPES.join(" ")},201);
  }
  if(request.method==="GET" && path==="/oauth/authorize") {
    const p=url.searchParams, client=await registeredClient(env,p.get("client_id"),p.get("redirect_uri"));
    const redirect=p.get("redirect_uri"), challenge=p.get("code_challenge"), state=p.get("state");
    if(p.get("response_type")!=="code"||!client||!safeRedirect(redirect)||p.get("code_challenge_method")!=="S256"||!/^[A-Za-z0-9_-]{43,128}$/.test(challenge||"")||!state||state.length>500) return html(page("OAuth-Anfrage abgelehnt","<p>Die Anfrage ist unvollständig oder ungültig. Bitte starte die Verbindung erneut in ChatGPT.</p>"),400);
    const scope=(p.get("scope")||"mcp:read").split(/\s+/);
    if(scope.some(s=>!SCOPES.includes(s))) return html(page("Berechtigung nicht verfügbar","<p>Diese Verbindung darf nur öffentliche, schreibgeschützte Werkzeuge verwenden.</p>"),400);
    const fields={client_id:client.client_id,redirect_uri:redirect,code_challenge:challenge,state,scope:scope.join(" ")};
    const hidden=Object.entries(fields).map(([k,v])=>`<input type="hidden" name="${k}" value="${String(v).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;")}">`).join("");
    return html(page("Zugriff für ChatGPT bestätigen",`<p><strong>${client.client_name.replace(/[&<>"]/g,"")}</strong> möchte die öffentlichen All-World-Werkzeuge nutzen.</p><ul><li>API-Gesundheitsstatus lesen</li><li>Öffentliche Website- und Repository-Informationen lesen</li></ul><p class="muted">Kein Zugriff auf Anmeldung, Konten oder private Daten.</p><form method="post" action="/oauth/authorize">${hidden}<button type="submit">Öffentlichen Lesezugriff erlauben</button></form><p>Du kannst diese Seite schließen, um abzulehnen.</p>`));
  }
  if(request.method==="POST" && path==="/oauth/authorize") {
    const p=await form(request), client=await registeredClient(env,p.get("client_id"),p.get("redirect_uri"));
    const redirect=p.get("redirect_uri"), challenge=p.get("code_challenge"), state=p.get("state");
    if(!client||!safeRedirect(redirect)||!p.get("state")||!/^[A-Za-z0-9_-]{43,128}$/.test(challenge||"")) return html(page("Anfrage abgelehnt","<p>OAuth-Anfrage ungültig. Bitte neu verbinden.</p>"),400);
    const code=randomToken(32), expires=Date.now()+120000;
    await env.OAUTH_DB.prepare("INSERT INTO oauth_codes(code_hash,client_id,redirect_uri,code_challenge,scope,expires_at) VALUES(?,?,?,?,?,?)").bind(await sha256(code),client.client_id,redirect,challenge,"mcp:read",expires).run();
    const dest=new URL(redirect); dest.searchParams.set("code",code); dest.searchParams.set("state",state);
    return new Response(null,{status:302,headers:{...CORS,Location:dest.toString(),"Cache-Control":"no-store"}});
  }
  if(request.method==="POST" && path==="/oauth/token") {
    const p=await form(request);
    if(p.get("grant_type")!=="authorization_code") return json({error:"unsupported_grant_type"},400);
    const client=await registeredClient(env,p.get("client_id"),p.get("redirect_uri"));
    if(!client||!p.get("code")||!p.get("code_verifier")) return json({error:"invalid_grant"},400);
    const codeHash=await sha256(p.get("code"));
    const verifierChallenge=await sha256(p.get("code_verifier"));
    const code=await env.OAUTH_DB.prepare("DELETE FROM oauth_codes WHERE code_hash=? AND client_id=? AND redirect_uri=? AND code_challenge=? AND expires_at>? RETURNING code_hash,scope").bind(codeHash,client.client_id,p.get("redirect_uri"),verifierChallenge,Date.now()).first();
    if(!code) return json({error:"invalid_grant"},400);
    const access=randomToken(32), expires=Date.now()+3600000;
    await env.OAUTH_DB.prepare("INSERT INTO oauth_tokens(token_hash,client_id,scope,resource,expires_at) VALUES(?,?,?,?,?)").bind(await sha256(access),client.client_id,code.scope,RESOURCE,expires).run();
    return json({access_token:access,token_type:"Bearer",expires_in:3600,scope:code.scope,resource:RESOURCE});
  }
  if(path==="/mcp") {
    if(request.method!=="POST") return json({jsonrpc:"2.0",error:{code:-32000,message:"POST required for MCP JSON-RPC requests"},id:null},405);
    const auth=request.headers.get("authorization")||"", match=auth.match(/^Bearer\s+(.+)$/i);
    if(!match) return json({error:"unauthorized",error_description:"A valid OAuth access token is required."},401,{"WWW-Authenticate":'Bearer resource_metadata="'+BASE+'/.well-known/oauth-protected-resource", scope="mcp:read"'});
    const token=await env.OAUTH_DB.prepare("SELECT scope,resource,expires_at FROM oauth_tokens WHERE token_hash=?").bind(await sha256(match[1])).first();
    if(!token||token.expires_at<=Date.now()||token.resource!==RESOURCE||!token.scope.split(/\s+/).includes("mcp:read")) return json({error:"invalid_token"},401,{"WWW-Authenticate":'Bearer resource_metadata="'+BASE+'/.well-known/oauth-protected-resource"'});
    let body; try{body=await request.json()}catch{return json({jsonrpc:"2.0",error:{code:-32700,message:"Parse error"},id:null},400)}
    const id=Object.prototype.hasOwnProperty.call(body,"id")?body.id:null, method=body.method, params=body.params||{};
    if(method==="notifications/initialized"||method==="notifications/cancelled") return new Response(null,{status:202,headers:CORS});
    if(method==="initialize") return json({jsonrpc:"2.0",id,result:{protocolVersion:"2025-03-26",capabilities:{tools:{listChanged:false}},serverInfo:{name:"all-world-api",version:"1.1.0"},instructions:"Read-only public All World tools only. No account or private data access."}});
    if(method==="ping") return json({jsonrpc:"2.0",id,result:{}});
    if(method==="tools/list") return json({jsonrpc:"2.0",id,result:{tools:TOOLS}});
    if(method==="tools/call") {
      if(Object.keys(params.arguments||{}).length) return json({jsonrpc:"2.0",id,error:{code:-32602,message:"These read-only tools take no arguments"}},400);
      let data;
      if(params.name==="get_api_health") data={ok:true,service:"All World API",status:"healthy",endpoints:["/api/plugin/health","/api/plugin/site-info"]};
      else if(params.name==="get_site_info") data={name:"All World",website:"https://all-world-app-source-code.docc-samisoliman.workers.dev/",source_repository:"https://github.com/Sami20178/All-World-App-Source-Code-",node_server_repository:"https://github.com/Sami20178/All-World-App",api_version:"1.1.0",capabilities:["public-site-metadata","health-check"],authentication:"OAuth required for MCP; tools are public read-only"};
      else if(params.name==="open_plugin_settings") {
        const launch=randomToken(32), expires=Date.now()+300000;
        await env.OAUTH_DB.prepare("INSERT INTO mcp_launches(token_hash,expires_at) VALUES(?,?)").bind(await sha256(launch),expires).run();
        data={url:BASE+"/mcp/chatgpt?launch="+launch,expires_in_seconds:300,one_time:true,instructions:"Open this URL in a browser. The link expires in 5 minutes and works once. Current account-management settings are a preview; unsupported actions are not enabled."};
      }
      else return json({jsonrpc:"2.0",id,error:{code:-32602,message:"Unknown tool name"}},400);
      return json({jsonrpc:"2.0",id,result:{content:[{type:"text",text:JSON.stringify(data)}],structuredContent:data}});
    }
    return json({jsonrpc:"2.0",id,error:{code:-32601,message:"Method not found"}},400);
  }
  if(request.method==="GET"&&path==="/api/plugin/health") return json({ok:true,service:"All World API",status:"healthy",endpoints:["/api/plugin/health","/api/plugin/site-info","/mcp","/mcp/chatgpt"]});
  if(request.method==="GET"&&path==="/api/plugin/site-info") return json({name:"All World",website:"https://all-world-app-source-code.docc-samisoliman.workers.dev/",source_repository:"https://github.com/Sami20178/All-World-App-Source-Code-",node_server_repository:"https://github.com/Sami20178/All-World-App",api_version:"1.1.0",capabilities:["public-site-metadata","health-check","mcp-oauth-read-only"],mcp_endpoint:RESOURCE,mcp_connect_page:BASE+"/mcp",authentication:"OAuth required for MCP; tools are public read-only"});
  if(request.method!=="GET") return json({error:"Method not allowed"},405);
  return json({error:"Not found"},404);
}
export default { async fetch(request,env) { try { return await handle(request,env); } catch(e) { return json({error:"internal_error",message:"All World MCP service is temporarily unavailable."},500); } } };
