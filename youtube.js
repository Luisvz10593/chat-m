'use strict';

/* =========================================================
   YouTube — chat en vivo con la API oficial (YouTube Data API v3)
   - Leer: con tu sesión de Google o con una clave de API (no caduca)
   - Escribir, borrar, timeout y ban: con tu sesión de Google
   - Eventos: Super Chats, Super Stickers, miembros nuevos, membresías
     regaladas, hitos de membresía y regalos
   Cada lectura gasta cuota de Google (10 000 unidades al día gratis);
   por eso la velocidad de lectura se elige en ⚙ y se muestra cuánto se ha usado.
   El ID de cliente y la clave se escriben en la tablet; no están en el código.
   ========================================================= */
const YT_API = 'https://www.googleapis.com/youtube/v3/';
const YT_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
const YT_SPEEDS = { rapida: 4000, normal: 8000, ahorro: 15000 };
const YT_COST = { 'liveChat/messages:GET': 5, 'liveChat/messages:POST': 20, 'liveChat/messages:DELETE': 20, 'liveChat/bans:POST': 200 };

let ytAuth = store.get('ytAuth', null); // { token, expiresAt, name, channelId }
let ytGen = 0;
const ytStreams = {};  // entrada ("@canal", "UC…", "v=ID") → { liveChatId, videoId, channelId, title, pageToken }
const ytTimers = new Map();
const ytSeen = new Set();

const ytLogged = () => !!ytAuth && Date.now() < ytAuth.expiresAt - 30000;

/* ---------- Cuota usada hoy (aprox., el día de Google cambia a medianoche del Pacífico) ---------- */
const ytDay = () => new Date(Date.now() - 8 * 3600e3).toISOString().slice(0, 10);
function ytQuota() {
  const q = store.get('ytQuota', { day: '', used: 0 });
  return q.day === ytDay() ? q : { day: ytDay(), used: 0 };
}
function ytSpend(units) {
  const q = ytQuota();
  q.used += units;
  store.set('ytQuota', q);
}

/* ---------- Llamadas a la API ---------- */
async function yt(method, path, params = {}, body, { needAuth = false } = {}) {
  const q = new URLSearchParams(params);
  const headers = { Accept: 'application/json' };
  if (ytLogged()) headers.Authorization = 'Bearer ' + ytAuth.token;
  else if (!needAuth && method === 'GET' && cfg.youtubeApiKey) q.set('key', cfg.youtubeApiKey);
  else if (ytAuth) { ytShowRenew(); throw new Error('Tu sesión de YouTube caducó: toca "Renovar YouTube" arriba.'); }
  else throw new Error('Inicia sesión con YouTube en ⚙ Ajustes' + (needAuth ? '.' : ' o escribe una clave de API.'));
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(YT_API + path + '?' + q, { method, headers, body: body ? JSON.stringify(body) : undefined });
  ytSpend(YT_COST[path + ':' + method] || 1);
  if (r.status === 204) return {};
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    let reason = j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason;
    if (/API key not valid|API_KEY_INVALID/i.test(JSON.stringify(j))) reason = 'keyInvalid';
    if (/has not been used|is disabled|SERVICE_DISABLED/i.test(JSON.stringify(j))) reason = 'accessNotConfigured';
    if (r.status === 401 && ytAuth) { ytAuth.expiresAt = 0; store.set('ytAuth', ytAuth); ytShowRenew(); }
    const e = new Error(ytErrorText(reason, j.error && j.error.message, r.status));
    e.reason = reason;
    throw e;
  }
  return j;
}

function ytErrorText(reason, message, status) {
  return {
    quotaExceeded: 'Se acabó la cuota diaria de YouTube (se reinicia a medianoche, hora del Pacífico).',
    liveChatEnded: 'El chat de ese directo terminó.',
    liveChatNotFound: 'No se encontró el chat del directo.',
    liveChatDisabled: 'El chat de ese directo está desactivado.',
    forbidden: 'YouTube no lo permite: tu cuenta debe ser dueña o moderadora de ese chat.',
    insufficientPermissions: 'Falta permiso: vuelve a iniciar sesión con YouTube.',
    liveChatBanInsertionNotAllowed: 'No se puede banear al dueño ni a otros moderadores.',
    modificationNotAllowed: 'Ese mensaje no se puede borrar.',
    rateLimitExceeded: 'Vas muy rápido: espera un momento.',
    keyInvalid: 'La clave de API de YouTube no es válida.',
    accessNotConfigured: 'Activa "YouTube Data API v3" en tu proyecto de Google Cloud.',
  }[reason] || message || 'YouTube respondió con error ' + status;
}

/* ---------- Sesión de Google (ventanita, sin salir de la app) ---------- */
let gisLoading = null;
function loadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = res;
      s.onerror = () => { gisLoading = null; rej(new Error('No se pudo cargar el inicio de sesión de Google.')); };
      document.head.append(s);
    });
  }
  return gisLoading;
}

async function youtubeLogin() {
  if (!cfg.youtubeClientId) { toast('Primero pega el ID de cliente de Google en ⚙ Ajustes → Cuentas → YouTube.', true); return; }
  if (location.protocol === 'file:') { toast('Para iniciar sesión la app debe abrirse desde https:// o http://localhost.', true); return; }
  try {
    await loadGis();
    const client = google.accounts.oauth2.initTokenClient({
      client_id: cfg.youtubeClientId,
      scope: YT_SCOPE,
      prompt: ytAuth ? '' : 'consent',
      callback: async (resp) => {
        if (!resp || !resp.access_token) { toast('Google no dio permiso' + (resp && resp.error ? ` (${resp.error})` : '.'), true); return; }
        ytAuth = { ...(ytAuth || {}), token: resp.access_token, expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000 };
        store.set('ytAuth', ytAuth);
        $('#yt-renew').hidden = true;
        try {
          const j = await yt('GET', 'channels', { part: 'snippet', mine: 'true' });
          const c = j.items && j.items[0];
          if (c) { ytAuth.name = c.snippet.title; ytAuth.channelId = c.id; store.set('ytAuth', ytAuth); }
        } catch { /* sin canal */ }
        toast('Sesión de YouTube iniciada' + (ytAuth.name ? ' como ' + ytAuth.name : '') + '.');
        updateAuthUi();
        updateComposer();
        connectYouTube();
      },
      error_callback: (err) => toast('No se pudo iniciar sesión con Google' + (err && err.type ? ` (${err.type})` : '.'), true),
    });
    client.requestAccessToken();
  } catch (e) {
    toast(e.message, true);
  }
}

function youtubeLogout(silent) {
  if (ytAuth && ytAuth.token && window.google && google.accounts && google.accounts.oauth2) {
    try { google.accounts.oauth2.revoke(ytAuth.token, () => {}); } catch { /* ignorar */ }
  }
  ytAuth = null;
  store.set('ytAuth', null);
  $('#yt-renew').hidden = true;
  updateAuthUi();
  updateComposer();
  if (!silent) toast('Sesión de YouTube cerrada.');
}

// La sesión de Google dura ~1 h: un botón arriba la renueva con un toque
function ytShowRenew() {
  if (ytAuth) $('#yt-renew').hidden = false;
}
setInterval(() => {
  if (ytAuth && ytAuth.expiresAt && Date.now() > ytAuth.expiresAt - 5 * 60000) ytShowRenew();
}, 30000);

/* ---------- Encontrar el directo y su chat ---------- */
async function ytChannelInfo(entry) {
  const cacheKey = 'ytChan.' + entry;
  const cached = store.get(cacheKey, null);
  if (cached) return cached;
  const params = { part: 'snippet,contentDetails' };
  if (entry.startsWith('UC')) params.id = entry; else params.forHandle = entry;
  const j = await yt('GET', 'channels', params);
  const c = j.items && j.items[0];
  if (!c) throw new Error('no existe');
  const info = { id: c.id, title: c.snippet.title, uploads: c.contentDetails && c.contentDetails.relatedPlaylists && c.contentDetails.relatedPlaylists.uploads };
  store.set(cacheKey, info);
  return info;
}

async function ytFindLive(entry) {
  if (entry.startsWith('v=')) {
    const id = entry.slice(2);
    const j = await yt('GET', 'videos', { part: 'snippet,liveStreamingDetails', id });
    const v = j.items && j.items[0];
    if (!v) throw new Error('no existe');
    const chat = v.liveStreamingDetails && v.liveStreamingDetails.activeLiveChatId;
    return chat ? { liveChatId: chat, videoId: id, channelId: v.snippet.channelId, title: v.snippet.channelTitle } : { offline: true, title: v.snippet.channelTitle };
  }
  const info = await ytChannelInfo(entry);
  // Tu canal: la API da tu directo activo directamente
  if (ytLogged() && ytAuth.channelId === info.id) {
    try {
      const j = await yt('GET', 'liveBroadcasts', { part: 'snippet', broadcastStatus: 'active', broadcastType: 'all' }, null, { needAuth: true });
      const b = j.items && j.items[0];
      if (b && b.snippet.liveChatId) return { liveChatId: b.snippet.liveChatId, videoId: b.id, channelId: info.id, title: info.title };
      return { offline: true, title: info.title };
    } catch { /* sigue con la búsqueda normal */ }
  }
  // Otros canales: los directos aparecen entre sus últimos videos subidos
  if (!info.uploads) return { offline: true, title: info.title };
  const pl = await yt('GET', 'playlistItems', { part: 'contentDetails', playlistId: info.uploads, maxResults: '6' });
  const ids = (pl.items || []).map((i) => i.contentDetails.videoId).filter(Boolean);
  if (!ids.length) return { offline: true, title: info.title };
  const vids = await yt('GET', 'videos', { part: 'snippet,liveStreamingDetails', id: ids.join(',') });
  const live = (vids.items || []).find((v) => v.snippet.liveBroadcastContent === 'live' && v.liveStreamingDetails && v.liveStreamingDetails.activeLiveChatId);
  return live ? { liveChatId: live.liveStreamingDetails.activeLiveChatId, videoId: live.id, channelId: info.id, title: info.title } : { offline: true, title: info.title };
}

/* ---------- Leer el chat ---------- */
function connectYouTube() {
  ytGen++;
  for (const t of ytTimers.values()) clearTimeout(t);
  ytTimers.clear();
  for (const k of Object.keys(ytStreams)) delete ytStreams[k];
  const entries = channelsOf('youtube');
  if (!entries.length) return;
  const gen = ytGen;
  entries.forEach((e, i) => ytTimers.set(e, setTimeout(() => watchYouTube(e, gen), i * 400)));
}

async function watchYouTube(entry, gen) {
  if (gen !== ytGen) return;
  const key = srcKey('youtube', entry);
  const retry = (ms) => ytTimers.set(entry, setTimeout(() => watchYouTube(entry, gen), ms));
  if (!ytLogged() && !cfg.youtubeApiKey) {
    setStatus(key, 'err', ytAuth ? 'renueva la sesión' : 'falta sesión o clave');
    retry(30000);
    return;
  }
  setStatus(key, 'wait', 'buscando directo…');
  let live;
  try {
    live = await ytFindLive(entry);
  } catch (e) {
    if (gen !== ytGen) return;
    const fatal = { keyInvalid: 'clave no válida', accessNotConfigured: 'activa la API en Google' }[e.reason];
    setStatus(key, 'err', fatal || (e.reason === 'quotaExceeded' ? 'sin cuota' : e.message === 'no existe' ? 'no existe' : 'reintentando…'));
    if (fatal) toast('YouTube: ' + e.message, true);
    if (e.message !== 'no existe' && !fatal) retry(e.reason === 'quotaExceeded' ? 30 * 60000 : 60000);
    return;
  }
  if (gen !== ytGen) return;
  if (live.title) setChanLabel(key, live.title);
  if (live.offline) {
    delete ytStreams[entry];
    setStatus(key, 'off', 'fuera de directo');
    retry(120000); // revisa cada 2 min si ya empezó (3 unidades)
    return;
  }
  ytStreams[entry] = { ...live, pageToken: null, first: true };
  pollYouTube(entry, gen);
}

async function pollYouTube(entry, gen) {
  if (gen !== ytGen) return;
  const key = srcKey('youtube', entry);
  const s = ytStreams[entry];
  if (!s) return;
  let wait = YT_SPEEDS[cfg.ytPollSpeed] || YT_SPEEDS.normal;
  try {
    const params = { liveChatId: s.liveChatId, part: 'snippet,authorDetails', maxResults: '200', profileImageSize: '32' };
    if (s.pageToken) params.pageToken = s.pageToken;
    const j = await yt('GET', 'liveChat/messages', params);
    if (gen !== ytGen) return;
    s.pageToken = j.nextPageToken || s.pageToken;
    // La primera vez solo muestra los últimos mensajes, no todo el historial
    const items = j.items || [];
    (s.first ? items.slice(-30) : items).forEach((it) => ytHandle(it, entry));
    s.first = false;
    if (j.offlineAt) throw Object.assign(new Error('fin'), { reason: 'liveChatEnded' });
    setStatus(key, 'ok', 'YouTube');
    wait = Math.max(wait, Number(j.pollingIntervalMillis) || 0);
  } catch (e) {
    if (gen !== ytGen) return;
    if (['liveChatEnded', 'liveChatNotFound', 'liveChatDisabled'].includes(e.reason)) {
      delete ytStreams[entry];
      setStatus(key, 'off', 'fuera de directo');
      ytTimers.set(entry, setTimeout(() => watchYouTube(entry, gen), 60000));
      return;
    }
    setStatus(key, 'err', e.reason === 'quotaExceeded' ? 'sin cuota' : ytLogged() || cfg.youtubeApiKey ? 'reintentando…' : 'renueva la sesión');
    wait = e.reason === 'quotaExceeded' ? 30 * 60000 : 15000;
  }
  ytTimers.set(entry, setTimeout(() => pollYouTube(entry, gen), wait));
}

// Un mensaje o evento del chat de YouTube
function ytHandle(it, entry) {
  if (!it || !it.id || ytSeen.has(it.id)) return;
  ytSeen.add(it.id);
  if (ytSeen.size > 4000) ytSeen.delete(ytSeen.values().next().value);
  const sn = it.snippet || {};
  const a = it.authorDetails || {};
  const name = a.displayName || '?';
  const time = sn.publishedAt ? new Date(sn.publishedAt) : new Date();
  const badges = [];
  if (a.isChatOwner) badges.push('broadcaster');
  if (a.isChatModerator) badges.push('moderator');
  if (a.isChatSponsor) badges.push('member');
  if (a.isVerified) badges.push('verified');
  const msg = (text, extra = {}) => addMessage({
    platform: 'youtube', channel: entry, id: it.id, userId: a.channelId || sn.authorChannelId,
    user: name, login: name.replace(/^@/, ''), color: nameColor(name), badges, parts: [{ text: text || '' }], time, ...extra,
  });
  const nf = (n) => Number(n || 0).toLocaleString('es');
  switch (sn.type) {
    case 'textMessageEvent':
      msg((sn.textMessageDetails && sn.textMessageDetails.messageText) || sn.displayMessage);
      break;
    case 'superChatEvent': {
      const d = sn.superChatDetails || {};
      addMessage({
        platform: 'youtube', channel: entry, id: it.id, userId: a.channelId, user: name, login: name, color: nameColor(name), badges, time,
        parts: [{ text: `💰 Super Chat ${d.amountDisplayString || ''}${d.userComment ? ' · ' + d.userComment : ''}` }], event: true,
      });
      break;
    }
    case 'superStickerEvent': {
      const d = sn.superStickerDetails || {};
      addSystem('youtube', `💰 ${name} envió un Super Sticker de ${d.amountDisplayString || ''}${d.superStickerMetadata && d.superStickerMetadata.altText ? ' (' + d.superStickerMetadata.altText + ')' : ''}`, true, entry);
      break;
    }
    case 'newSponsorEvent': {
      const d = sn.newSponsorDetails || {};
      addSystem('youtube', `⭐ ${name} ${d.isUpgrade ? 'mejoró su membresía' : 'se hizo miembro'}${d.memberLevelName ? ' (' + d.memberLevelName + ')' : ''}`, true, entry);
      break;
    }
    case 'memberMilestoneChatEvent': {
      const d = sn.memberMilestoneChatDetails || {};
      addMessage({
        platform: 'youtube', channel: entry, id: it.id, userId: a.channelId, user: name, login: name, color: nameColor(name), badges, time,
        parts: [{ text: `⭐ ${d.memberMonth || '?'} meses de miembro${d.userComment ? ' · ' + d.userComment : ''}` }], event: true,
      });
      break;
    }
    case 'membershipGiftingEvent': {
      const d = sn.membershipGiftingDetails || {};
      addSystem('youtube', `🎁 ${name} regaló ${nf(d.giftMembershipsCount)} membresías${d.giftMembershipsLevelName ? ' (' + d.giftMembershipsLevelName + ')' : ''}`, true, entry);
      break;
    }
    case 'giftMembershipReceivedEvent':
      break; // ya se avisó al regalar; uno por persona llenaría el chat
    case 'giftEvent': {
      const d = sn.giftDetails || {};
      addSystem('youtube', `🎁 ${name} envió ${d.giftName || d.altText || 'un regalo'}${d.comboCount > 1 ? ' x' + d.comboCount : ''}`, true, entry);
      break;
    }
    case 'userBannedEvent': {
      const d = sn.userBannedDetails || {};
      const who = (d.bannedUserDetails && d.bannedUserDetails.displayName) || 'alguien';
      markUserCleared('youtube', entry, who);
      if (cfg.showModLog) addSystem('youtube', `🛡 ${name} ${d.banType === 'temporary' ? `dio timeout de ${Math.round((d.banDurationSeconds || 0) / 60)} min a` : 'baneó a'} ${who}`, false, entry);
      break;
    }
    case 'messageDeletedEvent':
      markDeleted('youtube', sn.messageDeletedDetails && sn.messageDeletedDetails.deletedMessageId);
      break;
    case 'chatEndedEvent':
      addSystem('youtube', '⚫ Terminó el chat del directo', false, entry);
      break;
    default:
      break; // tombstone, encuestas…
  }
}

/* ---------- Escribir y moderar ---------- */
function ytChatOf(entry) {
  const s = ytStreams[entry];
  if (!s) throw new Error(`El canal de YouTube ${entry} no está en directo.`);
  return s.liveChatId;
}

async function ytSend(entry, text) {
  await yt('POST', 'liveChat/messages', { part: 'snippet' }, {
    snippet: { liveChatId: ytChatOf(entry), type: 'textMessageEvent', textMessageDetails: { messageText: text.slice(0, 200) } },
  }, { needAuth: true });
  const s = ytStreams[entry];
  if (s) setTimeout(() => { if (ytStreams[entry] === s) pollYouTubeNow(entry); }, 1200); // que tu mensaje aparezca rápido
}

function pollYouTubeNow(entry) {
  clearTimeout(ytTimers.get(entry));
  pollYouTube(entry, ytGen);
}

async function ytDelete(m) {
  await yt('DELETE', 'liveChat/messages', { id: m.id }, null, { needAuth: true });
  markDeleted('youtube', m.id);
}

async function ytBan(m, minutes) {
  const snippet = { liveChatId: ytChatOf(m.channel), type: minutes ? 'temporary' : 'permanent', bannedUserDetails: { channelId: m.userId } };
  if (minutes) snippet.banDurationSeconds = Math.round(minutes * 60);
  await yt('POST', 'liveChat/bans', { part: 'snippet' }, { snippet }, { needAuth: true });
  markUserCleared('youtube', m.channel, m.user);
}

/* ---------- Ajustes ---------- */
function updateYouTubeUi() {
  const card = $('#acct-youtube');
  if (!card) return;
  const who = ytAuth && (ytAuth.name || 'tu cuenta');
  const expired = !!ytAuth && !ytLogged();
  card.dataset.state = !ytAuth ? (cfg.youtubeApiKey ? 'warn' : 'off') : expired ? 'warn' : 'on';
  card.querySelector('.acct-state').textContent = !ytAuth ? (cfg.youtubeApiKey ? 'Solo lectura' : 'Sin sesión') : expired ? 'Caducó' : 'Conectado';
  const status = $('#youtube-auth-status');
  status.hidden = !ytAuth;
  status.textContent = ytAuth ? `Conectado como ${who}${expired ? ' — la sesión caducó: toca Renovar' : ''}` : '';
  $('#youtube-login').hidden = !!ytAuth && !expired;
  $('#youtube-login').textContent = expired ? 'Renovar sesión' : 'Iniciar sesión con Google';
  $('#youtube-logout').hidden = !ytAuth;
  const q = ytQuota();
  $('#yt-quota').textContent = `Cuota usada hoy (aprox.): ${q.used.toLocaleString('es')} de 10 000 unidades`;
}

$('#youtube-login').addEventListener('click', () => {
  for (const n of ['youtubeClientId', 'youtubeApiKey', 'youtubeChannel']) cfg[n] = $('#settings-form').elements[n].value.trim();
  saveCfg();
  youtubeLogin();
});
$('#youtube-logout').addEventListener('click', () => youtubeLogout());
$('#yt-renew').addEventListener('click', youtubeLogin);

// Actualiza la tarjeta de YouTube cada vez que app.js actualiza las cuentas
const _updateAuthUiBase = updateAuthUi;
updateAuthUi = function () { _updateAuthUiBase(); updateYouTubeUi(); };

if (ytAuth && !ytLogged()) ytShowRenew();
connectYouTube();
updateYouTubeUi();
