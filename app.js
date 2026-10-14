'use strict';

/* =========================================================
   Chat M — chat unificado de Twitch + Kick + Starvios para tablet
   ========================================================= */

const $ = (s) => document.querySelector(s);

// ---------- Almacenamiento local (puede fallar en modo privado) ----------
const store = {
  get(k, d) {
    try { const v = localStorage.getItem('chatm.' + k); return v == null ? d : JSON.parse(v); }
    catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('chatm.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ }
  },
};

const DEFAULTS = {
  twitchChannel: '',
  kickChannel: '',
  starviosChannel: '',
  twitchClientId: '',
  kickClientId: '',
  kickClientSecret: '', // solo vive en este dispositivo
  kickChatroomId: '',
  sendTarget: 'twitch',
  fontSize: 19,
  showTime: true,
  wakeLock: true,
  showTwitch: true,
  showKick: true,
  showStarvios: true,
};

const PLATFORMS = ['twitch', 'kick', 'starvios'];
const PLATFORM_NAMES = { twitch: 'Twitch', kick: 'Kick', starvios: 'Starvios' };
const showKey = (p) => 'show' + p[0].toUpperCase() + p.slice(1);
const cfg = Object.assign({}, DEFAULTS, store.get('cfg', {}));
let auth = store.get('auth', null); // { token, login, userId }

const TWITCH_SCOPES = [
  'user:write:chat',
  'moderator:manage:chat_messages',
  'moderator:manage:banned_users',
].join(' ');

const MAX_MESSAGES = 400;

// ---------- Utilidades de interfaz ----------
let toastTimer;
function toast(text, isError = false) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.toggle('error', isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

function setStatus(platform, status, text) {
  const chip = $('#chip-' + platform);
  chip.dataset.status = status;
  $('#st-' + platform).textContent = text;
}

function applyView() {
  document.documentElement.style.setProperty('--fs', cfg.fontSize + 'px');
  document.body.classList.toggle('hide-time', !cfg.showTime);
  for (const p of PLATFORMS) {
    document.body.classList.toggle('hide-' + p, !cfg[showKey(p)]);
    $('#chip-' + p).setAttribute('aria-pressed', String(cfg[showKey(p)]));
  }
  updateComposer();
}

function saveCfg() { store.set('cfg', cfg); }

// ---------- Feed de mensajes ----------
const feed = $('#feed');
let stickToBottom = true;

feed.addEventListener('scroll', () => {
  stickToBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60;
  if (stickToBottom) $('#jump').hidden = true;
});
$('#jump').addEventListener('click', () => {
  feed.scrollTop = feed.scrollHeight;
  $('#jump').hidden = true;
});

function fmtTime(d) {
  return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

function myNames() {
  return [auth && auth.login, cfg.twitchChannel, cfg.kickChannel]
    .filter(Boolean).map((n) => n.toLowerCase());
}

/**
 * m = { platform, id, userId, user, color, badges:[string],
 *       parts:[{text}|{img, alt}], time:Date, action?, replyTo? }
 */
function addMessage(m) {
  const el = document.createElement('div');
  el.className = 'msg ' + m.platform;
  el.dataset.id = m.id || '';
  el.dataset.user = (m.user || '').toLowerCase();
  el._msg = m;

  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = fmtTime(m.time || new Date());

  const content = document.createElement('div');
  content.className = 'content';

  if (m.replyTo) {
    const ref = document.createElement('span');
    ref.className = 'reply-ref';
    ref.textContent = '↪ respondiendo a @' + m.replyTo;
    content.append(ref);
  }

  for (const b of m.badges || []) {
    const p = document.createElement('span');
    p.className = 'pill ' + b;
    p.textContent = BADGE_LABELS[b] || b.toUpperCase();
    content.append(p);
  }

  const user = document.createElement('span');
  user.className = 'user';
  user.style.color = readableColor(m.color, m.platform);
  user.textContent = m.user;
  content.append(user, document.createTextNode(m.action ? ' ' : ': '));

  const body = document.createElement('span');
  body.className = 'body' + (m.action ? ' action' : '');
  for (const part of m.parts) {
    if (part.img) {
      const img = document.createElement('img');
      img.className = 'emote';
      img.src = part.img;
      img.alt = img.title = part.alt;
      img.loading = 'lazy';
      body.append(img);
    } else {
      body.append(document.createTextNode(part.text));
    }
  }
  content.append(body);

  const plain = m.parts.map((p) => p.text || p.alt).join('').toLowerCase();
  if (myNames().some((n) => plain.includes('@' + n))) el.classList.add('mention');

  el.append(time, content);
  el.addEventListener('click', () => openActions(m, el));
  pushEl(el);
}

function addSystem(platform, text, highlight = false) {
  const el = document.createElement('div');
  el.className = 'msg system ' + platform + (highlight ? ' highlight' : '');
  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = fmtTime(new Date());
  const content = document.createElement('div');
  content.className = 'content';
  content.textContent = text;
  el.append(time, content);
  pushEl(el);
}

function pushEl(el) {
  feed.append(el);
  while (feed.childElementCount > MAX_MESSAGES) feed.firstElementChild.remove();
  if (stickToBottom) feed.scrollTop = feed.scrollHeight;
  else $('#jump').hidden = false;
}

function markDeleted(platform, id) {
  if (!id) return;
  for (const el of feed.querySelectorAll('.msg.' + platform)) {
    if (el.dataset.id === String(id)) el.classList.add('deleted');
  }
}

function markUserCleared(platform, username) {
  const u = String(username || '').toLowerCase();
  for (const el of feed.querySelectorAll('.msg.' + platform)) {
    if (el.dataset.user === u) el.classList.add('deleted');
  }
}

const BADGE_LABELS = {
  broadcaster: 'STREAMER', moderator: 'MOD', vip: 'VIP',
  subscriber: 'SUB', founder: 'SUB', og: 'OG', verified: '✔',
};
// Nombres de insignias de otras plataformas → los de arriba
const BADGE_ALIASES = { owner: 'broadcaster', mod: 'moderator', sub: 'subscriber' };

// Evita nombres ilegibles sobre fondo oscuro
function readableColor(color, platform) {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) {
    return { kick: '#53fc18', starvios: '#ffc83d' }[platform] || '#bf94ff';
  }
  const n = parseInt(color.slice(1), 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum >= 90) return color;
  const k = 90 / Math.max(lum, 1);
  const f = (v) => Math.min(255, Math.round(v * k + 40));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/* =========================================================
   TWITCH — lectura por IRC anónimo
   ========================================================= */
let twitchWs = null;
let twitchRetry = 0;
let twitchRoomId = null; // id del broadcaster (viene en ROOMSTATE)

function connectTwitch() {
  if (twitchWs) { twitchWs.onclose = null; twitchWs.close(); twitchWs = null; }
  const ch = cfg.twitchChannel.trim().toLowerCase().replace(/^#/, '');
  if (!ch) { setStatus('twitch', 'off', 'sin canal'); return; }

  setStatus('twitch', 'wait', 'conectando…');
  const ws = twitchWs = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

  ws.onopen = () => {
    ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
    ws.send('PASS SCHMOOPIIE');
    ws.send('NICK justinfan' + Math.floor(1000 + Math.random() * 80000));
    ws.send('JOIN #' + ch);
  };
  ws.onmessage = (e) => {
    for (const line of e.data.split('\r\n')) if (line) handleIrc(ws, parseIrc(line));
  };
  ws.onclose = () => {
    if (twitchWs !== ws) return;
    const wait = Math.min(30000, 1000 * 2 ** twitchRetry++);
    setStatus('twitch', 'err', 'reconectando…');
    setTimeout(() => { if (twitchWs === ws) connectTwitch(); }, wait);
  };
}

function unescapeTag(v) {
  return v.replace(/\\(.)/g, (_, c) => ({ s: ' ', ':': ';', '\\': '\\', r: '\r', n: '\n' }[c] ?? c));
}

function parseIrc(line) {
  const tags = {};
  let prefix = '';
  if (line[0] === '@') {
    const sp = line.indexOf(' ');
    for (const kv of line.slice(1, sp).split(';')) {
      const eq = kv.indexOf('=');
      tags[kv.slice(0, eq)] = unescapeTag(kv.slice(eq + 1));
    }
    line = line.slice(sp + 1);
  }
  if (line[0] === ':') {
    const sp = line.indexOf(' ');
    prefix = line.slice(1, sp);
    line = line.slice(sp + 1);
  }
  let trailing = null;
  const ti = line.indexOf(' :');
  if (ti >= 0) { trailing = line.slice(ti + 2); line = line.slice(0, ti); }
  const parts = line.split(' ');
  return { tags, prefix, command: parts[0], params: parts.slice(1), trailing };
}

function handleIrc(ws, msg) {
  const { tags, command, trailing } = msg;
  switch (command) {
    case 'PING':
      ws.send('PONG :' + (trailing || 'tmi.twitch.tv'));
      break;
    case 'ROOMSTATE':
      if (tags['room-id']) twitchRoomId = tags['room-id'];
      twitchRetry = 0;
      setStatus('twitch', 'ok', cfg.twitchChannel.toLowerCase());
      break;
    case 'PRIVMSG':
      handleTwitchMsg(tags, msg.prefix, trailing || '');
      break;
    case 'CLEARMSG':
      markDeleted('twitch', tags['target-msg-id']);
      break;
    case 'CLEARCHAT':
      if (trailing) markUserCleared('twitch', trailing);
      else addSystem('twitch', 'El chat de Twitch fue limpiado por un moderador.');
      break;
    case 'USERNOTICE': {
      const sys = tags['system-msg'] || '';
      addSystem('twitch', sys + (trailing ? ' — ' + trailing : ''), true);
      break;
    }
    case 'NOTICE':
      if (trailing) addSystem('twitch', trailing);
      break;
    case 'RECONNECT':
      connectTwitch();
      break;
  }
}

function handleTwitchMsg(tags, prefix, text) {
  let action = false;
  if (text.startsWith('\x01ACTION ')) { action = true; text = text.slice(8).replace(/\x01$/, ''); }

  const badges = (tags.badges || '').split(',').map((b) => b.split('/')[0]).filter((b) => BADGE_LABELS[b]);
  const replyTo = tags['reply-parent-display-name'] || null;
  // Twitch antepone "@usuario " en las respuestas: lo quitamos porque ya mostramos la referencia
  if (replyTo && text.toLowerCase().startsWith('@' + replyTo.toLowerCase() + ' ')) {
    const cut = replyTo.length + 2;
    text = text.slice(cut);
    tags.emotes = shiftEmotes(tags.emotes, cut);
  }

  addMessage({
    platform: 'twitch',
    id: tags.id,
    userId: tags['user-id'],
    user: tags['display-name'] || prefix.split('!')[0],
    login: prefix.split('!')[0],
    color: tags.color,
    badges: [...new Set(badges)],
    parts: twitchParts(text, tags.emotes),
    time: tags['tmi-sent-ts'] ? new Date(Number(tags['tmi-sent-ts'])) : new Date(),
    action,
    replyTo,
  });
}

function shiftEmotes(emotes, cut) {
  if (!emotes) return emotes;
  return emotes.split('/').map((e) => {
    const [id, pos] = e.split(':');
    const ranges = pos.split(',').map((r) => r.split('-').map(Number))
      .filter(([a]) => a >= cut).map(([a, b]) => `${a - cut}-${b - cut}`);
    return ranges.length ? `${id}:${ranges.join(',')}` : null;
  }).filter(Boolean).join('/');
}

function twitchParts(text, emotesTag) {
  if (!emotesTag) return [{ text }];
  const chars = Array.from(text); // posiciones en code points
  const ranges = [];
  for (const e of emotesTag.split('/')) {
    const [id, pos] = e.split(':');
    if (!pos) continue;
    for (const r of pos.split(',')) {
      const [a, b] = r.split('-').map(Number);
      ranges.push({ a, b, id });
    }
  }
  ranges.sort((x, y) => x.a - y.a);
  const out = [];
  let i = 0;
  for (const r of ranges) {
    if (r.a < i) continue;
    if (r.a > i) out.push({ text: chars.slice(i, r.a).join('') });
    out.push({
      img: `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(r.id)}/default/dark/2.0`,
      alt: chars.slice(r.a, r.b + 1).join(''),
    });
    i = r.b + 1;
  }
  if (i < chars.length) out.push({ text: chars.slice(i).join('') });
  return out;
}

/* =========================================================
   TWITCH — cuenta (OAuth implícito) y API Helix
   ========================================================= */
function redirectUrl() {
  return location.origin + location.pathname;
}

function twitchLogin() {
  if (!cfg.twitchClientId) {
    toast('Primero pega el Client ID de tu app de Twitch en Ajustes.', true);
    return;
  }
  if (location.protocol === 'file:') {
    toast('Para iniciar sesión la app debe abrirse desde https:// o http://localhost (ver LEEME).', true);
    return;
  }
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  try { sessionStorage.setItem('chatm.state', state); } catch { /* ignorar */ }
  const params = new URLSearchParams({
    response_type: 'token',
    client_id: cfg.twitchClientId,
    redirect_uri: redirectUrl(),
    scope: TWITCH_SCOPES,
    state,
    force_verify: 'true',
  });
  location.href = 'https://id.twitch.tv/oauth2/authorize?' + params;
}

function twitchLogout() {
  auth = null;
  store.set('auth', null);
  updateAuthUi();
  updateComposer();
  toast('Sesión de Twitch cerrada.');
}

async function handleAuthRedirect() {
  const hash = location.hash.slice(1);
  if (!hash.includes('access_token') && !hash.includes('error')) return;
  history.replaceState(null, '', location.pathname + location.search);
  const p = new URLSearchParams(hash);
  if (p.get('error')) { toast('Twitch rechazó el inicio de sesión: ' + (p.get('error_description') || p.get('error')), true); return; }

  let expected = null;
  try { expected = sessionStorage.getItem('chatm.state'); sessionStorage.removeItem('chatm.state'); } catch { /* ignorar */ }
  if (expected && expected !== p.get('state')) { toast('El inicio de sesión no coincide; inténtalo otra vez.', true); return; }

  if (await validateToken(p.get('access_token'))) toast('Sesión iniciada como ' + auth.login);
}

async function validateToken(token) {
  try {
    const r = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: 'OAuth ' + token } });
    if (!r.ok) throw new Error('token inválido');
    const j = await r.json();
    auth = { token, login: j.login, userId: j.user_id };
    store.set('auth', auth);
    return true;
  } catch {
    if (auth && auth.token === token) {
      auth = null;
      store.set('auth', null);
      toast('Tu sesión de Twitch expiró. Inicia sesión de nuevo.', true);
    }
    return false;
  } finally {
    updateAuthUi();
    updateComposer();
  }
}

async function helix(method, path, params, body) {
  if (!auth) throw new Error('Inicia sesión con Twitch primero.');
  const url = 'https://api.twitch.tv/helix/' + path + (params ? '?' + new URLSearchParams(params) : '');
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: 'Bearer ' + auth.token,
      'Client-Id': cfg.twitchClientId,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) { await validateToken(auth.token); throw new Error('Sesión expirada.'); }
  const text = await r.text();
  const j = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(j.message || 'Error ' + r.status);
  return j;
}

function requireRoom() {
  if (!twitchRoomId) throw new Error('Aún no hay conexión con el canal de Twitch.');
  return twitchRoomId;
}

async function twitchSend(message, replyId) {
  const body = { broadcaster_id: requireRoom(), sender_id: auth.userId, message };
  if (replyId) body.reply_parent_message_id = replyId;
  const j = await helix('POST', 'chat/messages', null, body);
  const res = j.data && j.data[0];
  if (res && !res.is_sent) throw new Error((res.drop_reason && res.drop_reason.message) || 'Twitch no envió el mensaje.');
}

async function twitchDelete(messageId) {
  await helix('DELETE', 'moderation/chat', {
    broadcaster_id: requireRoom(), moderator_id: auth.userId, message_id: messageId,
  });
}

async function twitchBan(userId, duration) {
  const data = { user_id: userId, reason: 'Chat M' };
  if (duration) data.duration = duration;
  await helix('POST', 'moderation/bans', {
    broadcaster_id: requireRoom(), moderator_id: auth.userId,
  }, { data });
}

/* =========================================================
   KICK — lectura consultando el historial del chat
   (Kick retiró su WebSocket público de Pusher y el nuevo
   solo acepta conexiones desde kick.com, así que pedimos
   los últimos mensajes cada 2 segundos.)
   ========================================================= */
const KICK_POLL_MS = 2000;
let kickGen = 0;          // invalida ciclos de consulta anteriores al reconectar
let kickTimer = null;
let kickFails = 0;
let kickPrev = [];        // [{id, t}] de la consulta anterior
const kickSeen = new Set();

async function resolveKickRoom(slug) {
  if (cfg.kickChatroomId) return String(cfg.kickChatroomId).trim();
  const cached = store.get('kickRoom.' + slug, null);
  if (cached) return cached;
  const r = await fetch('https://kick.com/api/v2/channels/' + encodeURIComponent(slug));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const id = j && j.chatroom && j.chatroom.id;
  if (!id) throw new Error('sin chatroom');
  store.set('kickRoom.' + slug, String(id));
  return String(id);
}

async function connectKick() {
  const gen = ++kickGen;
  clearTimeout(kickTimer);
  kickPrev = [];
  const slug = cfg.kickChannel.trim().toLowerCase();
  if (!slug) { setStatus('kick', 'off', 'sin canal'); return; }

  setStatus('kick', 'wait', 'conectando…');
  let roomId;
  try {
    roomId = await resolveKickRoom(slug);
  } catch {
    if (gen !== kickGen) return;
    setStatus('kick', 'err', 'falta ID');
    addSystem('kick', 'No se pudo detectar el chat de Kick automáticamente. Abre Ajustes → Avanzado y escribe el ID del chatroom.');
    return;
  }

  const poll = async () => {
    if (gen !== kickGen) return;
    try {
      const r = await fetch(`https://web.kick.com/api/v1/chat/${encodeURIComponent(roomId)}/history`, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (gen !== kickGen) return;
      // Kick los entrega del más nuevo al más viejo
      const msgs = ((j.data && j.data.messages) || []).slice().reverse();
      detectKickDeletions(msgs);
      msgs.forEach(handleKickMsg);
      kickFails = 0;
      setStatus('kick', 'ok', slug);
    } catch {
      if (gen !== kickGen) return;
      kickFails++;
      setStatus('kick', 'err', 'reintentando…');
    }
    const wait = kickFails ? Math.min(30000, KICK_POLL_MS * 2 ** kickFails) : KICK_POLL_MS;
    kickTimer = setTimeout(poll, wait);
  };
  poll();
}

// Un mensaje que estaba en la consulta anterior y desaparece, aunque sigan
// llegando mensajes más viejos que él, fue borrado por un moderador.
function detectKickDeletions(msgs) {
  const now = msgs.map((m) => ({ id: m.id, t: Date.parse(m.created_at) || 0 }));
  if (now.length && kickPrev.length) {
    const oldest = now[0].t;
    const ids = new Set(now.map((m) => m.id));
    for (const p of kickPrev) if (p.t > oldest && !ids.has(p.id)) markDeleted('kick', p.id);
  }
  kickPrev = now;
}

function handleKickMsg(d) {
  if (!d || !d.id || kickSeen.has(d.id)) return;
  kickSeen.add(d.id);
  if (kickSeen.size > 3000) kickSeen.delete(kickSeen.values().next().value);

  const sender = d.sender || {};
  const identity = sender.identity || {};
  const badges = (identity.badges || []).map((b) => b.type).filter((b) => BADGE_LABELS[b]);

  let meta = d.metadata;
  if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = null; } }
  const replyTo = d.type === 'reply' && meta && meta.original_sender ? meta.original_sender.username : null;

  addMessage({
    platform: 'kick',
    id: d.id,
    userId: sender.id,
    user: sender.username || sender.slug || '?',
    color: identity.color,
    badges: [...new Set(badges)],
    parts: kickParts(d.content || ''),
    time: d.created_at ? new Date(d.created_at) : new Date(),
    replyTo,
  });
}

function kickParts(text) {
  const out = [];
  const re = /\[emote:(\d+):([^\]]*)\]/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ img: `https://files.kick.com/emotes/${m[1]}/fullsize`, alt: m[2] });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/* =========================================================
   KICK — cuenta (OAuth 2.1 + PKCE) y API pública oficial
   El Client Secret lo escribe el usuario en Ajustes y solo
   se guarda en este dispositivo (localStorage).
   ========================================================= */
const KICK_SCOPES = 'user:read channel:read chat:write moderation:ban moderation:chat_message:manage';
const KICK_API = 'https://api.kick.com/public/v1/';
let kickAuth = store.get('kickAuth', null); // { access, refresh, expiresAt, userId, name }
let kickBroadcaster = null;                 // { slug, id }

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function kickLogin() {
  if (!cfg.kickClientId || !cfg.kickClientSecret) {
    toast('Escribe el Client ID y el Client Secret de Kick en Ajustes.', true);
    return;
  }
  if (!window.crypto || !crypto.subtle) {
    toast('Para iniciar sesión la app debe abrirse desde https:// o http://localhost.', true);
    return;
  }
  const verifier = randomString(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = 'kick.' + randomString(12);
  store.set('kickPkce', { verifier, state });
  location.href = 'https://id.kick.com/oauth/authorize?' + new URLSearchParams({
    response_type: 'code',
    client_id: cfg.kickClientId,
    redirect_uri: redirectUrl(),
    scope: KICK_SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
}

function kickLogout(silent) {
  kickAuth = null;
  kickBroadcaster = null;
  store.set('kickAuth', null);
  updateAuthUi();
  updateComposer();
  if (!silent) toast('Sesión de Kick cerrada.');
}

async function kickTokenRequest(params) {
  const r = await fetch('https://id.kick.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.kickClientId, client_secret: cfg.kickClientSecret, ...params }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    throw new Error(j.error_description || j.message || `Kick rechazó el inicio de sesión (${r.status}).`);
  }
  kickAuth = {
    ...(kickAuth || {}),
    access: j.access_token,
    refresh: j.refresh_token || (kickAuth && kickAuth.refresh),
    expiresAt: Date.now() + (j.expires_in || 3600) * 1000,
  };
  store.set('kickAuth', kickAuth);
}

async function handleKickRedirect() {
  const q = new URLSearchParams(location.search);
  const state = q.get('state') || '';
  if (!state.startsWith('kick.')) return;
  history.replaceState(null, '', location.pathname + location.hash);
  const pkce = store.get('kickPkce', null);
  store.set('kickPkce', null);
  if (q.get('error')) { toast('Kick rechazó el inicio de sesión: ' + (q.get('error_description') || q.get('error')), true); return; }
  if (!pkce || pkce.state !== state || !q.get('code')) { toast('El inicio de sesión de Kick no coincide; inténtalo otra vez.', true); return; }

  try {
    await kickTokenRequest({
      grant_type: 'authorization_code',
      code: q.get('code'),
      redirect_uri: redirectUrl(),
      code_verifier: pkce.verifier,
    });
    const me = await kickApi('GET', 'users');
    const u = me.data && me.data[0];
    kickAuth.userId = u && u.user_id;
    kickAuth.name = u && u.name;
    store.set('kickAuth', kickAuth);
    toast('Sesión de Kick iniciada como ' + (kickAuth.name || '?'));
  } catch (err) {
    kickLogout(true);
    toast(err.message, true);
  } finally {
    updateAuthUi();
    updateComposer();
  }
}

async function kickApi(method, path, body, retried) {
  if (!kickAuth) throw new Error('Inicia sesión con Kick primero.');
  if (Date.now() > kickAuth.expiresAt - 60000 && kickAuth.refresh) {
    await kickTokenRequest({ grant_type: 'refresh_token', refresh_token: kickAuth.refresh });
  }
  const r = await fetch(KICK_API + path, {
    method,
    headers: { Authorization: 'Bearer ' + kickAuth.access, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) {
    if (!retried && kickAuth.refresh) {
      try {
        await kickTokenRequest({ grant_type: 'refresh_token', refresh_token: kickAuth.refresh });
        return kickApi(method, path, body, true);
      } catch { /* cae al cierre de sesión */ }
    }
    kickLogout(true);
    throw new Error('Tu sesión de Kick expiró. Inicia sesión de nuevo.');
  }
  const text = await r.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch { /* respuesta vacía o no JSON */ }
  if (!r.ok) throw new Error(j.message || 'Kick respondió con error ' + r.status);
  return j;
}

async function kickBroadcasterId() {
  const slug = cfg.kickChannel.trim().toLowerCase();
  if (!slug) throw new Error('Escribe tu canal de Kick en Ajustes.');
  if (kickBroadcaster && kickBroadcaster.slug === slug) return kickBroadcaster.id;
  const j = await kickApi('GET', 'channels?slug=' + encodeURIComponent(slug));
  const ch = j.data && j.data[0];
  if (!ch) throw new Error('Kick no encontró el canal ' + slug);
  kickBroadcaster = { slug, id: ch.broadcaster_user_id };
  return kickBroadcaster.id;
}

async function kickSend(content, replyId) {
  const body = { type: 'user', broadcaster_user_id: await kickBroadcasterId(), content };
  if (replyId) body.reply_to_message_id = replyId;
  await kickApi('POST', 'chat', body);
}

async function kickDelete(messageId) {
  await kickApi('DELETE', 'chat/' + encodeURIComponent(messageId));
}

async function kickBan(userId, minutes) {
  const body = { broadcaster_user_id: await kickBroadcasterId(), user_id: Number(userId), reason: 'Chat M' };
  if (minutes) body.duration = minutes;
  await kickApi('POST', 'moderation/bans', body);
}

/* =========================================================
   STARVIOS — lectura por su API pública (Supabase)
   Starvios no tiene API documentada: estos son los mismos
   datos públicos que usa su web, así que pueden cambiar.
   ========================================================= */
const SV_URL = 'https://naiijcvngtkkocligwvk.supabase.co/rest/v1/';
const SV_KEY = 'sb_publishable_4lF1QyQhWOUE1Pw3rWBwEw_bVmkAxm6'; // clave pública de su web
const SV_FIELDS = 'id,user_id,body,coins,kind,meta,badges,is_deleted,created_at,'
  + 'profiles:profiles!live_chat_messages_user_id_fkey(username,display_name,chat_color)';
const SV_POLL_MS = 2000;
const SV_EVENTS = { sub: '⭐ se suscribió', gift_sub: '🎁 regaló suscripciones', gift: '🎁 regalo',
  raid: '🚀 raid', reward: '🏆 canjeó una recompensa', starfall: '🌠 lluvia de estrellas', highlight: '✨ mensaje destacado' };

let svGen = 0;
let svTimer = null;
let svStream = null;   // { id, channelId }
let svLast = null;     // created_at del último mensaje recibido
let svPolls = 0;
const svSeen = new Set();

async function svGet(path) {
  const r = await fetch(SV_URL + path, { headers: { apikey: SV_KEY }, cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function connectStarvios() {
  const gen = ++svGen;
  clearTimeout(svTimer);
  svStream = null;
  svLast = null;
  const name = cfg.starviosChannel.trim().toLowerCase().replace(/^@/, '');
  if (!name) { setStatus('starvios', 'off', 'sin canal'); return; }

  setStatus('starvios', 'wait', 'conectando…');
  try {
    const [profile] = await svGet('profiles?select=id&username=eq.' + encodeURIComponent(name));
    if (!profile) throw new Error('no existe');
    const [stream] = await svGet('live_streams?select=id,started_at,chat_cleared_at&order=started_at.desc&limit=1&channel_id=eq.' + profile.id);
    if (!stream) throw new Error('sin directos');
    if (gen !== svGen) return;
    svStream = { id: stream.id, channelId: profile.id };
    // Empieza desde el inicio del directo actual (o la última limpieza del chat)
    svLast = [stream.started_at, stream.chat_cleared_at].filter(Boolean).sort().pop() || new Date().toISOString();
    const recent = await svGet(`live_chat_messages?select=${SV_FIELDS}&stream_id=eq.${stream.id}`
      + `&created_at=gt.${encodeURIComponent(svLast)}&order=created_at.desc&limit=30`);
    if (gen !== svGen) return;
    recent.reverse().forEach(handleStarviosMsg);
  } catch (e) {
    if (gen !== svGen) return;
    setStatus('starvios', 'err', e.message === 'no existe' ? 'canal no existe' : 'reintentando…');
    if (e.message !== 'no existe') svTimer = setTimeout(connectStarvios, 10000);
    return;
  }

  let fails = 0;
  const poll = async () => {
    if (gen !== svGen) return;
    try {
      const rows = await svGet(`live_chat_messages?select=${SV_FIELDS}&stream_id=eq.${svStream.id}`
        + `&created_at=gt.${encodeURIComponent(svLast)}&order=created_at.asc&limit=100`);
      if (gen !== svGen) return;
      rows.forEach(handleStarviosMsg);
      // Cada ~10 s revisa qué mensajes borraron los moderadores
      if (++svPolls % 5 === 0) await svCheckDeleted(gen);
      fails = 0;
      setStatus('starvios', 'ok', cfg.starviosChannel.toLowerCase());
    } catch {
      if (gen !== svGen) return;
      fails++;
      setStatus('starvios', 'err', 'reintentando…');
    }
    svTimer = setTimeout(poll, fails ? Math.min(30000, SV_POLL_MS * 2 ** fails) : SV_POLL_MS);
  };
  poll();
}

async function svCheckDeleted(gen) {
  const shown = feed.querySelector('.msg.starvios[data-id]:not(.deleted)');
  if (!shown || !shown._msg) return;
  const since = shown._msg.time.toISOString();
  const rows = await svGet(`live_chat_messages?select=id&stream_id=eq.${svStream.id}`
    + `&is_deleted=eq.true&created_at=gte.${encodeURIComponent(since)}`);
  if (gen !== svGen) return;
  rows.forEach((r) => markDeleted('starvios', r.id));
}

function handleStarviosMsg(d) {
  if (!d || !d.id) return;
  if (d.created_at > svLast) svLast = d.created_at;
  if (svSeen.has(d.id)) return;
  svSeen.add(d.id);
  if (svSeen.size > 3000) svSeen.delete(svSeen.values().next().value);

  const p = d.profiles || {};
  const user = p.display_name || p.username || '?';
  const body = d.body || '';

  if (d.kind && d.kind !== 'chat' && SV_EVENTS[d.kind]) {
    addSystem('starvios', `${user} ${SV_EVENTS[d.kind]}${body ? ' — ' + body : ''}`, true);
    return;
  }

  const badges = (d.badges || []).map((b) => BADGE_ALIASES[b] || b).filter((b) => BADGE_LABELS[b]);
  const parts = [{ text: body }];
  if (d.coins > 0) parts.unshift({ text: `⭐ ${d.coins} Starvies · ` });

  addMessage({
    platform: 'starvios',
    id: d.id,
    userId: d.user_id,
    user,
    login: p.username,
    color: p.chat_color,
    badges: [...new Set(badges)],
    parts,
    time: new Date(d.created_at),
  });
  if (d.is_deleted) markDeleted('starvios', d.id);
}

/* =========================================================
   STARVIOS — cuenta y moderación
   El correo y la contraseña solo se envían a Starvios para
   iniciar sesión; se guarda la sesión, no la contraseña.
   ========================================================= */
const SV_AUTH = 'https://naiijcvngtkkocligwvk.supabase.co/auth/v1/token?grant_type=';
const SV_BAN_MINUTES = 5256000; // lo que usa la web de Starvios para "expulsar" (~10 años)
let svAuth = store.get('svAuth', null); // { access, refresh, expiresAt, userId, email }

async function svTokenRequest(grant, body) {
  const r = await fetch(SV_AUTH + grant, {
    method: 'POST',
    headers: { apikey: SV_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    const msg = j.error_description || j.msg || j.message || '';
    throw new Error(/invalid/i.test(msg) ? 'Correo o contraseña incorrectos.' : 'Starvios rechazó el inicio de sesión. ' + msg);
  }
  svAuth = {
    access: j.access_token,
    refresh: j.refresh_token,
    expiresAt: Date.now() + (j.expires_in || 3600) * 1000,
    userId: j.user && j.user.id,
    email: j.user && j.user.email,
  };
  store.set('svAuth', svAuth);
}

async function starviosLogin(email, password) {
  await svTokenRequest('password', { email, password });
  updateAuthUi();
  updateComposer();
  toast('Sesión de Starvios iniciada.');
}

function starviosLogout(silent) {
  svAuth = null;
  store.set('svAuth', null);
  updateAuthUi();
  updateComposer();
  if (!silent) toast('Sesión de Starvios cerrada.');
}

async function svAuthed(method, path, body, extraHeaders) {
  if (!svAuth) throw new Error('Inicia sesión con Starvios primero.');
  if (Date.now() > svAuth.expiresAt - 60000) {
    try { await svTokenRequest('refresh_token', { refresh_token: svAuth.refresh }); }
    catch { starviosLogout(true); throw new Error('Tu sesión de Starvios expiró. Inicia sesión de nuevo.'); }
  }
  const r = await fetch(SV_URL + path, {
    method,
    headers: { apikey: SV_KEY, Authorization: 'Bearer ' + svAuth.access, 'Content-Type': 'application/json', ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch { /* sin cuerpo */ }
  if (r.status === 401) { starviosLogout(true); throw new Error('Tu sesión de Starvios expiró. Inicia sesión de nuevo.'); }
  if (!r.ok) throw new Error((j && (j.message || j.hint)) || 'Starvios respondió con error ' + r.status);
  return j;
}

function svRequireStream() {
  if (!svStream) throw new Error('Aún no hay conexión con el directo de Starvios.');
  return svStream;
}

async function starviosSend(body, replyId) {
  const s = svRequireStream();
  if (replyId) await svAuthed('POST', 'rpc/send_live_reply', { _stream_id: s.id, _body: body, _coins: 0, _reply_to: replyId });
  else await svAuthed('POST', 'rpc/send_live_message', { _stream_id: s.id, _body: body, _coins: 0 });
}

async function starviosDelete(messageId) {
  const s = svRequireStream();
  const rows = await svAuthed('PATCH',
    `live_chat_messages?id=eq.${encodeURIComponent(messageId)}&stream_id=eq.${s.id}&select=id`,
    { is_deleted: true, deleted_by: svAuth.userId },
    { Prefer: 'return=representation' });
  if (!rows || !rows.length) throw new Error('No se pudo borrar: tu cuenta no es moderadora de este canal.');
  markDeleted('starvios', messageId);
}

async function starviosBan(userId, minutes) {
  const s = svRequireStream();
  await svAuthed('POST', 'rpc/moderate_chat_user',
    { _channel: s.channelId, _user: userId, _minutes: minutes || SV_BAN_MINUTES, _reason: 'Chat M' });
}

/* =========================================================
   Plataformas: qué se puede hacer en cada una
   ========================================================= */
const PROVIDERS = {
  twitch: {
    logged: () => !!auth,
    send: (text, reply) => twitchSend(text, reply && reply.id),
    del: (m) => twitchDelete(m.id),
    ban: (m, minutes) => twitchBan(m.userId, minutes ? minutes * 60 : null),
  },
  kick: {
    logged: () => !!kickAuth,
    send: (text, reply) => kickSend(text, reply && reply.id),
    del: (m) => kickDelete(m.id),
    ban: (m, minutes) => kickBan(m.userId, minutes),
  },
  starvios: {
    logged: () => !!svAuth,
    send: (text, reply) => starviosSend(text, reply && reply.id),
    del: (m) => starviosDelete(m.id),
    ban: (m, minutes) => starviosBan(m.userId, minutes),
  },
};

/* =========================================================
   Acciones sobre mensajes
   ========================================================= */
const actions = $('#actions');
let current = null;
let replyTarget = null;

function openActions(m) {
  current = m;
  const plat = $('#act-platform');
  plat.className = 'badge-platform ' + m.platform;
  plat.textContent = PLATFORM_NAMES[m.platform];
  $('#act-user').textContent = m.user;
  $('#act-text').textContent = m.parts.map((p) => p.text || p.alt).join('');

  const canMod = PROVIDERS[m.platform].logged();
  const note = $('#act-note');
  note.hidden = canMod;
  note.textContent = `Inicia sesión con ${PLATFORM_NAMES[m.platform]} en ⚙ Ajustes para responder y moderar.`;

  actions.querySelector('[data-act="reply"]').disabled = !canMod;
  actions.querySelector('[data-act="mention"]').disabled = false;
  for (const b of actions.querySelectorAll('.mod')) b.disabled = !canMod;
  actions.showModal();
}

actions.addEventListener('click', async (e) => {
  if (e.target === actions) { actions.close(); return; }
  const btn = e.target.closest('button[data-act]');
  if (!btn || !current) return;
  const m = current;
  const act = btn.dataset.act;

  if (act === 'close') { actions.close(); return; }
  if (act === 'mention') {
    actions.close();
    const input = $('#input');
    input.value = `@${m.user} ` + input.value;
    input.focus();
    return;
  }
  if (act === 'reply') {
    actions.close();
    replyTarget = m;
    $('#target').value = m.platform;
    updateComposer();
    $('#reply-text').textContent = `↪ Respondiendo a @${m.user} en ${PLATFORM_NAMES[m.platform]}`;
    $('#reply-bar').hidden = false;
    $('#input').focus();
    return;
  }
  const name = PLATFORM_NAMES[m.platform];
  if (act === 'ban' && !confirm(`¿Banear permanentemente a ${m.user} de ${name}?`)) return;

  const p = PROVIDERS[m.platform];
  btn.disabled = true;
  try {
    if (act === 'delete') { await p.del(m); toast('Mensaje borrado.'); }
    if (act === 'timeout60') { await p.ban(m, 1); toast(`${m.user}: timeout de 1 min en ${name}.`); }
    if (act === 'timeout600') { await p.ban(m, 10); toast(`${m.user}: timeout de 10 min en ${name}.`); }
    if (act === 'ban') { await p.ban(m, null); toast(`${m.user} fue baneado de ${name}.`); }
    actions.close();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

$('#reply-cancel').addEventListener('click', clearReply);
function clearReply() {
  replyTarget = null;
  $('#reply-bar').hidden = true;
}

/* =========================================================
   Escribir mensajes
   ========================================================= */
// Muestra en el selector solo las plataformas con sesión iniciada
function updateComposer() {
  const select = $('#target');
  const logged = PLATFORMS.filter((p) => PROVIDERS[p].logged());
  const wanted = select.value || cfg.sendTarget;
  select.replaceChildren(...logged.map((p) => new Option(PLATFORM_NAMES[p], p)));
  if (logged.includes(wanted)) select.value = wanted;

  $('#send-form').hidden = !logged.length;
  $('#login-cta').hidden = !!logged.length;
  select.className = 'target ' + select.value;
  $('#input').placeholder = `Escribe en el chat de ${PLATFORM_NAMES[select.value] || ''}…`;
  if (!logged.length || (replyTarget && replyTarget.platform !== select.value)) clearReply();
}

$('#target').addEventListener('change', () => {
  cfg.sendTarget = $('#target').value;
  saveCfg();
  updateComposer();
});

$('#login-cta').addEventListener('click', openSettings);

$('#send-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#input');
  const text = input.value.trim();
  if (!text) return;
  const btn = $('#send-btn');
  btn.disabled = true;
  try {
    await PROVIDERS[$('#target').value].send(text, replyTarget);
    input.value = '';
    clearReply();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    input.focus();
  }
});

/* =========================================================
   Ajustes
   ========================================================= */
const settings = $('#settings');
const form = $('#settings-form');

function openSettings() {
  for (const el of form.elements) {
    if (!el.name || !(el.name in cfg)) continue;
    if (el.type === 'checkbox') el.checked = !!cfg[el.name];
    else el.value = cfg[el.name];
  }
  $('#redirect-url').textContent = redirectUrl();
  updateAuthUi();
  settings.showModal();
}

function updateAuthUi() {
  const rows = [
    ['twitch', auth && auth.login],
    ['kick', kickAuth && (kickAuth.name || 'tu cuenta')],
    ['starvios', svAuth && (svAuth.email || 'tu cuenta')],
  ];
  for (const [p, who] of rows) {
    $(`#${p}-auth-status`).textContent = who ? 'Conectado como ' + who : 'Sin sesión';
    $(`#${p}-login`).hidden = !!who;
    $(`#${p}-logout`).hidden = !who;
  }
  $('#sv-credentials').hidden = !!svAuth;
}

// Vista previa del tamaño de letra mientras se mueve el control
form.elements.fontSize.addEventListener('input', (e) => {
  document.documentElement.style.setProperty('--fs', e.target.value + 'px');
});

settings.addEventListener('close', () => {
  if (settings.returnValue !== 'save') { applyView(); return; }

  const before = { ...cfg };
  for (const el of form.elements) {
    if (!el.name || !(el.name in cfg)) continue;
    if (el.type === 'checkbox') cfg[el.name] = el.checked;
    else if (el.type === 'range') cfg[el.name] = Number(el.value);
    else cfg[el.name] = el.value.trim();
  }
  saveCfg();
  applyView();
  updateWakeLock();

  if (before.twitchChannel !== cfg.twitchChannel) { twitchRoomId = null; connectTwitch(); }
  if (['kickChannel', 'kickChatroomId'].some((k) => before[k] !== cfg[k])) connectKick();
  if (before.starviosChannel !== cfg.starviosChannel) connectStarvios();
  if (before.twitchClientId !== cfg.twitchClientId && auth) twitchLogout();
  if (before.kickClientId !== cfg.kickClientId && kickAuth) kickLogout();
  if (before.kickChannel !== cfg.kickChannel) kickBroadcaster = null;
});

// Guarda lo escrito en los campos antes de salir hacia la página de inicio de sesión
function keepTyped(...names) {
  for (const n of names) cfg[n] = form.elements[n].value.trim();
  saveCfg();
}

$('#btn-settings').addEventListener('click', openSettings);
$('#twitch-login').addEventListener('click', () => { keepTyped('twitchClientId', 'twitchChannel'); twitchLogin(); });
$('#twitch-logout').addEventListener('click', twitchLogout);
$('#kick-login').addEventListener('click', () => { keepTyped('kickClientId', 'kickClientSecret', 'kickChannel'); kickLogin(); });
$('#kick-logout').addEventListener('click', () => kickLogout());
$('#starvios-login').addEventListener('click', async (e) => {
  const email = $('#sv-email').value.trim();
  const pass = $('#sv-pass');
  if (!email || !pass.value) { toast('Escribe tu correo y contraseña de Starvios.', true); return; }
  e.target.disabled = true;
  try {
    await starviosLogin(email, pass.value);
  } catch (err) {
    toast(err.message, true);
  } finally {
    pass.value = ''; // la contraseña nunca se guarda
    e.target.disabled = false;
  }
});
$('#starvios-logout').addEventListener('click', () => starviosLogout());
$('#btn-clear').addEventListener('click', () => { feed.replaceChildren(); });

// Tocar un chip muestra u oculta esa plataforma
for (const chip of document.querySelectorAll('.chip')) {
  chip.addEventListener('click', () => {
    const key = showKey(chip.dataset.platform);
    cfg[key] = !cfg[key];
    saveCfg();
    applyView();
  });
}

/* =========================================================
   Pantalla siempre encendida
   ========================================================= */
let wakeLock = null;
async function updateWakeLock() {
  try {
    if (cfg.wakeLock && document.visibilityState === 'visible' && 'wakeLock' in navigator) {
      if (!wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } else if (wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* no soportado o denegado */ }
}
document.addEventListener('visibilitychange', updateWakeLock);

/* =========================================================
   Inicio
   ========================================================= */
async function init() {
  applyView();
  updateAuthUi();
  await handleAuthRedirect();
  await handleKickRedirect();
  if (auth) validateToken(auth.token); // revisa que el token siga vigente

  connectTwitch();
  connectKick();
  connectStarvios();
  updateWakeLock();

  if (!cfg.twitchChannel && !cfg.kickChannel && !cfg.starviosChannel) {
    addSystem('twitch', '¡Bienvenido a Chat M! Toca ⚙ para poner tus canales de Twitch, Kick y Starvios.', true);
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
