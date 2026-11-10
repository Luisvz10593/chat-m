'use strict';

/* =========================================================
   TikTok LIVE — solo lectura (TikTok no tiene API para su chat)
   Se lee con Euler Stream (eulerstream.com), un servicio que se conecta al
   directo y reenvía los eventos por WebSocket. Necesita tu clave de Euler
   (plan gratis), que se escribe en la tablet y no está en el código.
   Llega en protobuf (binario): aquí hay un lector pequeño que busca los
   eventos por su nombre ("WebcastChatMessage", …) sin depender de librerías.
   TikTok no deja escribir ni moderar desde otras apps.
   ========================================================= */
const TT_WS = 'wss://ws.eulerstream.com';
let ttGen = 0;
const ttSockets = new Map();   // usuario → WebSocket
const ttTimers = new Map();
const ttSeen = new Set();
const ttDiag = [];             // últimos eventos recibidos (⚙ → Avanzado → diagnóstico)
const ttLikes = new Map();     // usuario → { count, timer } para juntar los "me gusta"

/* ---------- Lector mínimo de protobuf ---------- */
const ttText = new TextDecoder('utf-8', { fatal: true });

function pbRead(buf) {
  // Devuelve [{ no, wt, v }] o null si no es un mensaje protobuf válido
  const out = [];
  let i = 0;
  const varint = () => {
    let x = 0n, shift = 0n, b;
    do {
      if (i >= buf.length) throw new Error('fin');
      b = buf[i++];
      x |= BigInt(b & 0x7f) << shift;
      shift += 7n;
    } while (b & 0x80 && shift < 70n);
    return x;
  };
  try {
    while (i < buf.length) {
      const tag = Number(varint());
      const no = tag >>> 3, wt = tag & 7;
      if (!no) return null;
      if (wt === 0) out.push({ no, wt, v: varint() });
      else if (wt === 2) {
        const len = Number(varint());
        if (len < 0 || i + len > buf.length) return null;
        out.push({ no, wt, v: buf.subarray(i, i + len) });
        i += len;
      } else if (wt === 1) { if (i + 8 > buf.length) return null; out.push({ no, wt, v: buf.subarray(i, i + 8) }); i += 8; }
      else if (wt === 5) { if (i + 4 > buf.length) return null; out.push({ no, wt, v: buf.subarray(i, i + 4) }); i += 4; }
      else return null;
    }
  } catch { return null; }
  return out;
}
const pbStr = (v) => { try { return ttText.decode(v); } catch { return null; } };
const pbGet = (fields, no) => fields && fields.find((f) => f.no === no);
const pbStrOf = (fields, no) => { const f = pbGet(fields, no); return f && f.wt === 2 ? pbStr(f.v) : null; };
const pbNumOf = (fields, no) => { const f = pbGet(fields, no); return f && f.wt === 0 ? Number(f.v) : 0; };
const pbMsgOf = (fields, no) => { const f = pbGet(fields, no); return f && f.wt === 2 ? pbRead(f.v) : null; };

// Busca, a cualquier profundidad, mensajes { 1: "Webcast…", 2: bytes } = un evento de TikTok
function pbFindEvents(buf, depth = 0, out = []) {
  if (depth > 5 || out.length > 500) return out;
  const fields = pbRead(buf);
  if (!fields) return out;
  const method = pbStrOf(fields, 1);
  const payload = pbGet(fields, 2);
  if (method && /^Webcast[A-Za-z]+Message$/.test(method) && payload && payload.wt === 2) {
    out.push({ method, payload: payload.v });
    return out;
  }
  for (const f of fields) if (f.wt === 2 && f.v.length > 2) pbFindEvents(f.v, depth + 1, out);
  return out;
}

// Usuario de TikTok: 1 id, 3 apodo, 38 usuario (@), 9 foto
function ttUser(fields) {
  const u = fields || [];
  const uniqueId = pbStrOf(u, 38) || pbStrOf(u, 4) || '';
  const nickname = pbStrOf(u, 3) || uniqueId || 'alguien';
  const id = pbGet(u, 1);
  return { id: id ? String(id.v) : uniqueId, uniqueId, nickname };
}

// Texto suelto más largo de un mensaje (por si un campo cambia de número)
function ttLongestString(fields, skip = []) {
  let best = '';
  for (const f of fields || []) {
    if (f.wt !== 2 || skip.includes(f.no)) continue;
    const s = pbStr(f.v);
    if (s && s.length > best.length && !/^Webcast/.test(s) && !/[\u0000-\u0008]/.test(s)) best = s;
  }
  return best;
}

/* ---------- Conexión ---------- */
function connectTikTok() {
  ttGen++;
  for (const ws of ttSockets.values()) { ws.onclose = null; ws.close(); }
  ttSockets.clear();
  for (const t of ttTimers.values()) clearTimeout(t);
  ttTimers.clear();
  const users = channelsOf('tiktok');
  if (!users.length) return;
  const gen = ttGen;
  users.forEach((u, i) => ttTimers.set(u, setTimeout(() => watchTikTok(u, gen), i * 500)));
}

function watchTikTok(user, gen) {
  if (gen !== ttGen) return;
  const key = srcKey('tiktok', user);
  if (!cfg.tiktokApiKey) { setStatus(key, 'err', 'falta clave de Euler'); return; }
  setStatus(key, 'wait', 'conectando…');
  const q = new URLSearchParams({ uniqueId: user, apiKey: cfg.tiktokApiKey });
  const ws = new WebSocket(`${TT_WS}?${q}`);
  ws.binaryType = 'arraybuffer';
  ttSockets.set(user, ws);
  let got = false;
  ws.onmessage = async (e) => {
    if (gen !== ttGen) return;
    if (!got) { got = true; setStatus(key, 'ok', 'TikTok'); }
    try { await ttFrame(e.data, user); } catch (err) { ttLog(user, 'error', String(err && err.message || err)); }
  };
  ws.onclose = (e) => {
    if (gen !== ttGen || ttSockets.get(user) !== ws) return;
    ttSockets.delete(user);
    const retry = (ms) => ttTimers.set(user, setTimeout(() => watchTikTok(user, gen), ms));
    ttLog(user, 'cierre', `${e.code} ${e.reason || ''}`);
    switch (e.code) {
      case 4404: setStatus(key, 'off', 'fuera de directo'); retry(120000); break; // revisa cada 2 min
      case 4005: setStatus(key, 'off', 'terminó el directo'); addSystem('tiktok', '⚫ Terminó el directo de TikTok', false, user); retry(120000); break;
      case 4401: case 4403: setStatus(key, 'err', 'clave de Euler no válida'); break;
      case 4429: setStatus(key, 'err', 'límite de Euler'); retry(5 * 60000); break;
      case 4555: retry(1000); break; // Euler corta a las 8 h: reconecta
      default: setStatus(key, 'err', 'reconectando…'); retry(got ? 5000 : 30000);
    }
  };
}

/* ---------- Mensajes recibidos ---------- */
async function ttFrame(data, user) {
  if (typeof data === 'string') {
    // Por si Euler manda JSON
    let j;
    try { j = JSON.parse(data); } catch { return; }
    ttLog(user, 'json', data.slice(0, 300));
    for (const m of (j.messages || j.events || [j])) ttJsonEvent(m, user);
    return;
  }
  let buf = new Uint8Array(data);
  // Comprimido con gzip
  if (buf[0] === 0x1f && buf[1] === 0x8b && 'DecompressionStream' in window) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    buf = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const events = pbFindEvents(buf);
  if (!events.length) { ttLog(user, 'sin eventos', `${buf.length} bytes`); return; }
  for (const ev of events) ttEvent(ev.method, pbRead(ev.payload) || [], user);
}

function ttEvent(method, f, user) {
  ttLog(user, method, f.length + ' campos');
  const common = pbMsgOf(f, 1) || [];
  const msgId = pbGet(common, 2);
  const id = msgId ? String(msgId.v) : null;
  if (id) {
    if (ttSeen.has(id)) return;
    ttSeen.add(id);
    if (ttSeen.size > 5000) ttSeen.delete(ttSeen.values().next().value);
  }
  const createTime = pbNumOf(common, 4);
  const time = createTime > 1e12 ? new Date(createTime) : new Date();
  const nf = (n) => Number(n || 0).toLocaleString('es');
  switch (method) {
    case 'WebcastChatMessage': {
      const u = ttUser(pbMsgOf(f, 2));
      const text = pbStrOf(f, 3) || ttLongestString(f, [1, 2]);
      if (!text) return;
      ttMessage(user, id, u, text, time);
      break;
    }
    case 'WebcastGiftMessage': {
      const u = ttUser(pbMsgOf(f, 7));
      const gift = pbMsgOf(f, 15) || [];
      const giftType = pbNumOf(gift, 11);
      const repeatEnd = pbNumOf(f, 9);
      const count = pbNumOf(f, 5) || 1;
      if (giftType === 1 && !repeatEnd) return; // racha en curso: se avisa al terminar
      const name = pbStrOf(gift, 16) || pbStrOf(gift, 2) || 'un regalo';
      const diamonds = pbNumOf(gift, 12);
      addSystem('tiktok', `🎁 ${u.nickname} envió ${name}${count > 1 ? ' x' + count : ''}${diamonds ? ` (${nf(diamonds * count)} 💎)` : ''}`, true, user);
      break;
    }
    case 'WebcastSocialMessage': {
      const u = ttUser(pbMsgOf(f, 2));
      const all = JSON.stringify(ttStrings(f)).toLowerCase();
      if (all.includes('follow')) addSystem('tiktok', `➕ ${u.nickname} empezó a seguirte`, true, user);
      else if (all.includes('share')) addSystem('tiktok', `🔗 ${u.nickname} compartió el directo`, false, user);
      break;
    }
    case 'WebcastLikeMessage': {
      if (!cfg.tiktokShowLikes) return;
      const u = ttUser(pbMsgOf(f, 5));
      ttLikeBatch(user, u, pbNumOf(f, 2) || 1);
      break;
    }
    case 'WebcastMemberMessage': {
      if (!cfg.tiktokShowJoins) return;
      const u = ttUser(pbMsgOf(f, 2));
      addSystem('tiktok', `👋 ${u.nickname} entró al directo`, false, user);
      break;
    }
    case 'WebcastSubNotifyMessage': {
      const u = ttUser(pbMsgOf(f, 2));
      addSystem('tiktok', `⭐ ${u.nickname} se suscribió`, true, user);
      break;
    }
    case 'WebcastRoomUserSeqMessage': {
      const viewers = pbNumOf(f, 3) || pbNumOf(f, 7);
      if (viewers) setStatus(srcKey('tiktok', user), 'ok', `👀 ${nf(viewers)}`);
      break;
    }
    case 'WebcastControlMessage':
      if (pbNumOf(f, 2) === 3) { setStatus(srcKey('tiktok', user), 'off', 'terminó el directo'); addSystem('tiktok', '⚫ Terminó el directo de TikTok', false, user); }
      break;
    case 'WebcastQuestionNewMessage': {
      const details = pbMsgOf(f, 2) || [];
      const text = pbStrOf(details, 2) || ttLongestString(details);
      const u = ttUser(pbMsgOf(details, 5));
      if (text) addSystem('tiktok', `❓ ${u.nickname} pregunta: ${text}`, true, user);
      break;
    }
    default:
      break;
  }
}

function ttMessage(user, id, u, text, time) {
  addMessage({
    platform: 'tiktok', channel: user, id: id || ('tt' + Math.random().toString(36).slice(2)),
    userId: u.id, user: u.nickname, login: u.uniqueId, color: nameColor(u.uniqueId || u.nickname),
    badges: [], parts: [{ text }], time,
  });
}

// Por si Euler manda JSON (formato de TikTok-Live-Connector)
function ttJsonEvent(m, user) {
  const type = m.type || m.event || '';
  const d = m.data || m;
  const u = d.user || {};
  const who = { id: u.userId || u.id, uniqueId: u.uniqueId || u.displayId || '', nickname: u.nickname || u.uniqueId || 'alguien' };
  if (/chat/i.test(type) && (d.comment || d.content)) ttMessage(user, d.msgId || null, who, d.comment || d.content, new Date());
  else if (/gift/i.test(type)) {
    const name = (d.gift && d.gift.name) || d.giftName || (d.giftDetails && d.giftDetails.giftName) || 'un regalo';
    if (d.repeatEnd === 0 && (d.giftType === 1 || (d.gift && d.gift.type === 1))) return;
    addSystem('tiktok', `🎁 ${who.nickname} envió ${name}${d.repeatCount > 1 ? ' x' + d.repeatCount : ''}`, true, user);
  } else if (/follow/i.test(type)) addSystem('tiktok', `➕ ${who.nickname} empezó a seguirte`, true, user);
  else if (/share/i.test(type)) addSystem('tiktok', `🔗 ${who.nickname} compartió el directo`, false, user);
}

// Junta los "me gusta" de cada persona en un solo aviso cada 20 s
function ttLikeBatch(user, u, n) {
  const k = user + ':' + u.id;
  const cur = ttLikes.get(k) || { count: 0, timer: null };
  cur.count += n;
  if (!cur.timer) {
    cur.timer = setTimeout(() => {
      addSystem('tiktok', `❤️ ${u.nickname} dio ${cur.count} me gusta`, false, user);
      ttLikes.delete(k);
    }, 20000);
  }
  ttLikes.set(k, cur);
}

// Todos los textos dentro de un mensaje (para reconocer seguir/compartir)
function ttStrings(fields, depth = 0, out = []) {
  if (depth > 4) return out;
  for (const f of fields || []) {
    if (f.wt !== 2) continue;
    const s = pbStr(f.v);
    if (s && s.length < 200 && /^[\x20-\x7e]+$/.test(s)) out.push(s);
    else { const sub = pbRead(f.v); if (sub) ttStrings(sub, depth + 1, out); }
  }
  return out;
}

function ttLog(user, what, detail) {
  ttDiag.push(`${new Date().toLocaleTimeString('es')} @${user} · ${what}${detail ? ' · ' + detail : ''}`);
  if (ttDiag.length > 60) ttDiag.shift();
}

connectTikTok();
