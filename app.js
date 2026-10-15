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
  sendTarget: '',  // "plataforma:canal" donde escribir
  hidden: [],      // canales ocultos, como "plataforma:canal"
  fontSize: 19,
  showTime: true,
  wakeLock: true,
};

const PLATFORMS = ['twitch', 'kick', 'starvios'];
const PLATFORM_NAMES = { twitch: 'Twitch', kick: 'Kick', starvios: 'Starvios' };
const cfg = Object.assign({}, DEFAULTS, store.get('cfg', {}));

// Cada plataforma admite varios canales separados por coma o espacio.
// También acepta el enlace del canal (twitch.tv/x, kick.com/x, starvios.com/live/x).
function cleanChannel(c) {
  return c
    .replace(/^https?:\/\//, '')
    .replace(/^(www\.|m\.)?(twitch\.tv|kick\.com|starvios\.com)\/(live\/)?/, '')
    .split(/[/?#]/)[0]
    .replace(/^[#@]/, '');
}
function channelsOf(p) {
  return [...new Set(String(cfg[p + 'Channel'] || '').toLowerCase()
    .split(/[\s,;]+/).map(cleanChannel).filter(Boolean))];
}

// fetch con límite de tiempo, para que ninguna conexión se quede "cargando" para siempre
async function fetchJson(url, opts = {}, ms = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'sin respuesta' : e.message);
  } finally {
    clearTimeout(timer);
  }
}
// Un "origen" es un canal concreto de una plataforma: "twitch:canal"
const srcKey = (p, ch) => p + ':' + ch;
const splitKey = (k) => { const i = k.indexOf(':'); return [k.slice(0, i), k.slice(i + 1)]; };
const sources = () => PLATFORMS.flatMap((p) => channelsOf(p).map((ch) => ({ p, ch, key: srcKey(p, ch) })));
const multiChannel = () => PLATFORMS.some((p) => channelsOf(p).length > 1);
const srcLabel = (p, ch) => (channelsOf(p).length > 1 ? `${PLATFORM_NAMES[p]} · ${ch}` : PLATFORM_NAMES[p]);
let auth = store.get('auth', null); // { token, login, userId }

const TWITCH_SCOPES = [
  'user:write:chat',
  'moderator:manage:chat_messages',
  'moderator:manage:banned_users',
  'channel:manage:broadcast', // título, categoría y tags del directo
  'moderator:read:followers', // eventos: follows (tu canal y donde eres mod)
  'channel:read:redemptions', // eventos: canjes de puntos (tu canal)
  // Herramientas
  'channel:manage:polls',
  'channel:manage:predictions',
  'moderator:manage:announcements',
  'moderator:manage:shoutouts',
  'moderator:manage:chat_settings',
  'channel:manage:raids',
  'channel:edit:commercial',
  'channel:read:ads',
  'channel:manage:ads',
  'clips:edit',
].join(' ');
const twitchMissingScopes = () => !!auth && TWITCH_SCOPES.split(' ').some((s) => !(auth.scopes || []).includes(s));

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

// Estado de conexión de cada canal, para pintarlo en su botón de arriba
const statusMap = {};
const chipFor = (key) => document.querySelector(`.chip[data-src="${CSS.escape(key)}"]`);

function setStatus(key, status, text) {
  statusMap[key] = { status, text };
  const chip = chipFor(key);
  if (!chip) return;
  chip.dataset.status = status;
  chip.querySelector('.state').textContent = text;
}

function renderChips() {
  const hidden = new Set(cfg.hidden);
  $('#chips').replaceChildren(...sources().map(({ p, ch, key }) => {
    const st = statusMap[key] || { status: 'wait', text: '…' };
    const b = document.createElement('button');
    b.className = 'chip ' + p;
    b.dataset.src = key;
    b.dataset.status = st.status;
    b.title = `${PLATFORM_NAMES[p]} · ${ch} (toca para ocultar o mostrar)`;
    b.setAttribute('aria-pressed', String(!hidden.has(key)));
    b.innerHTML = '<span class="dot"></span><span class="label"></span><span class="state"></span>';
    b.querySelector('.label').textContent = ch;
    b.querySelector('.state').textContent = st.text;
    b.addEventListener('click', () => {
      const set = new Set(cfg.hidden);
      if (set.has(key)) set.delete(key); else set.add(key);
      cfg.hidden = [...set];
      saveCfg();
      applyView();
    });
    return b;
  }));
}

const hideStyle = document.head.appendChild(document.createElement('style'));

function applyView() {
  document.documentElement.style.setProperty('--fs', cfg.fontSize + 'px');
  document.body.classList.toggle('hide-time', !cfg.showTime);
  document.body.classList.toggle('show-channel', multiChannel());
  // Oculta los mensajes de los canales apagados
  hideStyle.textContent = cfg.hidden.length
    ? cfg.hidden.map((k) => `.msg[data-src="${CSS.escape(k)}"]`).join(',') + '{display:none}'
    : '';
  renderChips();
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
  return [auth && auth.login, kickAuth && kickAuth.name, ...sources().map((s) => s.ch)]
    .filter(Boolean).map((n) => n.toLowerCase());
}

function chanTag(ch) {
  const tag = document.createElement('span');
  tag.className = 'chan';
  tag.textContent = '#' + ch;
  return tag;
}

/**
 * m = { platform, channel, id, userId, user, color, badges:[string],
 *       parts:[{text}|{img, alt}], time:Date, action?, replyTo? }
 */
function addMessage(m) {
  const el = document.createElement('div');
  el.className = 'msg ' + m.platform;
  el.dataset.src = srcKey(m.platform, m.channel);
  el.dataset.id = m.id || '';
  el.dataset.user = (m.user || '').toLowerCase();
  el._msg = m;

  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = fmtTime(m.time || new Date());

  const content = document.createElement('div');
  content.className = 'content';
  content.append(chanTag(m.channel));

  // Chat compartido: de qué canal viene el mensaje
  if (m.shared) {
    const sh = document.createElement('span');
    sh.className = 'shared';
    sh.dataset.room = m.shared.roomId;
    sh.title = 'Mensaje del chat compartido de otro canal';
    sh.textContent = '🤝 ' + (m.shared.name || 'chat compartido');
    content.append(sh);
    el.classList.add('from-shared');
  }

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
  if (m.event) el.classList.add('event'); // bits, donaciones…

  el.append(time, content);
  el.addEventListener('click', () => {
    // Si el usuario está seleccionando texto para copiarlo, no abre las acciones
    if (String(window.getSelection())) return;
    openActions(m, el);
  });
  pushEl(el, (m.time || new Date()).getTime());
}

function addSystem(platform, text, highlight = false, channel = null) {
  const el = document.createElement('div');
  el.className = 'msg system ' + platform + (highlight ? ' highlight' : '');
  if (channel) el.dataset.src = srcKey(platform, channel);
  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = fmtTime(new Date());
  const content = document.createElement('div');
  content.className = 'content';
  if (channel) content.append(chanTag(channel));
  content.append(text);
  el.append(time, content);
  pushEl(el, Date.now());
}

// Inserta cada mensaje en su lugar según la hora en que se escribió, no según
// cuándo llegó: así los chats de distintas plataformas quedan intercalados en orden.
function pushEl(el, t) {
  el._t = t;
  let after = feed.lastElementChild;
  while (after && after._t > t) after = after.previousElementSibling;
  if (after) after.after(el);
  else feed.prepend(el);
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

function markUserCleared(platform, channel, username) {
  const u = String(username || '').toLowerCase();
  for (const el of feed.querySelectorAll(`.msg[data-src="${CSS.escape(srcKey(platform, channel))}"]`)) {
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
    return { kick: '#53fc18', starvios: '#ff7cbc' }[platform] || '#bf94ff';
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
const twitchRooms = {}; // canal → id del broadcaster (viene en ROOMSTATE)

// Una sola conexión IRC se une a todos los canales de Twitch
function connectTwitch() {
  if (twitchWs) { twitchWs.onclose = null; twitchWs.close(); twitchWs = null; }
  const chans = channelsOf('twitch');
  if (!chans.length) return;

  for (const ch of chans) setStatus(srcKey('twitch', ch), 'wait', 'conectando…');
  const ws = twitchWs = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

  ws.onopen = () => {
    ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
    ws.send('PASS SCHMOOPIIE');
    ws.send('NICK justinfan' + Math.floor(1000 + Math.random() * 80000));
    ws.send('JOIN ' + chans.map((c) => '#' + c).join(','));
    // Twitch no avisa cuando un canal no existe: si no responde, lo marcamos
    setTimeout(() => {
      if (twitchWs !== ws) return;
      for (const ch of chans) {
        const key = srcKey('twitch', ch);
        if (statusMap[key] && statusMap[key].status === 'wait') setStatus(key, 'err', 'no encontrado');
      }
    }, 10000);
  };
  ws.onmessage = (e) => {
    for (const line of e.data.split('\r\n')) if (line) handleIrc(ws, parseIrc(line));
  };
  ws.onclose = () => {
    if (twitchWs !== ws) return;
    const wait = Math.min(30000, 1000 * 2 ** twitchRetry++);
    for (const ch of chans) setStatus(srcKey('twitch', ch), 'err', 'reconectando…');
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
  const ch = (msg.params[0] || '').replace(/^#/, '');
  const known = channelsOf('twitch').includes(ch);
  switch (command) {
    case 'PING':
      ws.send('PONG :' + (trailing || 'tmi.twitch.tv'));
      break;
    case 'ROOMSTATE':
      if (tags['room-id']) twitchRooms[ch] = tags['room-id'];
      twitchRetry = 0;
      setStatus(srcKey('twitch', ch), 'ok', 'Twitch');
      subscribeEventSub(ch); // follows y canjes de este canal, si hay sesión
      break;
    case 'PRIVMSG':
      handleTwitchMsg(tags, msg.prefix, trailing || '', ch);
      break;
    case 'CLEARMSG':
      // Puede referirse a una copia del chat compartido que no mostramos
      markDeleted('twitch', tags['target-msg-id']);
      markDeleted('twitch', twAlias.get(tags['target-msg-id']));
      break;
    case 'CLEARCHAT':
      if (trailing) markUserCleared('twitch', ch, trailing);
      else addSystem('twitch', 'El chat de Twitch fue limpiado por un moderador.', false, ch);
      break;
    case 'USERNOTICE': {
      if (twDuplicate(tags)) break; // el mismo evento llegó por otro canal del chat compartido
      // En chat compartido llega como "sharedchatnotice" y el tipo real va en "source-msg-id"
      const shared = tags['msg-id'] === 'sharedchatnotice' || isSharedTw(tags);
      const t = tags['msg-id'] === 'sharedchatnotice' ? { ...tags, 'msg-id': tags['source-msg-id'] } : tags;
      // Subs, resubs, regalos, raids, anuncios…: ícono según el tipo de evento
      const icon = TWITCH_EVENT_ICONS[t['msg-id']] || '✨';
      const sys = twitchEventText(t);
      const from = shared ? twRoomName(tags['source-room-id']) : null;
      const origin = shared ? ` (en ${from ? from : 'el chat compartido'})` : '';
      addSystem('twitch', `${icon} ${sys}${origin}${trailing ? ' — ' + trailing : ''}`, true, ch);
      break;
    }
    case 'NOTICE':
      if (known && /suspended|banned|unavailable/i.test(tags['msg-id'] || '')) {
        setStatus(srcKey('twitch', ch), 'err', 'no disponible');
      }
      if (trailing) addSystem('twitch', trailing, false, known ? ch : null);
      break;
    case 'RECONNECT':
      connectTwitch();
      break;
  }
}

const TWITCH_EVENT_ICONS = {
  sub: '⭐', resub: '⭐', subgift: '🎁', submysterygift: '🎁', giftpaidupgrade: '⭐',
  anongiftpaidupgrade: '⭐', primepaidupgrade: '⭐', raid: '🚀', announcement: '📣',
  bitsbadgetier: '💎', viewermilestone: '🔥', communitypayforward: '🎁', standardpayforward: '🎁',
};

// Twitch manda los avisos en inglés: traducimos los más comunes con sus datos
function twitchEventText(tags) {
  const who = tags['display-name'] || tags.login || 'Alguien';
  const plan = { 1000: 'Nivel 1', 2000: 'Nivel 2', 3000: 'Nivel 3', Prime: 'Prime' }[tags['msg-param-sub-plan']] || '';
  const months = Number(tags['msg-param-cumulative-months']) || 0;
  switch (tags['msg-id']) {
    case 'sub':
      return `${who} se suscribió${plan ? ' (' + plan + ')' : ''}`;
    case 'resub':
      return `${who} renovó su suscripción${plan ? ' (' + plan + ')' : ''}${months ? ` · ${months} meses` : ''}`;
    case 'subgift':
      return `${who} regaló una suscripción a ${tags['msg-param-recipient-display-name'] || 'alguien'}`;
    case 'submysterygift':
      return `${who} regaló ${tags['msg-param-mass-gift-count'] || 'varias'} suscripciones a la comunidad`;
    case 'raid':
      return `Raid de ${tags['msg-param-displayName'] || who} con ${tags['msg-param-viewerCount'] || '?'} espectadores`;
    case 'announcement':
      return `Anuncio de ${who}`;
    default:
      return tags['system-msg'] || '';
  }
}

/* ---------- Chat compartido de Twitch (Stream Together) ----------
 * Twitch reenvía los mensajes de los demás canales de la sesión a cada canal
 * participante, con "source-room-id" (canal de origen) y "source-id" (id del
 * mensaje original). Con eso: mostramos de qué canal viene, evitamos verlo
 * repetido si tienes varios de esos canales, usamos las insignias del canal
 * de origen y moderamos el mensaje original.
 */
const twKept = new Map();   // id original → id del mensaje que se dejó en pantalla
const twAlias = new Map();  // id de una copia descartada → id del que se dejó
const twRoomNames = store.get('twRoomNames', {});
const twNameLookups = new Map();

const isSharedTw = (tags) => !!tags['source-room-id'] && tags['source-room-id'] !== tags['room-id'];

// true si este mensaje ya se mostró (copia de otro canal de la sesión compartida)
function twDuplicate(tags) {
  const key = tags['source-id'] || tags.id;
  if (!key) return false;
  if (twKept.has(key)) {
    if (tags.id) twAlias.set(tags.id, twKept.get(key));
    return true;
  }
  twKept.set(key, tags.id);
  if (twKept.size > 5000) twKept.delete(twKept.keys().next().value);
  if (twAlias.size > 5000) twAlias.delete(twAlias.keys().next().value);
  return false;
}

// Nombre del canal de origen a partir de su id
function twRoomName(roomId) {
  for (const [ch, id] of Object.entries(twitchRooms)) if (id === roomId) return ch;
  if (twRoomNames[roomId]) return twRoomNames[roomId];
  if (auth && !twNameLookups.has(roomId)) {
    twNameLookups.set(roomId, helix('GET', 'users', { id: roomId }).then((j) => {
      const login = j.data && j.data[0] && j.data[0].login;
      if (!login) return;
      twRoomNames[roomId] = login;
      store.set('twRoomNames', twRoomNames);
      for (const s of feed.querySelectorAll(`.shared[data-room="${CSS.escape(roomId)}"]`)) s.textContent = '🤝 ' + login;
    }).catch(() => {}));
  }
  return null;
}

function handleTwitchMsg(tags, prefix, text, channel) {
  if (twDuplicate(tags)) return;
  const shared = isSharedTw(tags);
  let action = false;
  if (text.startsWith('\x01ACTION ')) { action = true; text = text.slice(8).replace(/\x01$/, ''); }

  // En chat compartido, las insignias que importan son las del canal de origen
  const badgeTag = shared && tags['source-badges'] != null ? tags['source-badges'] : tags.badges;
  const badges = (badgeTag || '').split(',').map((b) => b.split('/')[0]).filter((b) => BADGE_LABELS[b]);
  const replyTo = tags['reply-parent-display-name'] || null;
  // Twitch antepone "@usuario " en las respuestas: lo quitamos porque ya mostramos la referencia
  if (replyTo && text.toLowerCase().startsWith('@' + replyTo.toLowerCase() + ' ')) {
    const cut = replyTo.length + 2;
    text = text.slice(cut);
    tags.emotes = shiftEmotes(tags.emotes, cut);
  }

  const parts = twitchParts(text, tags.emotes);
  const bits = Number(tags.bits) || 0;
  if (bits) parts.unshift({ text: `💎 ${bits} bits · ` });

  addMessage({
    platform: 'twitch',
    channel,
    id: tags.id,
    userId: tags['user-id'],
    user: tags['display-name'] || prefix.split('!')[0],
    login: prefix.split('!')[0],
    color: tags.color,
    badges: [...new Set(badges)],
    parts,
    event: bits > 0,
    time: tags['tmi-sent-ts'] ? new Date(Number(tags['tmi-sent-ts'])) : new Date(),
    action,
    replyTo,
    sourceId: tags['source-id'] || null,
    shared: shared ? { roomId: tags['source-room-id'], name: twRoomName(tags['source-room-id']) } : null,
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
  closeEventSub();
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
    auth = { token, login: j.login, userId: j.user_id, scopes: j.scopes || [] };
    store.set('auth', auth);
    return true;
  } catch {
    if (auth && auth.token === token) {
      auth = null;
      store.set('auth', null);
      closeEventSub();
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
  const text = await r.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch { /* respuesta no JSON */ }
  if (r.status === 401) {
    // 401 puede ser sesión vencida o un permiso que la sesión no tiene todavía
    const stillValid = await validateToken(auth.token);
    throw new Error(stillValid
      ? `Falta un permiso (${j.message || 'sin detalle'}). Cierra sesión de Twitch en ⚙ y vuelve a iniciarla.`
      : 'Tu sesión de Twitch expiró.');
  }
  if (!r.ok) throw new Error(j.message || 'Error ' + r.status);
  return j;
}

function requireRoom(ch) {
  if (!twitchRooms[ch]) throw new Error(`Aún no hay conexión con el canal de Twitch ${ch}.`);
  return twitchRooms[ch];
}

async function twitchSend(ch, message, replyId) {
  const body = { broadcaster_id: requireRoom(ch), sender_id: auth.userId, message };
  if (replyId) body.reply_parent_message_id = replyId;
  const j = await helix('POST', 'chat/messages', null, body);
  const res = j.data && j.data[0];
  if (res && !res.is_sent) throw new Error((res.drop_reason && res.drop_reason.message) || 'Twitch no envió el mensaje.');
}

async function twitchDelete(ch, messageId, m) {
  // Chat compartido: se borra el mensaje original en su canal (si eres mod ahí);
  // si no se puede, se intenta borrar la copia del canal donde lo ves
  if (m && m.shared && m.sourceId) {
    try {
      await helix('DELETE', 'moderation/chat', {
        broadcaster_id: m.shared.roomId, moderator_id: auth.userId, message_id: m.sourceId,
      });
      return;
    } catch { /* sigue con la copia local */ }
  }
  await helix('DELETE', 'moderation/chat', {
    broadcaster_id: requireRoom(ch), moderator_id: auth.userId, message_id: messageId,
  });
}

async function twitchBan(ch, userId, duration) {
  const data = { user_id: userId, reason: 'Chat M' };
  if (duration) data.duration = duration;
  await helix('POST', 'moderation/bans', {
    broadcaster_id: requireRoom(ch), moderator_id: auth.userId,
  }, { data });
}

/* =========================================================
   TWITCH — eventos por EventSub (WebSocket oficial)
   Follows: en tu canal y en los que eres moderador.
   Canjes de puntos: solo en tu canal (Twitch no los da a mods).
   Subs, regalos, raids y bits ya llegan por el chat (IRC).
   ========================================================= */
const ES_URL = 'wss://eventsub.wss.twitch.tv/ws';
let esGen = 0;
let esWs = null;
let esSession = null;
const esSubscribed = new Set();

function closeEventSub() {
  esGen++;
  if (esWs) { esWs.onclose = null; esWs.close(); }
  esWs = null;
  esSession = null;
  esSubscribed.clear();
}

// reconnectUrl: Twitch pide mudarse a otra conexión; las suscripciones se conservan
function connectEventSub(reconnectUrl) {
  if (!reconnectUrl) closeEventSub();
  if (!auth || !channelsOf('twitch').length) return;
  const gen = ++esGen;
  const ws = new WebSocket(reconnectUrl || ES_URL);
  ws.onmessage = (e) => {
    if (gen !== esGen) return;
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    const type = msg.metadata && msg.metadata.message_type;
    if (type === 'session_welcome') {
      const old = esWs;
      esWs = ws;
      esSession = msg.payload.session.id;
      if (old && old !== ws) { old.onclose = null; old.close(); }
      if (!reconnectUrl) for (const ch of channelsOf('twitch')) subscribeEventSub(ch);
    } else if (type === 'session_reconnect') {
      connectEventSub(msg.payload.session.reconnect_url);
    } else if (type === 'notification') {
      handleEventSub(msg.payload.subscription.type, msg.payload.event);
    }
  };
  ws.onclose = () => {
    if (gen !== esGen) return;
    esSession = null;
    setTimeout(() => { if (gen === esGen) connectEventSub(); }, 10000);
  };
}

async function subscribeEventSub(ch) {
  const room = twitchRooms[ch];
  if (!esSession || !room || !auth) return;
  const subs = [['channel.follow', '2', { broadcaster_user_id: room, moderator_user_id: auth.userId }, 'moderator:read:followers']];
  if (room === auth.userId) {
    subs.push(['channel.channel_points_custom_reward_redemption.add', '1', { broadcaster_user_id: room }, 'channel:read:redemptions']);
  }
  for (const [type, version, condition, scope] of subs) {
    const key = type + ':' + room;
    if (esSubscribed.has(key) || !(auth.scopes || []).includes(scope)) continue;
    esSubscribed.add(key);
    try {
      await helix('POST', 'eventsub/subscriptions', null,
        { type, version, condition, transport: { method: 'websocket', session_id: esSession } });
    } catch { /* no eres moderador de ese canal: ahí no llegan follows */ }
  }
}

function handleEventSub(type, ev) {
  const ch = ev.broadcaster_user_login;
  if (type === 'channel.follow') {
    addSystem('twitch', `❤️ ${ev.user_name} empezó a seguir el canal`, true, ch);
  } else if (type === 'channel.channel_points_custom_reward_redemption.add') {
    const r = ev.reward || {};
    addSystem('twitch', `🏆 ${ev.user_name} canjeó "${r.title}" (${r.cost} puntos)${ev.user_input ? ' — ' + ev.user_input : ''}`, true, ch);
  }
}

/* =========================================================
   KICK — lectura consultando los últimos mensajes del canal
   (Kick retiró su WebSocket público de Pusher, el nuevo solo
   acepta conexiones desde kick.com y web.kick.com bloquea
   otras webs; kick.com/api/v2 sí responde, así que pedimos
   los últimos mensajes cada 2 segundos.)
   ========================================================= */
const KICK_POLL_MS = 2000;
let kickGen = 0;               // invalida ciclos de consulta anteriores al reconectar
const kickTimers = new Map();  // canal → temporizador de su consulta
const kickSeen = new Set();

// Los mensajes se piden con el ID del canal (no el del chatroom, que a veces es distinto)
async function resolveKickChannel(slug, allowManual) {
  if (allowManual && cfg.kickChatroomId) return String(cfg.kickChatroomId).trim();
  const cached = store.get('kickChan.' + slug, null);
  if (cached) return cached;
  // En las URL de Kick los "_" del nombre de usuario se escriben como "-"
  const j = await fetchJson('https://kick.com/api/v2/channels/' + encodeURIComponent(slug.replace(/_/g, '-')));
  if (!j || !j.id) throw new Error('no existe');
  store.set('kickChan.' + slug, String(j.id));
  return String(j.id);
}

function connectKick() {
  const gen = ++kickGen;
  for (const t of kickTimers.values()) clearTimeout(t);
  kickTimers.clear();
  const slugs = channelsOf('kick');
  // El ID manual de Ajustes → Avanzado solo aplica si hay un único canal
  for (const slug of slugs) watchKick(slug, gen, slugs.length === 1);
}

async function watchKick(slug, gen, allowManual) {
  const key = srcKey('kick', slug);
  if (gen !== kickGen) return;
  setStatus(key, 'wait', 'conectando…');
  let channelId;
  try {
    channelId = await resolveKickChannel(slug, allowManual);
  } catch (e) {
    if (gen !== kickGen) return;
    if (e.message === 'no existe' || e.message === 'HTTP 404') {
      setStatus(key, 'err', 'no existe');
      return;
    }
    // Error de red o bloqueo temporal: reintenta en 15 s
    setStatus(key, 'err', 'reintentando…');
    kickTimers.set(slug, setTimeout(() => watchKick(slug, gen, allowManual), 15000));
    return;
  }

  let prev = []; // [{id, t}] de la consulta anterior
  let fails = 0;
  const poll = async () => {
    if (gen !== kickGen) return;
    try {
      // "?t=" evita la caché de 10 s de Kick para recibir los mensajes al momento
      const j = await fetchJson(`https://kick.com/api/v2/channels/${encodeURIComponent(channelId)}/messages?t=${Date.now()}`,
        { cache: 'no-store' });
      if (gen !== kickGen) return;
      // Kick los entrega del más nuevo al más viejo
      const msgs = ((j.data && j.data.messages) || []).slice().reverse();
      prev = detectKickDeletions(msgs, prev);
      msgs.forEach((d) => handleKickMsg(d, slug));
      fails = 0;
      setStatus(key, 'ok', 'Kick');
    } catch {
      if (gen !== kickGen) return;
      fails++;
      setStatus(key, 'err', 'reintentando…');
    }
    const wait = fails ? Math.min(30000, KICK_POLL_MS * 2 ** fails) : KICK_POLL_MS;
    kickTimers.set(slug, setTimeout(poll, wait));
  };
  poll();
}

// Un mensaje que estaba en la consulta anterior y desaparece, aunque sigan
// llegando mensajes más viejos que él, fue borrado por un moderador.
function detectKickDeletions(msgs, prev) {
  const now = msgs.map((m) => ({ id: m.id, t: Date.parse(m.created_at) || 0 }));
  if (now.length && prev.length) {
    const oldest = now[0].t;
    const ids = new Set(now.map((m) => m.id));
    for (const p of prev) if (p.t > oldest && !ids.has(p.id)) markDeleted('kick', p.id);
  }
  return now;
}

function handleKickMsg(d, channel) {
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
    channel,
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
const KICK_SCOPES = 'user:read channel:read channel:write chat:write moderation:ban moderation:chat_message:manage ads:read ads:write';
const KICK_API = 'https://api.kick.com/public/v1/';
let kickAuth = store.get('kickAuth', null); // { access, refresh, expiresAt, userId, name }
const kickBroadcasters = {};                // canal → broadcaster_user_id

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
  for (const k of Object.keys(kickBroadcasters)) delete kickBroadcasters[k];
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
    scope: j.scope || (kickAuth && kickAuth.scope) || '',
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

async function kickBroadcasterId(slug) {
  if (kickBroadcasters[slug]) return kickBroadcasters[slug];
  const j = await kickApi('GET', 'channels?slug=' + encodeURIComponent(slug.replace(/_/g, '-')));
  const ch = j.data && j.data[0];
  if (!ch) throw new Error('Kick no encontró el canal ' + slug);
  kickBroadcasters[slug] = ch.broadcaster_user_id;
  return kickBroadcasters[slug];
}

async function kickSend(slug, content, replyId) {
  const body = { type: 'user', broadcaster_user_id: await kickBroadcasterId(slug), content };
  if (replyId) body.reply_to_message_id = replyId;
  await kickApi('POST', 'chat', body);
}

async function kickDelete(messageId) {
  await kickApi('DELETE', 'chat/' + encodeURIComponent(messageId));
}

async function kickBan(slug, userId, minutes) {
  const body = { broadcaster_user_id: await kickBroadcasterId(slug), user_id: Number(userId), reason: 'Chat M' };
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
  raid: '🚀 raid', reward: '🏆 canjeó una recompensa', starfall: '🌠 lluvia de estrellas', highlight: '✨ mensaje destacado',
  tts: '🔊 mensaje de voz (TTS)', confetti: '🎉 lanzó confeti', custom: '✨ evento' };

let svGen = 0;
const svTimers = new Map(); // canal → temporizador de su consulta
const svStreams = {};       // canal → { id, channelId, last } (last = created_at del último mensaje)
const svSeen = new Set();

function svGet(path) {
  return fetchJson(SV_URL + path, { headers: { apikey: SV_KEY }, cache: 'no-store' });
}

function connectStarvios() {
  const gen = ++svGen;
  for (const t of svTimers.values()) clearTimeout(t);
  svTimers.clear();
  for (const k of Object.keys(svStreams)) delete svStreams[k];
  for (const name of channelsOf('starvios')) watchStarvios(name, gen);
}

async function watchStarvios(name, gen) {
  if (gen !== svGen) return;
  const key = srcKey('starvios', name);
  setStatus(key, 'wait', 'conectando…');
  try {
    const [profile] = await svGet('profiles?select=id&username=eq.' + encodeURIComponent(name));
    if (!profile) throw new Error('no existe');
    const [stream] = await svGet('live_streams?select=id,started_at,chat_cleared_at&order=started_at.desc&limit=1&channel_id=eq.' + profile.id);
    if (!stream) throw new Error('sin directos');
    if (gen !== svGen) return;
    // Empieza desde el inicio del directo actual (o la última limpieza del chat)
    const last = [stream.started_at, stream.chat_cleared_at].filter(Boolean).sort().pop() || new Date().toISOString();
    svStreams[name] = { id: stream.id, channelId: profile.id, last };
    const recent = await svGet(`live_chat_messages?select=${SV_FIELDS}&stream_id=eq.${stream.id}`
      + `&created_at=gt.${encodeURIComponent(last)}&order=created_at.desc&limit=30`);
    if (gen !== svGen) return;
    recent.reverse().forEach((d) => handleStarviosMsg(d, name));
  } catch (e) {
    if (gen !== svGen) return;
    setStatus(key, 'err', e.message === 'no existe' ? 'no existe' : 'reintentando…');
    if (e.message !== 'no existe') svTimers.set(name, setTimeout(() => watchStarvios(name, gen), 10000));
    return;
  }

  let fails = 0;
  let polls = 0;
  const poll = async () => {
    if (gen !== svGen) return;
    const s = svStreams[name];
    try {
      const rows = await svGet(`live_chat_messages?select=${SV_FIELDS}&stream_id=eq.${s.id}`
        + `&created_at=gt.${encodeURIComponent(s.last)}&order=created_at.asc&limit=100`);
      if (gen !== svGen) return;
      rows.forEach((d) => handleStarviosMsg(d, name));
      // Cada ~10 s revisa qué mensajes borraron los moderadores
      if (++polls % 5 === 0) await svCheckDeleted(name, gen);
      fails = 0;
      setStatus(key, 'ok', 'Starvios');
    } catch {
      if (gen !== svGen) return;
      fails++;
      setStatus(key, 'err', 'reintentando…');
    }
    svTimers.set(name, setTimeout(poll, fails ? Math.min(30000, SV_POLL_MS * 2 ** fails) : SV_POLL_MS));
  };
  poll();
}

async function svCheckDeleted(name, gen) {
  const sel = `.msg[data-src="${CSS.escape(srcKey('starvios', name))}"][data-id]:not(.deleted)`;
  const shown = feed.querySelector(sel);
  if (!shown || !shown._msg) return;
  const since = shown._msg.time.toISOString();
  const rows = await svGet(`live_chat_messages?select=id&stream_id=eq.${svStreams[name].id}`
    + `&is_deleted=eq.true&created_at=gte.${encodeURIComponent(since)}`);
  if (gen !== svGen) return;
  rows.forEach((r) => markDeleted('starvios', r.id));
}

function handleStarviosMsg(d, channel) {
  if (!d || !d.id) return;
  const s = svStreams[channel];
  if (s && d.created_at > s.last) s.last = d.created_at;
  if (svSeen.has(d.id)) return;
  svSeen.add(d.id);
  if (svSeen.size > 3000) svSeen.delete(svSeen.values().next().value);

  const p = d.profiles || {};
  const user = p.display_name || p.username || '?';
  const body = d.body || '';

  if (d.kind && d.kind !== 'chat' && SV_EVENTS[d.kind]) {
    addSystem('starvios', `${user} ${SV_EVENTS[d.kind]}${body ? ' — ' + body : ''}`, true, channel);
    return;
  }

  const badges = (d.badges || []).map((b) => BADGE_ALIASES[b] || b).filter((b) => BADGE_LABELS[b]);
  const parts = [{ text: body }];
  if (d.coins > 0) parts.unshift({ text: `⭐ ${d.coins} Starvies · ` });

  addMessage({
    platform: 'starvios',
    channel,
    id: d.id,
    userId: d.user_id,
    user,
    login: p.username,
    color: p.chat_color,
    badges: [...new Set(badges)],
    parts,
    event: d.coins > 0,
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

function svRequireStream(name) {
  if (!svStreams[name]) throw new Error(`Aún no hay conexión con el directo de Starvios ${name}.`);
  return svStreams[name];
}

async function starviosSend(name, body, replyId) {
  const s = svRequireStream(name);
  if (replyId) await svAuthed('POST', 'rpc/send_live_reply', { _stream_id: s.id, _body: body, _coins: 0, _reply_to: replyId });
  else await svAuthed('POST', 'rpc/send_live_message', { _stream_id: s.id, _body: body, _coins: 0 });
}

async function starviosDelete(name, messageId) {
  const s = svRequireStream(name);
  const rows = await svAuthed('PATCH',
    `live_chat_messages?id=eq.${encodeURIComponent(messageId)}&stream_id=eq.${s.id}&select=id`,
    { is_deleted: true, deleted_by: svAuth.userId },
    { Prefer: 'return=representation' });
  if (!rows || !rows.length) throw new Error('No se pudo borrar: tu cuenta no es moderadora de este canal.');
  markDeleted('starvios', messageId);
}

async function starviosBan(name, userId, minutes) {
  const s = svRequireStream(name);
  await svAuthed('POST', 'rpc/moderate_chat_user',
    { _channel: s.channelId, _user: userId, _minutes: minutes || SV_BAN_MINUTES, _reason: 'Chat M' });
}

/* =========================================================
   Plataformas: qué se puede hacer en cada una
   ========================================================= */
// ch = canal donde actuar; m.channel = canal del mensaje
const PROVIDERS = {
  twitch: {
    logged: () => !!auth,
    send: (ch, text, reply) => twitchSend(ch, text, reply && reply.id),
    del: (m) => twitchDelete(m.channel, m.id, m),
    ban: (m, minutes) => twitchBan(m.channel, m.userId, minutes ? minutes * 60 : null),
    // Fija el mensaje arriba del chat hasta que termine el directo
    pin: (m) => helix('PUT', 'chat/pins', { broadcaster_id: requireRoom(m.channel), moderator_id: auth.userId, message_id: m.id }),
  },
  kick: {
    logged: () => !!kickAuth,
    send: (ch, text, reply) => kickSend(ch, text, reply && reply.id),
    del: (m) => kickDelete(m.id),
    ban: (m, minutes) => kickBan(m.channel, m.userId, minutes),
  },
  starvios: {
    logged: () => !!svAuth,
    send: (ch, text, reply) => starviosSend(ch, text, reply && reply.id),
    del: (m) => starviosDelete(m.channel, m.id),
    ban: (m, minutes) => starviosBan(m.channel, m.userId, minutes),
    pin: (m) => svAuthed('POST', 'rpc/pin_chat_message', { _id: m.id, _minutes: 30 }),
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
  plat.textContent = `${PLATFORM_NAMES[m.platform]} · ${m.channel}`;
  $('#act-user').textContent = m.user;
  $('#act-text').textContent = m.parts.map((p) => p.text || p.alt).join('');

  const canMod = PROVIDERS[m.platform].logged();
  const note = $('#act-note');
  if (!canMod) {
    note.hidden = false;
    note.textContent = `Inicia sesión con ${PLATFORM_NAMES[m.platform]} en ⚙ Ajustes para responder y moderar.`;
  } else if (m.shared) {
    const from = twRoomName(m.shared.roomId) || 'otro canal';
    note.hidden = false;
    note.textContent = `🤝 Mensaje del chat compartido de ${from}. Borrar actúa sobre el mensaje original `
      + `(si eres moderador ahí); timeout y ban se aplican en el canal ${m.channel}.`;
  } else {
    note.hidden = true;
  }

  actions.querySelector('[data-act="reply"]').disabled = !canMod;
  actions.querySelector('[data-act="mention"]').disabled = false;
  for (const b of actions.querySelectorAll('.mod')) b.disabled = !canMod;
  actions.querySelector('[data-act="pin"]').disabled = !canMod || !PROVIDERS[m.platform].pin;
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
    $('#target').value = srcKey(m.platform, m.channel);
    updateComposer();
    $('#reply-text').textContent = `↪ Respondiendo a @${m.user} en ${PLATFORM_NAMES[m.platform]} · ${m.channel}`;
    $('#reply-bar').hidden = false;
    $('#input').focus();
    return;
  }
  const name = `${PLATFORM_NAMES[m.platform]} (${m.channel})`;
  if (act === 'ban' && !confirm(`¿Banear permanentemente a ${m.user} de ${name}?`)) return;

  const p = PROVIDERS[m.platform];
  btn.disabled = true;
  try {
    if (act === 'delete') { await p.del(m); toast('Mensaje borrado.'); }
    if (act === 'pin') { await p.pin(m); toast(`Mensaje fijado en ${name}.`); }
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
const ALL_TARGETS = '*';

// Canales donde se puede escribir: con sesión iniciada y visibles (no ocultos arriba)
const visibleTargets = () => sources().filter((s) => PROVIDERS[s.p].logged() && !cfg.hidden.includes(s.key));

// Envía el mismo mensaje a todos los canales visibles con sesión; avisa cuáles fallaron
async function sendToAll(text) {
  const targets = visibleTargets();
  if (!targets.length) throw new Error('No hay canales visibles donde escribir.');
  const results = await Promise.allSettled(targets.map((s) => PROVIDERS[s.p].send(s.ch, text, null)));
  const failed = targets.filter((_, i) => results[i].status === 'rejected');
  if (!failed.length) {
    toast(`Enviado a ${targets.length} canales.`);
  } else if (failed.length === targets.length) {
    throw new Error('No se pudo enviar a ningún canal: ' + results[0].reason.message);
  } else {
    const names = failed.map((s) => `${PLATFORM_NAMES[s.p]} · ${s.ch}`).join(', ');
    toast(`Enviado a ${targets.length - failed.length} de ${targets.length}. Falló en: ${names}`, true);
  }
}

// El selector ofrece cada canal de las plataformas con sesión iniciada
function updateComposer() {
  const select = $('#target');
  const targets = sources().filter((s) => PROVIDERS[s.p].logged());
  const wanted = select.value || cfg.sendTarget;
  const options = targets.map((s) => new Option(srcLabel(s.p, s.ch), s.key));
  // Con más de un canal visible, "Todos" envía el mismo mensaje a todos ellos a la vez
  const visible = visibleTargets().length;
  if (visible > 1) options.unshift(new Option(`Todos los visibles (${visible})`, ALL_TARGETS));
  select.replaceChildren(...options);
  if (wanted === ALL_TARGETS ? visible > 1 : targets.some((s) => s.key === wanted)) select.value = wanted;

  const anyLogged = PLATFORMS.some((p) => PROVIDERS[p].logged());
  $('#send-form').hidden = !targets.length;
  $('#login-cta').hidden = !!targets.length;
  $('#login-cta').textContent = anyLogged
    ? 'Escribe en ⚙ Ajustes los canales de la plataforma donde iniciaste sesión'
    : 'Inicia sesión en ⚙ Ajustes para escribir y moderar';
  if (select.value === ALL_TARGETS) {
    select.className = 'target all';
    $('#input').placeholder = `Escribe en todos los canales visibles (${visible})…`;
  } else {
    const [p, ch] = select.value ? splitKey(select.value) : ['', ''];
    select.className = 'target ' + p;
    $('#input').placeholder = p ? `Escribe en ${PLATFORM_NAMES[p]} · ${ch}…` : '';
  }
  if (!targets.length || (replyTarget && srcKey(replyTarget.platform, replyTarget.channel) !== select.value)) clearReply();
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
    const target = $('#target').value;
    if (target === ALL_TARGETS) {
      await sendToAll(text);
    } else {
      const [p, ch] = splitKey(target);
      await PROVIDERS[p].send(ch, text, replyTarget);
    }
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
  // Sesiones iniciadas antes de agregar funciones nuevas no tienen sus permisos
  const outdated = {
    twitch: twitchMissingScopes(),
    kick: !!kickAuth && (kickAuth.scope === undefined
      || (!!kickAuth.scope && ['channel:write', 'ads:write'].some((s) => !kickAuth.scope.includes(s)))),
    starvios: false,
  };
  for (const [p, who] of rows) {
    const status = $(`#${p}-auth-status`);
    status.textContent = who ? 'Conectado como ' + who : 'Sin sesión';
    if (outdated[p]) status.textContent += ' — cierra sesión y vuelve a iniciarla para activar las funciones nuevas';
    status.classList.toggle('warn', outdated[p]);
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
  // Olvida los canales ocultos que ya no existen
  const keys = new Set(sources().map((s) => s.key));
  cfg.hidden = cfg.hidden.filter((k) => keys.has(k));
  saveCfg();
  applyView();
  updateWakeLock();

  if (before.twitchChannel !== cfg.twitchChannel) { connectTwitch(); connectEventSub(); }
  if (['kickChannel', 'kickChatroomId'].some((k) => before[k] !== cfg[k])) connectKick();
  if (before.starviosChannel !== cfg.starviosChannel) connectStarvios();
  if (before.twitchClientId !== cfg.twitchClientId && auth) twitchLogout();
  if (before.kickClientId !== cfg.kickClientId && kickAuth) kickLogout();
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
  // Revisa que el token siga vigente y luego activa los eventos (follows, canjes)
  if (auth) validateToken(auth.token).then((ok) => { if (ok) connectEventSub(); });

  connectTwitch();
  connectKick();
  connectStarvios();
  updateWakeLock();

  if (!sources().length) {
    addSystem('twitch', '¡Bienvenido a Chat M! Toca ⚙ para poner tus canales de Twitch, Kick y Starvios.', true);
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
