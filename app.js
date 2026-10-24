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
  showModLog: true, // acciones de moderación de otros mods como avisos en el chat
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
  'moderator:manage:automod',  // mensajes retenidos por AutoMod
  'channel:manage:redemptions', // recompensas y canjes creados desde Chat M
  'user:read:emotes',           // selector de emotes: todos los que puedes usar
  // 🛡 Moderación
  'moderation:read', 'moderator:read:banned_users', 'moderator:manage:unban_requests',
  'moderator:manage:blocked_terms', 'moderator:manage:automod_settings', 'moderator:manage:shield_mode',
  'moderator:manage:warnings', 'moderator:read:warnings', 'moderator:manage:suspicious_users',
  'moderator:read:suspicious_users', 'channel:manage:moderators', 'channel:manage:vips',
  'moderator:read:chatters', 'moderator:read:moderators', 'moderator:read:vips', 'moderator:read:chat_messages',
  // 📊 Panel
  'channel:read:subscriptions', 'bits:read', 'channel:read:goals', 'channel:read:hype_train', 'channel:read:charity',
  // 🎞 Contenido y chat
  'channel:manage:schedule', 'channel:manage:videos', 'channel:manage:clips', 'editor:manage:clips',
  'user:manage:chat_color', 'user:manage:whispers', 'user:manage:blocked_users', 'user:read:blocked_users',
  'user:read:follows', 'user:read:moderated_channels', 'user:read:whispers',
  'user:read:chat', // chat compartido: mensajes de los otros canales por EventSub
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
  renderSharedBar();
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

// Tus nombres: los de tus cuentas; si no iniciaste sesión en una plataforma,
// se usa su primer canal configurado (normalmente el tuyo)
function myNames() {
  const logged = { twitch: auth && auth.login, kick: kickAuth && kickAuth.name, starvios: svAuth && svAuth.username };
  return PLATFORMS.map((p) => logged[p] || channelsOf(p)[0])
    .filter(Boolean).map((n) => String(n).toLowerCase());
}

// Elemento en pantalla de un mensaje (para saltar al mensaje respondido)
function findMsgEl(platform, id) {
  if (!id) return null;
  const q = (x) => feed.querySelector(`.msg.${platform}[data-id="${CSS.escape(x)}"]`);
  return q(id) || (platform === 'twitch' && twAlias.has(id) ? q(twAlias.get(id)) : null);
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
    sh.textContent = '🤝 ' + (m.shared.name || 'otro canal');
    content.append(sh);
    el.classList.add('from-shared');
    el.style.setProperty('--sh', sharedColor(m.shared.roomId)); // un color por canal participante
  }

  const mine = myNames();
  const fromMe = mine.includes(String(m.login || m.user || '').toLowerCase());

  // Respuesta: muestra a quién y qué le respondieron; tocarla salta a ese mensaje
  if (m.replyTo) {
    const ref = document.createElement('div');
    ref.className = 'reply-ref';
    const who = document.createElement('b');
    who.textContent = '↪ @' + m.replyTo;
    ref.append(who);
    if (m.replyBody) ref.append(document.createTextNode(' ' + m.replyBody));
    ref.addEventListener('click', (e) => {
      const target = findMsgEl(m.platform, m.replyId);
      if (!target) return; // ya no está en pantalla: abre las acciones normales
      e.stopPropagation();
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.classList.remove('flash');
      void target.offsetWidth;
      target.classList.add('flash');
    });
    content.append(ref);
    if (!fromMe && mine.includes(String(m.replyToLogin || m.replyTo).toLowerCase())) el.classList.add('reply-me');
  }

  // Insignias: imágenes reales de Twitch si ya están cargadas (chatplus.js); si no, etiquetas de texto
  const badgeImgs = typeof twitchBadgeImgs === 'function' ? twitchBadgeImgs(m) : null;
  if (badgeImgs) content.append(...badgeImgs);
  else {
    for (const b of m.badges || []) {
      const p = document.createElement('span');
      p.className = 'pill ' + b;
      p.textContent = BADGE_LABELS[b] || b.toUpperCase();
      content.append(p);
    }
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

  // Te mencionan (@tu_nombre) → amarillo; te responden → azul (arriba)
  const plain = m.parts.map((p) => p.text || p.alt).join('').toLowerCase();
  if (!fromMe && !el.classList.contains('reply-me')
    && mine.some((n) => new RegExp('@' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w])').test(plain))) {
    el.classList.add('mention');
  }
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
    ws.send('JOIN ' + [...chans, ...twSharedJoins.keys()].map((c) => '#' + c).join(','));
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
  // Canal de otro streamer al que entramos solo por el chat compartido
  if (!known && twSharedJoins.has(ch) && command !== 'PING') { handleSharedJoinIrc(msg, ch); return; }
  switch (command) {
    case 'PING':
      ws.send('PONG :' + (trailing || 'tmi.twitch.tv'));
      break;
    case 'ROOMSTATE':
      if (tags['room-id']) twitchRooms[ch] = tags['room-id'];
      twitchRetry = 0;
      setStatus(srcKey('twitch', ch), 'ok', 'Twitch');
      subscribeEventSub(ch); // follows y canjes de este canal, si hay sesión
      checkSharedSession(ch); // ¿ya hay un chat compartido en curso?
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
      if (isSharedTw(tags)) noteSharedMsg(ch, tags['source-room-id']);
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
      renderSharedBar();
    }).catch(() => {}));
  }
  return null;
}

// Igual que twRoomName pero espera a conocer el nombre
async function twRoomNameAsync(roomId) {
  const now = twRoomName(roomId);
  if (now) return now;
  await twNameLookups.get(roomId);
  return twRoomNames[roomId] || null;
}

/* ---------- Aviso del chat compartido ----------
 * Barra arriba del chat con los canales con los que compartes, un color por
 * canal (el mismo que el borde de sus mensajes) y avisos cuando empieza o
 * termina. Se entera por EventSub (channel.shared_chat.*), consultando a Twitch
 * (shared_chat/session) y, sin sesión iniciada, al llegar mensajes de otro canal.
 */
// Sin azul ni amarillo: esos son "te respondieron" y "te mencionaron"
const SHARED_COLORS = ['#4ade80', '#f472b6', '#c084fc', '#fb923c', '#2dd4bf', '#f87171', '#a3e635', '#e879f9'];
const twRoomColors = new Map();
const twShared = {};              // canal tuyo → { ids:[ids de canal], host, fromApi, seen:{id: hora} }
const twSharedChecked = new Map(); // canal → última consulta a la API

function sharedColor(roomId) {
  if (!twRoomColors.has(roomId)) twRoomColors.set(roomId, SHARED_COLORS[twRoomColors.size % SHARED_COLORS.length]);
  return twRoomColors.get(roomId);
}

async function setSharedSession(ch, ids, host, fromApi) {
  const own = twitchRooms[ch];
  ids = [...new Set(ids.filter(Boolean))];
  const prev = twShared[ch];
  const others = ids.filter((id) => id !== own);
  if (!others.length) { endSharedSession(ch); return; }
  const added = others.filter((id) => !prev || !prev.ids.includes(id));
  const gone = prev ? prev.ids.filter((id) => id !== own && !ids.includes(id)) : [];
  twShared[ch] = { ids, host: host || (prev && prev.host) || null, fromApi: fromApi || !!(prev && prev.fromApi), seen: (prev && prev.seen) || {} };
  for (const id of others) twShared[ch].seen[id] = twShared[ch].seen[id] || Date.now();
  renderSharedBar();
  syncSharedJoins();       // entra al chat de los demás participantes
  ensureSharedChatSub(ch); // y pide a EventSub los mensajes compartidos
  const names = async (list) => (await Promise.all(list.map(twRoomNameAsync))).map((n) => n || 'otro canal').join(', ');
  if (!prev) addSystem('twitch', `🤝 ¡Chat compartido activo! Ahora también ves los mensajes de: ${await names(others)}`, true, ch);
  else if (added.length) addSystem('twitch', `🤝 Se unió al chat compartido: ${await names(added)}`, true, ch);
  if (gone.length) addSystem('twitch', `🤝 Salió del chat compartido: ${await names(gone)}`, true, ch);
}

function endSharedSession(ch, text = '🤝 Terminó el chat compartido') {
  if (!twShared[ch]) return;
  delete twShared[ch];
  renderSharedBar();
  syncSharedJoins();
  addSystem('twitch', text, true, ch);
}

// Llegó por IRC un mensaje de otro canal: hay chat compartido aunque no lo hayamos visto empezar
function noteSharedMsg(ch, roomId) {
  const s = twShared[ch];
  if (s && s.ids.includes(roomId)) { s.seen[roomId] = Date.now(); return; }
  setSharedSession(ch, [...(s ? s.ids : [twitchRooms[ch]]), roomId], null, false);
  checkSharedSession(ch); // pide la lista completa a Twitch si hay sesión
}

async function checkSharedSession(ch, force) {
  const room = twitchRooms[ch];
  if (!auth || !room) return;
  if (!force && Date.now() - (twSharedChecked.get(ch) || 0) < 60000) return;
  twSharedChecked.set(ch, Date.now());
  try {
    const j = await helix('GET', 'shared_chat/session', { broadcaster_id: room });
    const s = j.data && j.data[0];
    if (s && (s.participants || []).length > 1) {
      setSharedSession(ch, s.participants.map((p) => p.broadcaster_id), s.host_broadcaster_id, true);
    } else {
      // Si hace poco llegaron mensajes de otros canales, la sesión sigue aunque la API tarde en saberlo
      const cur = twShared[ch];
      if (cur && Math.max(0, ...Object.values(cur.seen)) > Date.now() - 180000) return;
      endSharedSession(ch);
    }
  } catch { /* sin permiso o sin conexión: se queda lo que sabemos */ }
}

function handleSharedChatEvent(type, ev) {
  const ch = ev.broadcaster_user_login;
  if (type === 'channel.shared_chat.end') { endSharedSession(ch); return; }
  for (const p of ev.participants || []) {
    if (p.broadcaster_user_login) twRoomNames[p.broadcaster_user_id] = p.broadcaster_user_login;
  }
  store.set('twRoomNames', twRoomNames);
  setSharedSession(ch, (ev.participants || []).map((p) => p.broadcaster_user_id), ev.host_broadcaster_user_id, true);
}

// Cada minuto, con sesión de Twitch: pregunta en todos tus canales si hay chat
// compartido (empiece, cambie o termine). Sin sesión, lo da por terminado si en
// 15 min no llegó ningún mensaje de los otros canales.
setInterval(() => {
  if (auth) for (const ch of channelsOf('twitch')) checkSharedSession(ch);
  for (const [ch, s] of Object.entries(twShared)) {
    if (!channelsOf('twitch').includes(ch)) { delete twShared[ch]; renderSharedBar(); syncSharedJoins(); continue; }
    if (auth) continue;
    if (!s.fromApi && Date.now() - Math.max(...Object.values(s.seen)) > 15 * 60000) {
      endSharedSession(ch, '🤝 Parece que terminó el chat compartido (ya no llegan mensajes de otros canales)');
    }
  }
}, 60000);

function renderSharedBar() {
  const bar = $('#shared-bar');
  if (!bar) return;
  const rows = Object.entries(twShared).filter(([ch]) => !cfg.hidden.includes(srcKey('twitch', ch)));
  bar.hidden = !rows.length;
  bar.replaceChildren(...rows.map(([ch, s]) => {
    const row = document.createElement('div');
    row.className = 'shared-row';
    const title = document.createElement('span');
    title.className = 'shared-title';
    title.textContent = '🤝 Chat compartido' + (channelsOf('twitch').length > 1 ? ' en #' + ch : '') + ' con';
    row.append(title);
    for (const id of s.ids.filter((x) => x !== twitchRooms[ch])) {
      const c = document.createElement('span');
      c.className = 'shared-chip';
      c.style.setProperty('--sh', sharedColor(id));
      c.textContent = (s.host === id ? '👑 ' : '') + (twRoomName(id) || 'otro canal');
      if (s.host === id) c.title = 'Anfitrión de la sesión';
      row.append(c);
    }
    return row;
  }));
}

// viaRoom: el mensaje viene directo del canal de otro participante del chat compartido
function handleTwitchMsg(tags, prefix, text, channel, viaRoom) {
  const shared = !!viaRoom || isSharedTw(tags);
  const srcRoom = viaRoom || tags['source-room-id'];
  if (shared && !viaRoom) noteSharedMsg(channel, srcRoom);
  if (twDuplicate(tags)) return;
  let action = false;
  if (text.startsWith('\x01ACTION ')) { action = true; text = text.slice(8).replace(/\x01$/, ''); }

  // En chat compartido, las insignias que importan son las del canal de origen
  const badgeTag = shared && !viaRoom && tags['source-badges'] != null ? tags['source-badges'] : tags.badges;
  const badges = (badgeTag || '').split(',').map((b) => b.split('/')[0]).filter((b) => BADGE_LABELS[b]);
  const replyTo = tags['reply-parent-display-name'] || null;
  // Twitch antepone "@usuario " en las respuestas: lo quitamos porque ya mostramos la referencia
  if (replyTo && text.toLowerCase().startsWith('@' + replyTo.toLowerCase() + ' ')) {
    const cut = replyTo.length + 2;
    text = text.slice(cut);
    tags.emotes = shiftEmotes(tags.emotes, cut);
  }

  let parts = twitchParts(text, tags.emotes);
  const bits = Number(tags.bits) || 0;
  const roomForAssets = shared ? srcRoom : tags['room-id'];
  // Bits: "Cheer100" se muestra con su imagen animada (chatplus.js)
  if (bits && typeof cheerify === 'function') parts = cheerify(parts, roomForAssets);
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
    // Insignias completas ("subscriber/12") y canal del que tomarlas, para mostrarlas como imagen
    twBadges: (badgeTag || '').split(',').filter(Boolean).map((b) => b.split('/')),
    badgeRoom: roomForAssets,
    parts,
    event: bits > 0,
    time: tags['tmi-sent-ts'] ? new Date(Number(tags['tmi-sent-ts'])) : new Date(),
    action,
    replyTo,
    replyToLogin: tags['reply-parent-user-login'] || null,
    replyBody: tags['reply-parent-msg-body'] || null,
    replyId: tags['reply-parent-msg-id'] || null,
    sourceId: tags['source-id'] || (viaRoom ? tags.id : null),
    shared: shared ? { roomId: srcRoom, name: twRoomName(srcRoom) } : null,
  });
}

/* ---------- Respaldos para ver el chat compartido ----------
 * Twitch debería reenviar por IRC los mensajes de los otros canales, pero no
 * siempre llegan. Cuando sabemos que hay chat compartido:
 * 1) entramos también al chat de cada participante y mostramos sus mensajes
 *    en tu canal (sin los que Twitch marca como "solo en su canal");
 * 2) con sesión de Twitch, EventSub channel.chat.message (dice de qué canal viene).
 * Los repetidos se descartan con el id del mensaje original.
 */
const twSharedJoins = new Map(); // canal ajeno → tu canal donde se muestran sus mensajes

async function syncSharedJoins() {
  const want = new Map();
  for (const [ch, s] of Object.entries(twShared)) {
    for (const id of s.ids) {
      if (id === twitchRooms[ch]) continue;
      const login = await twRoomNameAsync(id);
      if (login && !channelsOf('twitch').includes(login)) want.set(login, ch);
    }
  }
  const join = [...want.keys()].filter((l) => !twSharedJoins.has(l));
  const part = [...twSharedJoins.keys()].filter((l) => !want.has(l));
  twSharedJoins.clear();
  for (const [l, c] of want) twSharedJoins.set(l, c);
  const ws = twitchWs;
  if (!ws || ws.readyState !== WebSocket.OPEN) return; // al reconectar ya entra a twSharedJoins
  if (join.length) ws.send('JOIN ' + join.map((l) => '#' + l).join(','));
  if (part.length) ws.send('PART ' + part.map((l) => '#' + l).join(','));
}

function handleSharedJoinIrc(msg, login) {
  const { tags, command, trailing } = msg;
  const owner = twSharedJoins.get(login);
  const room = tags['room-id'];
  if (room && !twRoomNames[room]) { twRoomNames[room] = login; store.set('twRoomNames', twRoomNames); }
  if (!owner || !twShared[owner]) return;
  if (room && command === 'PRIVMSG') twShared[owner].seen[room] = Date.now();
  // Copias de otros canales (llegan directo de su canal) y mensajes "solo para su canal"
  const skip = /^(1|true)$/.test(tags['source-only'] || '') || isSharedTw(tags);
  switch (command) {
    case 'PRIVMSG':
      if (!skip) handleTwitchMsg(tags, msg.prefix, trailing || '', owner, room);
      break;
    case 'USERNOTICE':
      if (skip || twDuplicate(tags)) break;
      addSystem('twitch', `${TWITCH_EVENT_ICONS[tags['msg-id']] || '✨'} ${twitchEventText(tags)} (en ${login})${trailing ? ' — ' + trailing : ''}`, true, owner);
      break;
    case 'CLEARMSG':
      markDeleted('twitch', tags['target-msg-id']);
      break;
    case 'CLEARCHAT':
      if (trailing) markUserCleared('twitch', owner, trailing);
      break;
  }
}

// EventSub: mensaje de chat; solo nos interesan los que vienen de otro canal
function handleEsChatMsg(ev) {
  const ch = ev.broadcaster_user_login;
  const src = ev.source_broadcaster_user_id;
  if (!src || src === ev.broadcaster_user_id || !channelsOf('twitch').includes(ch)) return; // lo normal llega por IRC
  if (ev.source_broadcaster_user_login && twRoomNames[src] !== ev.source_broadcaster_user_login) {
    twRoomNames[src] = ev.source_broadcaster_user_login;
    store.set('twRoomNames', twRoomNames);
  }
  noteSharedMsg(ch, src);
  if (twDuplicate({ 'source-id': ev.source_message_id, id: ev.message_id })) return;
  const msg = ev.message || {};
  const frags = [...(msg.fragments || [])];
  const reply = ev.reply || null;
  // Las respuestas empiezan con "@usuario ": ya mostramos la cita
  if (reply && frags[0] && frags[0].type === 'mention' && frags[0].mention
    && frags[0].mention.user_login === reply.parent_user_login) {
    frags.shift();
    if (frags[0] && frags[0].type === 'text') frags[0] = { ...frags[0], text: frags[0].text.replace(/^ /, '') };
  }
  let parts = frags.map((f) => (f.type === 'emote' && f.emote
    ? { img: `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(f.emote.id)}/default/dark/2.0`, alt: f.text }
    : { text: f.text }));
  if (!parts.length) parts = [{ text: msg.text || '' }];
  const bits = (ev.cheer && ev.cheer.bits) || 0;
  if (bits && typeof cheerify === 'function') parts = cheerify(parts, src);
  if (bits) parts.unshift({ text: `💎 ${bits} bits · ` });
  const badgeList = ev.source_badges || ev.badges || [];
  addMessage({
    platform: 'twitch',
    channel: ch,
    id: ev.message_id,
    userId: ev.chatter_user_id,
    user: ev.chatter_user_name || ev.chatter_user_login,
    login: ev.chatter_user_login,
    color: ev.color,
    badges: [...new Set(badgeList.map((b) => b.set_id).filter((b) => BADGE_LABELS[b]))],
    twBadges: badgeList.map((b) => [b.set_id, b.id]),
    badgeRoom: src,
    parts,
    event: bits > 0,
    time: new Date(),
    replyTo: reply ? reply.parent_user_name : null,
    replyToLogin: reply ? reply.parent_user_login : null,
    replyBody: reply ? reply.parent_message_body : null,
    replyId: reply ? reply.parent_message_id : null,
    sourceId: ev.source_message_id || null,
    shared: { roomId: src, name: twRoomName(src) },
  });
}

// Pide a EventSub los mensajes de chat de un canal con chat compartido
async function ensureSharedChatSub(ch) {
  const room = twitchRooms[ch];
  if (!esSession || !room || !auth || !(auth.scopes || []).includes('user:read:chat')) return;
  const key = 'channel.chat.message:' + room;
  if (esSubscribed.has(key)) return;
  esSubscribed.add(key);
  try {
    await helix('POST', 'eventsub/subscriptions', null, {
      type: 'channel.chat.message', version: '1',
      condition: { broadcaster_user_id: room, user_id: auth.userId },
      transport: { method: 'websocket', session_id: esSession },
    });
  } catch { esSubscribed.delete(key); }
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
      if (!reconnectUrl) {
        for (const ch of channelsOf('twitch')) subscribeEventSub(ch);
        for (const ch of Object.keys(twShared)) ensureSharedChatSub(ch);
      }
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
  const asMod = { broadcaster_user_id: room, moderator_user_id: auth.userId };
  const own = { broadcaster_user_id: room };
  // [tipo, versión, condición, permiso necesario]
  const subs = [
    ['channel.follow', '2', asMod, 'moderator:read:followers'],
    // Mensajes que AutoMod retiene para revisión, y cuando alguien los resuelve
    ['automod.message.hold', '2', asMod, 'moderator:manage:automod'],
    ['automod.message.update', '2', asMod, 'moderator:manage:automod'],
    // 🛡 Moderación: registro de acciones, sospechosos, desbaneos, escudo, advertencias
    ['channel.moderate', '2', asMod, 'moderator:read:warnings'],
    ['channel.suspicious_user.message', '1', asMod, 'moderator:read:suspicious_users'],
    ['channel.unban_request.create', '1', asMod, 'moderator:manage:unban_requests'],
    ['channel.unban_request.resolve', '1', asMod, 'moderator:manage:unban_requests'],
    ['channel.shield_mode.begin', '1', asMod, 'moderator:manage:shield_mode'],
    ['channel.shield_mode.end', '1', asMod, 'moderator:manage:shield_mode'],
    ['channel.warning.acknowledge', '1', asMod, 'moderator:read:warnings'],
    ['channel.shoutout.receive', '1', asMod, 'moderator:manage:shoutouts'],
    // Chat compartido: empieza, cambia quién participa, termina (no pide permiso)
    ['channel.shared_chat.begin', '1', own, null],
    ['channel.shared_chat.update', '1', own, null],
    ['channel.shared_chat.end', '1', own, null],
  ];
  if (room === auth.userId) {
    // Solo del canal propio
    subs.push(
      // Mensajes de tu chat: de aquí salen los del chat compartido aunque IRC no los mande
      ['channel.chat.message', '1', { broadcaster_user_id: room, user_id: auth.userId }, 'user:read:chat'],
      ['channel.channel_points_custom_reward_redemption.add', '1', own, 'channel:read:redemptions'],
      ['channel.hype_train.begin', '2', own, 'channel:read:hype_train'],
      ['channel.hype_train.progress', '2', own, 'channel:read:hype_train'],
      ['channel.hype_train.end', '2', own, 'channel:read:hype_train'],
      ['channel.goal.begin', '1', own, 'channel:read:goals'],
      ['channel.goal.progress', '1', own, 'channel:read:goals'],
      ['channel.goal.end', '1', own, 'channel:read:goals'],
      ['channel.charity_campaign.donate', '1', own, 'channel:read:charity'],
      ['channel.ad_break.begin', '1', own, 'channel:read:ads'],
      ['channel.custom_power_up_redemption.add', '1', own, 'bits:read'],
      ['channel.poll.begin', '1', own, 'channel:manage:polls'],
      ['channel.poll.end', '1', own, 'channel:manage:polls'],
      ['channel.prediction.begin', '1', own, 'channel:manage:predictions'],
      ['channel.prediction.end', '1', own, 'channel:manage:predictions'],
      ['stream.online', '1', own, 'channel:read:ads'],
      ['stream.offline', '1', own, 'channel:read:ads'],
    );
  }
  // Susurros que recibes (una sola vez por sesión, no por canal)
  subs.push(['user.whisper.message', '1', { user_id: auth.userId }, 'user:read:whispers']);
  for (const [type, version, condition, scope] of subs) {
    const key = type + ':' + (condition.broadcaster_user_id || condition.user_id);
    if (esSubscribed.has(key) || (scope && !(auth.scopes || []).includes(scope))) continue;
    esSubscribed.add(key);
    try {
      await helix('POST', 'eventsub/subscriptions', null,
        { type, version, condition, transport: { method: 'websocket', session_id: esSession } });
    } catch { /* no eres moderador de ese canal: ahí no llegan follows */ }
  }
}

// Otros módulos (Moderación, Panel) escuchan eventos con onTwitchEvent(fn)
const TW_EVENT_LISTENERS = [];
const onTwitchEvent = (fn) => TW_EVENT_LISTENERS.push(fn);

function handleEventSub(type, ev) {
  if (type === 'channel.chat.message') { handleEsChatMsg(ev); return; }
  const ch = ev.broadcaster_user_login;
  for (const fn of TW_EVENT_LISTENERS) { try { fn(type, ev); } catch (e) { console.warn(e); } }
  twitchEventToChat(type, ev, ch);
}

// Avisos en el chat para los eventos de EventSub
function twitchEventToChat(type, ev, ch) {
  const fmtN = (n) => Number(n || 0).toLocaleString('es');
  const simple = {
    'channel.hype_train.begin': () => `🚂 ¡Empezó un Hype Train! Nivel ${ev.level || 1}`,
    'channel.hype_train.end': () => `🚂 Terminó el Hype Train en el nivel ${ev.level}`,
    'channel.goal.begin': () => `🎯 Nueva meta: ${ev.description || ev.type} (${fmtN(ev.current_amount)}/${fmtN(ev.target_amount)})`,
    'channel.goal.end': () => `🎯 Meta ${ev.is_achieved ? 'lograda' : 'terminada'}: ${ev.description || ev.type} (${fmtN(ev.current_amount)}/${fmtN(ev.target_amount)})`,
    'channel.charity_campaign.donate': () => `💝 ${ev.user_name} donó ${ev.amount ? (ev.amount.value / 10 ** ev.amount.decimal_places).toLocaleString('es', { style: 'currency', currency: ev.amount.currency }) : ''} a ${ev.charity_name}`,
    'channel.ad_break.begin': () => `📺 Empezó una pausa publicitaria de ${ev.duration_seconds} s${ev.is_automatic ? ' (automática)' : ''}`,
    'channel.custom_power_up_redemption.add': () => `⚡ ${ev.user_name} usó el Power-up "${ev.reward && ev.reward.title}"`,
    'channel.poll.begin': () => `📊 Empezó la encuesta: ${ev.title}`,
    'channel.poll.end': () => `📊 Terminó la encuesta "${ev.title}"${ev.choices ? ' — ganó: ' + [...ev.choices].sort((a, b) => (b.votes || 0) - (a.votes || 0))[0].title : ''}`,
    'channel.prediction.begin': () => `🔮 Empezó la predicción: ${ev.title}`,
    'channel.prediction.end': () => `🔮 Terminó la predicción "${ev.title}"${ev.winning_outcome_id && ev.outcomes ? ' — ganó: ' + (ev.outcomes.find((o) => o.id === ev.winning_outcome_id) || {}).title : ''}`,
    'stream.online': () => '🔴 ¡El directo empezó!',
    'stream.offline': () => '⚫ El directo terminó',
    'channel.shoutout.receive': () => `📢 ${ev.from_broadcaster_user_name} te dio un shoutout`,
    'channel.shield_mode.begin': () => `🛡 ${ev.moderator_user_name} activó el modo escudo`,
    'channel.shield_mode.end': () => `🛡 ${ev.moderator_user_name} desactivó el modo escudo`,
    'channel.unban_request.create': () => `📨 ${ev.user_name} pidió que le quiten el ban: "${ev.text}"`,
    'channel.warning.acknowledge': () => `⚠️ ${ev.user_name} aceptó la advertencia`,
  };
  if (simple[type]) { addSystem('twitch', simple[type](), true, ch); return; }
  if (type.startsWith('channel.shared_chat.')) {
    handleSharedChatEvent(type, ev);
  } else if (type === 'channel.follow') {
    addSystem('twitch', `❤️ ${ev.user_name} empezó a seguir el canal`, true, ch);
  } else if (type === 'automod.message.hold') {
    addAutomodCard(ev);
  } else if (type === 'automod.message.update') {
    resolveAutomodCard(ev.message_id, ev.status, ev.moderator_user_name);
  } else if (type === 'channel.channel_points_custom_reward_redemption.add') {
    const r = ev.reward || {};
    addSystem('twitch', `🏆 ${ev.user_name} canjeó "${r.title}" (${r.cost} puntos)${ev.user_input ? ' — ' + ev.user_input : ''}`, true, ch);
  } else if (type === 'channel.suspicious_user.message') {
    const why = (ev.types || []).includes('ban_evader') || ev.ban_evasion_evaluation === 'likely' ? 'posible evasión de ban'
      : (ev.shared_ban_channel_ids || []).length ? 'baneado en otros canales' : 'usuario vigilado';
    const status = ev.low_trust_status === 'restricted' ? 'restringido (solo lo ven los mods)' : 'vigilado';
    addSystem('twitch', `👁 ${ev.user_name} (${why}, ${status}): ${(ev.message && ev.message.text) || ''}`, true, ch);
  } else if (type === 'channel.moderate' && cfg.showModLog) {
    const text = modActionText(ev);
    if (text) addSystem('twitch', '🛡 ' + text, false, ch);
  }
}

// Texto en español para una acción de moderación (channel.moderate)
function modActionText(ev) {
  const by = ev.moderator_user_name || 'Un moderador';
  const a = ev.action;
  const d = ev[a] || ev[a.replace('shared_chat_', '')] || {};
  const who = d.user_name || d.user_login || '';
  const mins = (s) => (s >= 3600 ? `${Math.round(s / 3600)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);
  const map = {
    ban: () => `${by} baneó a ${who}${d.reason ? ' — ' + d.reason : ''}`,
    timeout: () => `${by} dio timeout a ${who}${d.expires_at ? ' por ' + mins((Date.parse(d.expires_at) - Date.now()) / 1000) : ''}${d.reason ? ' — ' + d.reason : ''}`,
    unban: () => `${by} desbaneó a ${who}`,
    untimeout: () => `${by} quitó el timeout a ${who}`,
    delete: () => `${by} borró un mensaje de ${who}${d.message_body ? ': "' + d.message_body + '"' : ''}`,
    warn: () => `${by} advirtió a ${who}${d.reason ? ' — ' + d.reason : ''}`,
    clear: () => `${by} limpió el chat`,
    mod: () => `${by} hizo moderador a ${who}`,
    unmod: () => `${by} quitó moderador a ${who}`,
    vip: () => `${by} hizo VIP a ${who}`,
    unvip: () => `${by} quitó VIP a ${who}`,
    raid: () => `${by} inició un raid a ${d.user_name || d.user_login}`,
    unraid: () => `${by} canceló el raid`,
    slow: () => `${by} activó el modo lento (${d.wait_time_seconds} s)`,
    slowoff: () => `${by} desactivó el modo lento`,
    followers: () => `${by} activó solo seguidores`,
    followersoff: () => `${by} desactivó solo seguidores`,
    subscribers: () => `${by} activó solo subs`,
    subscribersoff: () => `${by} desactivó solo subs`,
    emoteonly: () => `${by} activó solo emotes`,
    emoteonlyoff: () => `${by} desactivó solo emotes`,
    uniquechat: () => `${by} activó mensajes únicos`,
    uniquechatoff: () => `${by} desactivó mensajes únicos`,
    add_blocked_term: () => `${by} bloqueó términos: ${(d.terms || []).join(', ')}`,
    remove_blocked_term: () => `${by} desbloqueó términos: ${(d.terms || []).join(', ')}`,
    add_permitted_term: () => `${by} permitió términos: ${(d.terms || []).join(', ')}`,
    remove_permitted_term: () => `${by} quitó términos permitidos: ${(d.terms || []).join(', ')}`,
    approve_unban_request: () => `${by} aprobó la solicitud de desbaneo de ${who}`,
    deny_unban_request: () => `${by} rechazó la solicitud de desbaneo de ${who}`,
  };
  const key = a.replace('shared_chat_', '');
  return map[key] ? map[key]() : `${by}: ${a}`;
}

/* ---------- AutoMod: mensajes retenidos para revisión ----------
 * Twitch no los manda al chat normal; llegan por EventSub a los moderadores.
 * Se muestran en el chat con botones para permitirlos o rechazarlos.
 */
const AUTOMOD_CATEGORIES = {
  aggressive: 'agresivo', bullying: 'acoso', disability: 'discapacidad', sexuality: 'sexualidad',
  misogyny: 'misoginia', race_ethnicity_or_religion: 'raza o religión', sex_based_terms: 'contenido sexual',
  swearing: 'groserías',
};

function addAutomodCard(ev) {
  const ch = ev.broadcaster_user_login;
  const reason = ev.reason === 'blocked_term'
    ? 'término bloqueado'
    : ev.automod ? `${AUTOMOD_CATEGORIES[ev.automod.category] || ev.automod.category}, nivel ${ev.automod.level}` : 'AutoMod';
  const text = (ev.message && ev.message.text) || ev.message || '';

  const card = document.createElement('div');
  card.className = 'msg twitch automod';
  card.dataset.src = srcKey('twitch', ch);
  card.dataset.amid = ev.message_id;
  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = fmtTime(new Date());
  const content = document.createElement('div');
  content.className = 'content';
  const head = document.createElement('div');
  head.className = 'am-head';
  head.textContent = `🛡 AutoMod retuvo un mensaje de ${ev.user_name} (${reason})`;
  const body = document.createElement('div');
  body.className = 'am-text';
  body.textContent = text;
  const actions = document.createElement('div');
  actions.className = 'am-actions';
  for (const [action, label, cls] of [['ALLOW', '✓ Permitir', 'am-allow'], ['DENY', '✕ Rechazar', 'am-deny']]) {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      for (const x of actions.querySelectorAll('button')) x.disabled = true;
      try {
        await helix('POST', 'moderation/automod/message', null, { user_id: auth.userId, msg_id: ev.message_id, action });
        resolveAutomodCard(ev.message_id, action === 'ALLOW' ? 'approved' : 'denied', auth.login);
      } catch (err) {
        toast(err.message, true);
        for (const x of actions.querySelectorAll('button')) x.disabled = false;
      }
    });
    actions.append(b);
  }
  content.append(chanTag(ch), head, body, actions);
  card.append(time, content);
  pushEl(card, Date.now());
  toast(`🛡 Mensaje retenido por AutoMod en ${ch}`);
}

function resolveAutomodCard(messageId, status, by) {
  const card = feed.querySelector(`.msg.automod[data-amid="${CSS.escape(messageId || '')}"]`);
  if (!card || card.classList.contains('resolved')) return;
  card.classList.add('resolved', status === 'approved' ? 'approved' : 'denied');
  const actions = card.querySelector('.am-actions');
  const label = { approved: '✓ Permitido', denied: '✕ Rechazado', expired: '⌛ Expiró sin revisar' }[status] || status;
  actions.replaceChildren(Object.assign(document.createElement('span'), {
    className: 'am-status', textContent: label + (by && status !== 'expired' ? ` por ${by}` : ''),
  }));
  if (typeof updateModBadge === 'function') updateModBadge();
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

/*
 * API pública de kick.com/api/v2/channels/{slug}{suffix}.
 * Algunos slugs llevan "_" y otros lo cambian por "-" (Mango_B0y → mango-b0y):
 * se prueba tal cual y, si Kick no lo encuentra, con guiones.
 */
async function kickPublic(slug, suffix = '', base = 'https://kick.com/api/v2/channels/') {
  const s = String(slug).toLowerCase();
  try {
    return await fetchJson(base + encodeURIComponent(s) + suffix);
  } catch (e) {
    if (!s.includes('_') || !/404/.test(e.message)) throw e;
    return fetchJson(base + encodeURIComponent(s.replace(/_/g, '-')) + suffix);
  }
}

// Los mensajes se piden con el ID del canal (no el del chatroom, que a veces es distinto)
async function resolveKickChannel(slug, allowManual) {
  if (allowManual && cfg.kickChatroomId) return String(cfg.kickChatroomId).trim();
  const cached = store.get('kickChan.' + slug, null);
  if (cached) return cached;
  // En las URL de Kick los "_" del nombre de usuario se escriben como "-"
  const j = await kickPublic(slug);
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
  const orig = (replyTo && meta.original_message) || {};

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
    replyBody: orig.content ? orig.content.replace(/\[emote:\d+:([^\]]*)\]/g, '$1') : null,
    replyId: orig.id || null,
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
const KICK_SCOPES = 'user:read channel:read channel:write chat:write moderation:ban moderation:chat_message:manage ads:read ads:write channel:rewards:read channel:rewards:write kicks:read';
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
  let j = await kickApi('GET', 'channels?slug=' + encodeURIComponent(slug.toLowerCase()));
  if (!(j.data && j.data[0]) && slug.includes('_')) j = await kickApi('GET', 'channels?slug=' + encodeURIComponent(slug.toLowerCase().replace(/_/g, '-')));
  const ch = j.data && j.data[0];
  if (!ch) throw new Error('Kick no encontró el canal ' + slug);
  kickBroadcasters[slug] = ch.broadcaster_user_id;
  return kickBroadcasters[slug];
}

async function kickSend(slug, content, replyId) {
  // Emotes elegidos en el selector (":nombre:") → formato de Kick
  content = await kickEmotify(slug, content);
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
    await loadStarviosEmotes(profile.id); // para mostrar ":codigo:" como imagen
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
  const parts = starviosParts(body);
  if (d.coins > 0) parts.unshift({ text: `⭐ ${d.coins} Starvies · ` });
  const reply = (d.meta && d.meta.reply) || null;

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
    replyTo: reply ? reply.display_name || reply.username || '?' : null,
    replyToLogin: reply ? reply.username : null,
    replyBody: reply ? reply.body : null,
    replyId: reply ? reply.id || d.meta.reply_to || null : null,
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
  const userId = j.user && j.user.id;
  svAuth = {
    access: j.access_token,
    refresh: j.refresh_token,
    expiresAt: Date.now() + (j.expires_in || 3600) * 1000,
    userId,
    email: j.user && j.user.email,
    username: svAuth && svAuth.userId === userId ? svAuth.username : undefined,
  };
  store.set('svAuth', svAuth);
}

// Tu nombre de usuario de Starvios (para saber cuándo te mencionan o te responden)
async function svLoadUsername() {
  if (!svAuth || svAuth.username || !svAuth.userId) return;
  try {
    const rows = await svGet(`profiles?select=username&id=eq.${svAuth.userId}`);
    if (rows[0] && rows[0].username && svAuth) {
      svAuth.username = rows[0].username;
      store.set('svAuth', svAuth);
    }
  } catch { /* se intenta de nuevo la próxima vez */ }
}
setTimeout(svLoadUsername, 1500);

async function starviosLogin(email, password) {
  await svTokenRequest('password', { email, password });
  svLoadUsername();
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
    // Advertencia oficial de Twitch: el usuario debe aceptarla antes de volver a escribir
    warn: (m, reason) => helix('POST', 'moderation/warnings', { broadcaster_id: requireRoom(m.channel), moderator_id: auth.userId },
      { data: { user_id: m.userId, reason } }),
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
  actions.querySelector('[data-act="warn"]').disabled = !canMod || !PROVIDERS[m.platform].warn;
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
    if (act === 'warn') {
      const reason = prompt(`Motivo de la advertencia para ${m.user}:`, 'Respeta las reglas del chat');
      if (!reason) return;
      await p.warn(m, reason.slice(0, 500));
      toast(`${m.user} recibió una advertencia en ${name}.`);
    }
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

// "👤 Ver usuario": tarjeta con su información y acciones (moderation.js)
$('#act-profile').addEventListener('click', () => {
  const m = current;
  actions.close();
  if (m && typeof openUserCard === 'function') openUserCard(m);
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

$('#login-cta').addEventListener('click', () => openSettings(sources().length ? 'accounts' : 'channels'));

$('#send-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#input');
  const text = input.value.trim();
  if (!text) return;
  // Solo se vuelve al campo si ya estaba activo (si no, en la tablet se abriría el teclado)
  const hadFocus = document.activeElement === input;
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
    closeEmotes();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    if (hadFocus) input.focus();
  }
});

/* =========================================================
   Ajustes
   ========================================================= */
const settings = $('#settings');
const form = $('#settings-form');

// tab: pestaña a mostrar ('channels', 'accounts', 'view', 'advanced', 'news')
function openSettings(tab) {
  if (typeof tab !== 'string') tab = null;
  for (const el of form.elements) {
    if (!el.name || !(el.name in cfg)) continue;
    if (el.type === 'checkbox') el.checked = !!cfg[el.name];
    else el.value = cfg[el.name];
  }
  $('#redirect-url').textContent = redirectUrl();
  updateAuthUi();
  settings.showModal();
  if (typeof onSettingsOpen === 'function') onSettingsOpen(tab); // pestañas (settings.js)
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
      || (!!kickAuth.scope && ['channel:write', 'ads:write', 'channel:rewards:write', 'kicks:read'].some((s) => !kickAuth.scope.includes(s)))),
    starvios: false,
  };
  for (const [p, who] of rows) {
    const status = $(`#${p}-auth-status`);
    status.textContent = who ? 'Conectado como ' + who : 'Sin sesión';
    if (outdated[p]) status.textContent += ' — cierra sesión y vuelve a iniciarla para activar las funciones nuevas';
    status.classList.toggle('warn', outdated[p]);
    $(`#${p}-login`).hidden = !!who;
    $(`#${p}-logout`).hidden = !who;
    // Tarjeta de la cuenta: etiqueta de estado y campos solo cuando no hay sesión
    const card = $(`#acct-${p}`);
    card.dataset.state = !who ? 'off' : outdated[p] ? 'warn' : 'on';
    card.querySelector('.acct-state').textContent = !who ? 'Sin sesión' : outdated[p] ? 'Falta permiso' : 'Conectado';
    for (const l of card.querySelectorAll(':scope > label')) l.hidden = !!who;
    status.hidden = !who; // sin sesión ya lo dice la etiqueta
    const extra = card.querySelector('.acct-extra');
    if (extra) extra.hidden = !who;
  }
  $('#sv-credentials').hidden = !!svAuth;
  $('#acct-dot').hidden = !PLATFORMS.some((p) => outdated[p]);
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
$('#btn-clear').addEventListener('click', () => { feed.replaceChildren(); toast('Chat limpiado'); });

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
