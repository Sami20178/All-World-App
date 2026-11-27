const GROUP_RANKS = ["member","verified","star_creator","creator","moderator","admin","admin_star_plus","owner"];
const GROUP_RANK_SCORES = {member:10,verified:20,star_creator:30,creator:40,moderator:50,admin:60,admin_star_plus:70,owner:80};
function normalizedRank(user) {
  const role = String(user?.role || "member").toLowerCase();
  return GROUP_RANKS.includes(role) ? role : "member";
}
function rankAllowed(user, minimum) {
  return GROUP_RANKS.includes(minimum) && GROUP_RANK_SCORES[normalizedRank(user)] >= GROUP_RANK_SCORES[minimum];
}
async function groupPinHash(crypto, env, salt, pin) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(env.RATE_LIMIT_SECRET || "")), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(salt + ":" + pin));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,"0")).join("");
}

export async function handleMessengerRoute({ request, env, db, userId, consumeRateLimit, readJson, json, crypto }) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/messenger/")) return null;

  if (request.method === "GET" && path === "/api/messenger/invitations") {
    const rows = await db.prepare(
      "SELECT i.id,i.status,i.created_at,i.updated_at,i.conversation_id,i.sender_id,i.receiver_id,s.username AS sender_username,r.username AS receiver_username " +
      "FROM messenger_invitations i JOIN users s ON s.id=i.sender_id JOIN users r ON r.id=i.receiver_id " +
      "WHERE i.sender_id=? OR i.receiver_id=? ORDER BY i.created_at DESC LIMIT 60"
    ).bind(userId,userId).all();
    const invitations = (rows.results || []).map(row => ({
      id: row.id, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
      conversationId: row.conversation_id, direction: row.receiver_id === userId ? "incoming" : "outgoing",
      username: row.receiver_id === userId ? row.sender_username : row.receiver_username
    }));
    return json(request, env, { invitations });
  }

  if (request.method === "POST" && path === "/api/messenger/invitations") {
    let body;
    try { body = await readJson(request); } catch { return json(request, env, { error: "Ungültige Anfrage." }, 400); }
    const username = typeof body.username === "string" ? body.username.trim() : "";
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(username)) return json(request, env, { error: "Gib einen gültigen All-World-Benutzernamen ein." }, 400);
    if (!(await consumeRateLimit(request, env, "messenger-invite", userId, 20))) return json(request, env, { error: "Zu viele Einladungen. Bitte warte kurz." }, 429);
    const target = await db.prepare("SELECT id,username FROM users WHERE username_normalized=?").bind(username.toLowerCase()).first();
    if (!target) return json(request, env, { error: "Dieses All-World-Konto wurde nicht gefunden." }, 404);
    if (target.id === userId) return json(request, env, { error: "Du kannst dich nicht selbst einladen." }, 400);
    const pair = [userId,target.id].sort().join(":");
    const existingChat = await db.prepare("SELECT id FROM messenger_conversations WHERE dm_key=?").bind(pair).first();
    if (existingChat) return json(request, env, { error: "Ihr seid bereits verbunden.", conversationId: existingChat.id }, 409);
    const reverse = await db.prepare("SELECT id FROM messenger_invitations WHERE sender_id=? AND receiver_id=? AND status='pending'").bind(target.id,userId).first();
    if (reverse) return json(request, env, { error: "Diese Person hat dir bereits eine Einladung geschickt. Du findest sie unter Einladungen.", incomingInvitationId: reverse.id }, 409);
    const pending = await db.prepare("SELECT id FROM messenger_invitations WHERE sender_id=? AND receiver_id=? AND status='pending'").bind(userId,target.id).first();
    if (pending) return json(request, env, { error: "Deine Einladung wurde bereits gesendet.", invitationId: pending.id }, 200);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await db.prepare("INSERT INTO messenger_invitations(id,sender_id,receiver_id,status,created_at,updated_at) VALUES(?,?,?,'pending',?,?)")
      .bind(id,userId,target.id,now,now).run();
    return json(request, env, { invitation: { id, username: target.username, status: "pending", createdAt: now } }, 201);
  }

  const respondMatch = path.match(/^\/api\/messenger\/invitations\/([A-Za-z0-9-]+)\/respond$/);
  if (request.method === "POST" && respondMatch) {
    let body;
    try { body = await readJson(request); } catch { return json(request, env, { error: "Ungültige Anfrage." }, 400); }
    const action = body.action;
    if (action !== "accept" && action !== "decline") return json(request, env, { error: "Wähle Annehmen oder Ablehnen." }, 400);
    const invitation = await db.prepare("SELECT id,sender_id,receiver_id,status FROM messenger_invitations WHERE id=?").bind(respondMatch[1]).first();
    if (!invitation || invitation.receiver_id !== userId) return json(request, env, { error: "Einladung nicht gefunden." }, 404);
    if (invitation.status !== "pending") return json(request, env, { error: "Diese Einladung wurde bereits beantwortet." }, 409);
    const now = new Date().toISOString();
    if (action === "decline") {
      await db.prepare("UPDATE messenger_invitations SET status='declined',updated_at=? WHERE id=? AND receiver_id=? AND status='pending'")
        .bind(now,invitation.id,userId).run();
      return json(request, env, { ok: true, status: "declined" });
    }
    const dmKey = [invitation.sender_id,invitation.receiver_id].sort().join(":");
    const conversationId = crypto.randomUUID();
    await db.prepare("INSERT OR IGNORE INTO messenger_conversations(id,kind,dm_key,title,created_by,created_at,updated_at) VALUES(?,'direct',?,NULL,?,?,?)")
      .bind(conversationId,dmKey,userId,now,now).run();
    const conversation = await db.prepare("SELECT id FROM messenger_conversations WHERE dm_key=?").bind(dmKey).first();
    await db.prepare("INSERT OR IGNORE INTO messenger_participants(conversation_id,user_id,joined_at) VALUES(?,?,?)")
      .bind(conversation.id,invitation.sender_id,now).run();
    await db.prepare("INSERT OR IGNORE INTO messenger_participants(conversation_id,user_id,joined_at) VALUES(?,?,?)")
      .bind(conversation.id,invitation.receiver_id,now).run();
    await db.prepare("UPDATE messenger_invitations SET status='accepted',conversation_id=?,updated_at=? WHERE id=? AND receiver_id=? AND status='pending'")
      .bind(conversation.id,now,invitation.id,userId).run();
    return json(request, env, { ok: true, status: "accepted", conversationId: conversation.id });
  }


  if (request.method === "POST" && path === "/api/messenger/groups") {
    let body;
    try { body = await readJson(request); } catch { return json(request, env, { error: "Ungültige Gruppenchat-Daten." }, 400); }
    const title = typeof body.title === "string" ? body.title.trim().replace(/\s+/g," ").slice(0,60) : "";
    const visibility = body.visibility === "public" ? "public" : body.visibility === "private" ? "private" : "";
    const pin = typeof body.pin === "string" ? body.pin.trim() : "";
    const minRank = typeof body.minRank === "string" ? body.minRank : "member";
    if (title.length < 2) return json(request, env, { error: "Der Chatname muss mindestens 2 Zeichen lang sein." }, 400);
    if (!visibility) return json(request, env, { error: "Wähle Privat oder Öffentlich." }, 400);
    if (!/^[0-9]{4,8}$/.test(pin)) return json(request, env, { error: "Die PIN muss aus 4 bis 8 Ziffern bestehen." }, 400);
    if (!GROUP_RANKS.includes(minRank)) return json(request, env, { error: "Dieser Rang ist nicht gültig." }, 400);
    const creator = await db.prepare("SELECT id,username,role FROM users WHERE id=?").bind(userId).first();
    if (!creator || !rankAllowed(creator,minRank)) return json(request, env, { error: "Dein Rang reicht nicht aus, um diesen Mindest-Rang festzulegen." }, 403);
    if (!(await consumeRateLimit(request, env, "messenger-group-create", userId, 8))) return json(request, env, { error: "Zu viele neue Chats. Bitte warte kurz." }, 429);
    const now = new Date().toISOString(), id = crypto.randomUUID(), salt = crypto.randomUUID();
    const pinHash = await groupPinHash(crypto,env,salt,pin);
    await db.prepare("INSERT INTO messenger_conversations(id,kind,dm_key,title,created_by,created_at,updated_at) VALUES(?,'group',NULL,?,?,?,?)")
      .bind(id,title,userId,now,now).run();
    await db.prepare("INSERT INTO messenger_group_settings(conversation_id,visibility,pin_salt,pin_hash,min_rank,created_at) VALUES(?,?,?,?,?,?)")
      .bind(id,visibility,salt,pinHash,minRank,now).run();
    await db.prepare("INSERT INTO messenger_participants(conversation_id,user_id,joined_at) VALUES(?,?,?)").bind(id,userId,now).run();
    return json(request, env, { chat: { id,title,kind:"group",visibility,minRank,createdAt:now } }, 201);
  }

  if (request.method === "GET" && path === "/api/messenger/groups/discover") {
    const rows = await db.prepare(
      "SELECT c.id,c.title,c.created_at,s.visibility,s.min_rank,u.username AS owner_username," +
      "(SELECT COUNT(*) FROM messenger_participants p WHERE p.conversation_id=c.id) AS member_count," +
      "(SELECT r.status FROM messenger_group_requests r WHERE r.conversation_id=c.id AND r.requester_id=? LIMIT 1) AS request_status " +
      "FROM messenger_conversations c JOIN messenger_group_settings s ON s.conversation_id=c.id JOIN users u ON u.id=c.created_by " +
      "WHERE c.kind='group' AND s.visibility='public' AND NOT EXISTS(SELECT 1 FROM messenger_participants p WHERE p.conversation_id=c.id AND p.user_id=?) " +
      "ORDER BY c.updated_at DESC LIMIT 50"
    ).bind(userId,userId).all();
    return json(request, env, { groups:(rows.results||[]).map(row=>({id:row.id,title:row.title,visibility:row.visibility,minRank:row.min_rank,ownerUsername:row.owner_username,memberCount:row.member_count,requestStatus:row.request_status||null,createdAt:row.created_at})) });
  }

  const groupRequestMatch = path.match(new RegExp("^/api/messenger/groups/([A-Za-z0-9-]+)/request$"));
  if (request.method === "POST" && groupRequestMatch) {
    let body;
    try { body = await readJson(request); } catch { return json(request, env, { error: "Ungültige Beitrittsanfrage." }, 400); }
    const pin = typeof body.pin === "string" ? body.pin.trim() : "";
    if (!/^[0-9]{4,8}$/.test(pin)) return json(request, env, { error: "Gib die 4- bis 8-stellige Chat-PIN ein." }, 400);
    if (!(await consumeRateLimit(request, env, "messenger-group-join", userId, 8))) return json(request, env, { error: "Zu viele Versuche. Bitte warte kurz." }, 429);
    const group = await db.prepare("SELECT c.id,c.title,c.created_by,s.visibility,s.pin_salt,s.pin_hash,s.min_rank FROM messenger_conversations c JOIN messenger_group_settings s ON s.conversation_id=c.id WHERE c.id=? AND c.kind='group'").bind(groupRequestMatch[1]).first();
    if (!group || (group.visibility !== "public" && group.created_by === userId)) return json(request, env, { error: "Dieser Gruppenchat wurde nicht gefunden." }, 404);
    const member = await db.prepare("SELECT 1 AS ok FROM messenger_participants WHERE conversation_id=? AND user_id=?").bind(group.id,userId).first();
    if (member) return json(request, env, { error: "Du bist bereits Mitglied dieses Chats." }, 409);
    const applicant = await db.prepare("SELECT id,username,role FROM users WHERE id=?").bind(userId).first();
    if (!rankAllowed(applicant,group.min_rank)) return json(request, env, { error: "Dein Rang reicht für diesen Chat nicht aus. Erforderlich: "+group.min_rank }, 403);
    const digest = await groupPinHash(crypto,env,group.pin_salt,pin);
    if (digest !== group.pin_hash) return json(request, env, { error: "Die PIN ist falsch." }, 403);
    const now = new Date().toISOString(), requestId = crypto.randomUUID();
    await db.prepare("INSERT INTO messenger_group_requests(id,conversation_id,requester_id,status,created_at,updated_at) VALUES(?,?,?,'pending',?,?) ON CONFLICT(conversation_id,requester_id) DO UPDATE SET status='pending',updated_at=excluded.updated_at")
      .bind(requestId,group.id,userId,now,now).run();
    const saved = await db.prepare("SELECT id FROM messenger_group_requests WHERE conversation_id=? AND requester_id=?").bind(group.id,userId).first();
    return json(request, env, { request:{id:saved.id,conversationId:group.id,title:group.title,status:"pending"} }, 201);
  }

  if (request.method === "GET" && path === "/api/messenger/group-requests") {
    const rows = await db.prepare(
      "SELECT r.id,r.conversation_id,r.requester_id,r.status,r.created_at,c.title,c.created_by,u.username AS requester_username " +
      "FROM messenger_group_requests r JOIN messenger_conversations c ON c.id=r.conversation_id JOIN users u ON u.id=r.requester_id " +
      "WHERE (c.created_by=? AND r.status='pending') OR r.requester_id=? ORDER BY r.created_at DESC LIMIT 80"
    ).bind(userId,userId).all();
    return json(request, env, { requests:(rows.results||[]).map(row=>({id:row.id,conversationId:row.conversation_id,title:row.title,username:row.requester_username,status:row.status,direction:row.requester_id===userId?"outgoing":"incoming",createdAt:row.created_at})) });
  }

  const groupRespondMatch = path.match(new RegExp("^/api/messenger/group-requests/([A-Za-z0-9-]+)/respond$"));
  if (request.method === "POST" && groupRespondMatch) {
    let body;
    try { body = await readJson(request); } catch { return json(request, env, { error: "Ungültige Antwort." }, 400); }
    if (body.action !== "accept" && body.action !== "decline") return json(request, env, { error: "Wähle Annehmen oder Ablehnen." }, 400);
    const row = await db.prepare("SELECT r.id,r.conversation_id,r.requester_id,r.status,c.created_by,s.min_rank FROM messenger_group_requests r JOIN messenger_conversations c ON c.id=r.conversation_id JOIN messenger_group_settings s ON s.conversation_id=c.id WHERE r.id=?").bind(groupRespondMatch[1]).first();
    if (!row || row.created_by !== userId) return json(request, env, { error: "Anfrage nicht gefunden." }, 404);
    if (row.status !== "pending") return json(request, env, { error: "Diese Anfrage wurde bereits beantwortet." }, 409);
    const now = new Date().toISOString();
    if (body.action === "accept") {
      const applicant = await db.prepare("SELECT id,username,role FROM users WHERE id=?").bind(row.requester_id).first();
      if (!rankAllowed(applicant,row.min_rank)) return json(request, env, { error: "Der Rang der Person reicht nicht mehr aus." }, 403);
      await db.prepare("INSERT OR IGNORE INTO messenger_participants(conversation_id,user_id,joined_at) VALUES(?,?,?)").bind(row.conversation_id,row.requester_id,now).run();
    }
    await db.prepare("UPDATE messenger_group_requests SET status=?,updated_at=? WHERE id=? AND status='pending'").bind(body.action==="accept"?"accepted":"declined",now,row.id).run();
    return json(request, env, { ok:true,status:body.action==="accept"?"accepted":"declined",conversationId:row.conversation_id });
  }

  if (request.method === "GET" && path === "/api/messenger/chats") {
    const rows = await db.prepare(
      "SELECT c.id,c.kind,c.title,c.updated_at,s.visibility,s.min_rank," +
      "(SELECT u.username FROM messenger_participants p JOIN users u ON u.id=p.user_id WHERE p.conversation_id=c.id AND p.user_id<>? LIMIT 1) AS other_username," +
      "(SELECT m.body FROM messenger_messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message," +
      "(SELECT m.created_at FROM messenger_messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at " +
      "FROM messenger_conversations c JOIN messenger_participants mine ON mine.conversation_id=c.id AND mine.user_id=? LEFT JOIN messenger_group_settings s ON s.conversation_id=c.id ORDER BY c.updated_at DESC LIMIT 100"
    ).bind(userId,userId).all();
    return json(request, env, { chats: (rows.results || []).map(row => ({
      id: row.id, kind: row.kind, title: row.title || row.other_username || "Gruppe", visibility: row.visibility || null, minRank: row.min_rank || "member",
      updatedAt: row.updated_at, lastMessage: row.last_message || "", lastMessageAt: row.last_message_at || null
    })) });
  }

  const messagesMatch = path.match(/^\/api\/messenger\/chats\/([A-Za-z0-9-]+)\/messages$/);
  if (messagesMatch) {
    const conversationId = messagesMatch[1];
    const member = await db.prepare("SELECT 1 AS ok FROM messenger_participants WHERE conversation_id=? AND user_id=?").bind(conversationId,userId).first();
    if (!member) return json(request, env, { error: "Chat nicht gefunden." }, 404);
    if (request.method === "GET") {
      const rows = await db.prepare("SELECT m.id,m.sender_id,m.body,m.created_at,a.id AS attachment_id,a.file_name,a.content_type,a.size_bytes FROM messenger_messages m LEFT JOIN messenger_attachments a ON a.message_id=m.id WHERE m.conversation_id=? ORDER BY m.created_at DESC LIMIT 80")
        .bind(conversationId).all();
      const messages = (rows.results || []).reverse().map(row => ({
        id: row.id, senderId: row.sender_id, text: row.body, createdAt: row.created_at, mine: row.sender_id === userId,
        attachment: row.attachment_id ? { id: row.attachment_id, fileName: row.file_name, contentType: row.content_type, sizeBytes: row.size_bytes } : null
      }));
      await db.prepare("UPDATE messenger_participants SET last_read_at=? WHERE conversation_id=? AND user_id=?")
        .bind(new Date().toISOString(),conversationId,userId).run();
      return json(request, env, { messages });
    }
    if (request.method === "POST") {
      let body;
      try { body = await readJson(request); } catch { return json(request, env, { error: "Ungültige Nachricht." }, 400); }
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text || text.length > 4000) return json(request, env, { error: "Nachrichten müssen zwischen 1 und 4.000 Zeichen lang sein." }, 400);
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      await db.prepare("INSERT INTO messenger_messages(id,conversation_id,sender_id,body,created_at) VALUES(?,?,?,?,?)")
        .bind(id,conversationId,userId,text,now).run();
      await db.prepare("UPDATE messenger_conversations SET updated_at=? WHERE id=?").bind(now,conversationId).run();
      return json(request, env, { message: { id, senderId: userId, text, createdAt: now, mine: true } }, 201);
    }
  }


  // Attachments are stored as binary chunks in the existing D1 database.
  const uploadMatch = path.match(/^\/api\/messenger\/chats\/([A-Za-z0-9-]+)\/attachments$/);
  if (uploadMatch && request.method === "POST") {
    const conversationId = uploadMatch[1];
    const member = await db.prepare("SELECT 1 AS ok FROM messenger_participants WHERE conversation_id=? AND user_id=?").bind(conversationId,userId).first();
    if (!member) return json(request, env, { error: "Chat nicht gefunden." }, 404);
    if (!(await consumeRateLimit(request, env, "messenger-upload", userId, 20))) return json(request, env, { error: "Zu viele Uploads. Bitte warte kurz." }, 429);
    let form;
    try { form = await request.formData(); } catch { return json(request, env, { error: "Upload konnte nicht gelesen werden." }, 400); }
    const file = form.get("file");
    if (!file || typeof file.arrayBuffer !== "function") return json(request, env, { error: "Keine Datei ausgewählt." }, 400);
    if (file.size < 1 || file.size > 3 * 1024 * 1024) return json(request, env, { error: "Dateien dürfen maximal 3 MB groß sein." }, 413);
    const safeName = String(file.name || "Datei").replace(/[\/\\\r\n\0]/g, "_").slice(0, 180) || "Datei";
    const contentType = String(file.type || "application/octet-stream").slice(0, 120);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const attachmentId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const now = new Date().toISOString();
    const chunkSize = 64 * 1024;
    const statements = [];
    for (let offset = 0, index = 0; offset < bytes.length; offset += chunkSize, index++) {
      statements.push(db.prepare("INSERT INTO messenger_attachment_chunks(attachment_id,chunk_index,chunk_data) VALUES(?,?,?)")
        .bind(attachmentId,index,bytes.slice(offset,Math.min(offset+chunkSize,bytes.length))));
    }
    try {
      await db.prepare("INSERT INTO messenger_messages(id,conversation_id,sender_id,body,created_at) VALUES(?,?,?,?,?)")
        .bind(messageId,conversationId,userId,"📎 "+safeName,now).run();
      await db.prepare("INSERT INTO messenger_attachments(id,conversation_id,message_id,uploader_id,file_name,content_type,size_bytes,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .bind(attachmentId,conversationId,messageId,userId,safeName,contentType,bytes.length,now).run();
      if (statements.length) await db.batch(statements);
      await db.prepare("UPDATE messenger_conversations SET updated_at=? WHERE id=?").bind(now,conversationId).run();
    } catch (error) {
      await db.prepare("DELETE FROM messenger_attachment_chunks WHERE attachment_id=?").bind(attachmentId).run().catch(()=>{});
      await db.prepare("DELETE FROM messenger_attachments WHERE id=?").bind(attachmentId).run().catch(()=>{});
      await db.prepare("DELETE FROM messenger_messages WHERE id=?").bind(messageId).run().catch(()=>{});
      throw error;
    }
    return json(request, env, { attachment: { id: attachmentId, messageId, fileName: safeName, contentType, sizeBytes: bytes.length, createdAt: now, mine: true } }, 201);
  }

  const attachmentMatch = path.match(/^\/api\/messenger\/attachments\/([A-Za-z0-9-]+)$/);
  if (attachmentMatch && request.method === "GET") {
    const attachment = await db.prepare("SELECT id,conversation_id,message_id,file_name,content_type,size_bytes,created_at FROM messenger_attachments WHERE id=?").bind(attachmentMatch[1]).first();
    if (!attachment) return json(request, env, { error: "Datei nicht gefunden." }, 404);
    const member = await db.prepare("SELECT 1 AS ok FROM messenger_participants WHERE conversation_id=? AND user_id=?").bind(attachment.conversation_id,userId).first();
    if (!member) return json(request, env, { error: "Datei nicht gefunden." }, 404);
    const chunks = await db.prepare("SELECT chunk_data FROM messenger_attachment_chunks WHERE attachment_id=? ORDER BY chunk_index ASC").bind(attachment.id).all();
    const parts = (chunks.results || []).map(row => row.chunk_data instanceof Uint8Array ? row.chunk_data : new Uint8Array(row.chunk_data || []));
    const bytes = new Uint8Array(parts.reduce((sum,part)=>sum+part.length,0));
    let offset = 0;
    for (const part of parts) { bytes.set(part,offset); offset += part.length; }
    let binary = "";
    for (let i=0;i<bytes.length;i+=0x8000) binary += String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));
    return json(request, env, { attachment: { id: attachment.id, fileName: attachment.file_name, contentType: attachment.content_type, sizeBytes: attachment.size_bytes, base64: btoa(binary) } });
  }

  if (request.method === "POST" && path === "/api/messenger/calls") {
    let body;
    try { body = await readJson(request); } catch { return json(request, env, { error: "Ungültiger Anruf." }, 400); }
    const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
    const mediaType = body.mediaType === "video" ? "video" : body.mediaType === "audio" ? "audio" : "";
    const offerSdp = typeof body.offerSdp === "string" ? body.offerSdp : "";
    if (!conversationId || !mediaType || !offerSdp || offerSdp.length > 20000) return json(request, env, { error: "Anrufdaten sind unvollständig." }, 400);
    const member = await db.prepare("SELECT 1 AS ok FROM messenger_participants WHERE conversation_id=? AND user_id=?").bind(conversationId,userId).first();
    if (!member) return json(request, env, { error: "Chat nicht gefunden." }, 404);
    const peer = await db.prepare("SELECT p.user_id,u.username FROM messenger_participants p JOIN users u ON u.id=p.user_id WHERE p.conversation_id=? AND p.user_id<>? LIMIT 1").bind(conversationId,userId).first();
    if (!peer) return json(request, env, { error: "Für Anrufe wird ein Einzelchat benötigt." }, 400);
    const now = new Date().toISOString(), id = crypto.randomUUID();
    await db.prepare("UPDATE messenger_calls SET status='missed',updated_at=?,ended_at=? WHERE conversation_id=? AND status='ringing' AND created_at<?")
      .bind(now,now,conversationId,new Date(Date.now()-120000).toISOString()).run();
    const active = await db.prepare("SELECT id FROM messenger_calls WHERE conversation_id=? AND status IN ('ringing','accepted')").bind(conversationId).first();
    if (active) return json(request, env, { error: "In diesem Chat läuft bereits ein Anruf." }, 409);
    await db.prepare("INSERT INTO messenger_calls(id,conversation_id,caller_id,callee_id,media_type,status,offer_sdp,created_at,updated_at) VALUES(?,?,?,?,?,'ringing',?,?,?)")
      .bind(id,conversationId,userId,peer.user_id,mediaType,offerSdp,now,now).run();
    return json(request, env, { call: { id, status: "ringing", mediaType, peerUsername: peer.username } }, 201);
  }

  if (request.method === "GET" && path === "/api/messenger/calls") {
    const rows = await db.prepare(
      "SELECT c.id,c.conversation_id,c.caller_id,c.callee_id,c.media_type,c.status,c.created_at," +
      "CASE WHEN c.caller_id=? THEN callee.username ELSE caller.username END AS peer_username " +
      "FROM messenger_calls c JOIN users caller ON caller.id=c.caller_id JOIN users callee ON callee.id=c.callee_id " +
      "WHERE c.caller_id=? OR c.callee_id=? ORDER BY c.created_at DESC LIMIT 50"
    ).bind(userId,userId,userId).all();
    return json(request, env, { calls: rows.results || [] });
  }

  if (request.method === "GET" && path === "/api/messenger/calls/incoming") {
    const rows = await db.prepare("SELECT c.id,c.conversation_id,c.caller_id,c.media_type,c.status,c.created_at,u.username FROM messenger_calls c JOIN users u ON u.id=c.caller_id WHERE c.callee_id=? AND c.status='ringing' AND c.created_at>? ORDER BY c.created_at DESC LIMIT 5")
      .bind(userId,new Date(Date.now()-120000).toISOString()).all();
    return json(request, env, { calls: rows.results || [] });
  }

  const callMatch = path.match(/^\/api\/messenger\/calls\/([A-Za-z0-9-]+)$/);
  if (callMatch && request.method === "GET") {
    const call = await db.prepare("SELECT id,conversation_id,caller_id,callee_id,media_type,status,offer_sdp,answer_sdp,created_at,updated_at FROM messenger_calls WHERE id=? AND (caller_id=? OR callee_id=?)")
      .bind(callMatch[1],userId,userId).first();
    if (!call) return json(request, env, { error: "Anruf nicht gefunden." }, 404);
    const candidates = await db.prepare("SELECT id,sender_id,candidate_json,created_at FROM messenger_call_ice WHERE call_id=? AND sender_id<>? ORDER BY created_at ASC LIMIT 40")
      .bind(call.id,userId).all();
    return json(request, env, { call, candidates: (candidates.results || []).map(row => ({ id: row.id, senderId: row.sender_id, candidate: JSON.parse(row.candidate_json), createdAt: row.created_at })) });
  }

  const callRespondMatch = path.match(/^\/api\/messenger\/calls\/([A-Za-z0-9-]+)\/respond$/);
  if (callRespondMatch && request.method === "POST") {
    let body;
    try { body = await readJson(request); } catch { return json(request, env, { error: "Ungültige Anrufantwort." }, 400); }
    const call = await db.prepare("SELECT id,caller_id,callee_id,status FROM messenger_calls WHERE id=? AND (caller_id=? OR callee_id=?)")
      .bind(callRespondMatch[1],userId,userId).first();
    if (!call) return json(request, env, { error: "Anruf nicht gefunden." }, 404);
    const action = body.action;
    const now = new Date().toISOString();
    if (action === "accept" && call.callee_id === userId && call.status === "ringing") {
      const answerSdp = typeof body.answerSdp === "string" ? body.answerSdp : "";
      if (!answerSdp || answerSdp.length > 20000) return json(request, env, { error: "Anrufantwort fehlt." }, 400);
      await db.prepare("UPDATE messenger_calls SET status='accepted',answer_sdp=?,updated_at=? WHERE id=? AND status='ringing'")
        .bind(answerSdp,now,call.id).run();
      return json(request, env, { ok: true, status: "accepted" });
    }
    if (action === "decline" && call.callee_id === userId && call.status === "ringing") {
      await db.prepare("UPDATE messenger_calls SET status='declined',updated_at=?,ended_at=? WHERE id=?")
        .bind(now,now,call.id).run();
      return json(request, env, { ok: true, status: "declined" });
    }
    if (action === "end" && ["ringing","accepted"].includes(call.status)) {
      await db.prepare("UPDATE messenger_calls SET status='ended',updated_at=?,ended_at=? WHERE id=?")
        .bind(now,now,call.id).run();
      return json(request, env, { ok: true, status: "ended" });
    }
    return json(request, env, { error: "Diese Anrufaktion ist nicht erlaubt oder nicht mehr möglich." }, 409);
  }

  const iceMatch = path.match(/^\/api\/messenger\/calls\/([A-Za-z0-9-]+)\/ice$/);
  if (iceMatch && request.method === "POST") {
    let body;
    try { body = await readJson(request); } catch { return json(request, env, { error: "Ungültiger ICE-Kandidat." }, 400); }
    const call = await db.prepare("SELECT id,status FROM messenger_calls WHERE id=? AND (caller_id=? OR callee_id=?)")
      .bind(iceMatch[1],userId,userId).first();
    if (!call || !["ringing","accepted"].includes(call.status)) return json(request, env, { error: "Anruf nicht aktiv." }, 404);
    const candidate = body.candidate;
    if (!candidate || typeof candidate !== "object" || JSON.stringify(candidate).length > 5000) return json(request, env, { error: "ICE-Kandidat ist ungültig." }, 400);
    await db.prepare("INSERT INTO messenger_call_ice(id,call_id,sender_id,candidate_json,created_at) VALUES(?,?,?,?,?)")
      .bind(crypto.randomUUID(),call.id,userId,JSON.stringify(candidate),new Date().toISOString()).run();
    return json(request, env, { ok: true }, 201);
  }

  return json(request, env, { error: "Worldmessanger-Endpunkt nicht gefunden." }, 404);
}
