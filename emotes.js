'use strict';

/* =========================================================
   Selector de emojis y emotes para escribir en el chat
   - Emojis normales (sirven en todas las plataformas)
   - Twitch: tus emotes (globales, suscripciones, canal)
   - Kick: emotes del canal, globales y emojis de Kick
   - Starvios: emotes del canal y de tu canal (":codigo:")
   En Kick se escribe ":nombre:" y al enviar se convierte a su
   formato [emote:id:nombre].
   ========================================================= */
const EMOJI_GROUPS = [
  ['Caras', '😀 😁 😂 🤣 😅 😊 😍 🥰 😘 😎 🤩 🥳 😏 😌 😴 🤔 🤨 😐 🙄 😬 😮 😱 😭 😢 😤 😡 🤯 🥵 🥶 🤡 💀 👻 😈 🤖 🙃 🫠 🫡 🤗 🤫 🤭'],
  ['Gestos', '👍 👎 👏 🙌 🙏 💪 🤝 👊 ✊ 🤞 ✌️ 🤟 🤘 👌 🤌 👋 🫶 👀 🫵 ☝️ 👆 👇 👉 👈'],
  ['Corazones', '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💖 💗 💓 💔 ❤️‍🔥 💯 💥 ✨ ⭐ 🌟 🔥 ⚡'],
  ['Celebración', '🎉 🎊 🥂 🍾 🎁 🏆 🥇 🥈 🥉 🎯 🎮 🕹️ 🎲 🎵 🎶 🎤 📣 🚀 💎 👑'],
  ['Deporte', '🏋️ 🤸 🧗 🏃 🚴 🤾 ⛹️ 🥊 🏅 💦 🥤 🍗 🥩 🍌 🥗 💤 ⏱️ 📈'],
  ['Otros', '✅ ❌ ⚠️ ❓ ❗ 💬 📌 🔔 🔕 ⏳ 🎬 📷 💻 📱 🛡️ 🔒 🔑 💰 🌙 ☀️ 🌈 🍿 ☕ 🍕'],
].map(([name, list]) => [name, list.split(' ')]);

const emoteCache = {};       // "plataforma:canal" → [{ name, img, insert, group }]
const kickEmoteMaps = {};    // canal de Kick → Map(nombre → id)
let emTab = 'emoji';
let emLoading = 0;

const emPanel = $('#emote-panel');
const emRecent = () => store.get('emojiRecent', []);

/* ---------- Abrir / cerrar ---------- */
$('#emote-btn').addEventListener('click', (e) => {
  e.preventDefault();
  if (emPanel.hidden) openEmotes(); else closeEmotes();
});
document.addEventListener('pointerdown', (e) => {
  if (!emPanel.hidden && !emPanel.contains(e.target) && e.target !== $('#emote-btn')) closeEmotes();
});

function currentTarget() {
  const v = $('#target').value;
  if (!v || v === ALL_TARGETS) return null;
  const [p, ch] = splitKey(v);
  return { p, ch };
}

function openEmotes() {
  const t = currentTarget();
  if (emTab !== 'emoji' && (!t || emTab !== t.p)) emTab = 'emoji';
  emPanel.hidden = false;
  $('#emote-search').value = '';
  renderEmoteTabs();
  renderEmotes();
}
function closeEmotes() { emPanel.hidden = true; }
// Si cambias de canal con el selector abierto, se muestran los emotes del nuevo canal
$('#target').addEventListener('change', () => { if (!emPanel.hidden) openEmotes(); });

function renderEmoteTabs() {
  const t = currentTarget();
  const tabs = [['emoji', '😀 Emojis']];
  if (t) tabs.push([t.p, `${PLATFORM_NAMES[t.p]} · ${t.ch}`]);
  $('#emote-tabs').replaceChildren(...tabs.map(([id, label]) => {
    const b = el('button', 'tl-tab', label);
    b.type = 'button';
    b.setAttribute('aria-selected', String(emTab === id));
    b.addEventListener('click', () => { emTab = id; renderEmoteTabs(); renderEmotes(); });
    return b;
  }));
  $('#emote-note').hidden = !!t;
}

$('#emote-search').addEventListener('input', renderEmotes);

/* ---------- Dibujar ---------- */
async function renderEmotes() {
  const grid = $('#emote-grid');
  const q = $('#emote-search').value.trim().toLowerCase();
  if (emTab === 'emoji') {
    const groups = [];
    const recent = emRecent();
    if (recent.length && !q) groups.push(['Recientes', recent]);
    for (const [name, list] of EMOJI_GROUPS) {
      if (!q || name.toLowerCase().includes(q)) groups.push([name, list]);
    }
    grid.replaceChildren(...groups.map(([name, list]) => emojiGroup(name, list)));
    return;
  }
  const t = currentTarget();
  if (!t) return;
  const key = srcKey(t.p, t.ch);
  if (!emoteCache[key]) {
    grid.replaceChildren(el('p', 'note', 'Cargando emotes…'));
    const seq = ++emLoading;
    try {
      emoteCache[key] = await loadEmotes(t);
    } catch (e) {
      if (seq === emLoading) grid.replaceChildren(el('p', 'st-card-error', '⚠ ' + e.message));
      return;
    }
    if (seq !== emLoading || emTab !== t.p) return;
  }
  const list = emoteCache[key].filter((e) => !q || e.name.toLowerCase().includes(q));
  if (!list.length) { grid.replaceChildren(el('p', 'note', q ? 'Sin resultados.' : 'No hay emotes disponibles.')); return; }
  const groups = new Map();
  for (const e of list) {
    if (!groups.has(e.group)) groups.set(e.group, []);
    groups.get(e.group).push(e);
  }
  grid.replaceChildren(...[...groups].map(([name, items]) => emoteGroup(name, items)));
}

function emojiGroup(name, list) {
  const box = el('div', 'em-group');
  box.append(el('h4', null, name));
  const g = el('div', 'em-grid');
  for (const ch of list) {
    const b = el('button', 'em-btn emoji', ch);
    b.type = 'button';
    b.addEventListener('click', () => {
      insertText(ch);
      store.set('emojiRecent', [ch, ...emRecent().filter((x) => x !== ch)].slice(0, 16));
    });
    g.append(b);
  }
  box.append(g);
  return box;
}

function emoteGroup(name, items) {
  const box = el('div', 'em-group');
  box.append(el('h4', null, `${name} (${items.length})`));
  const g = el('div', 'em-grid');
  for (const e of items.slice(0, 300)) {
    const b = el('button', 'em-btn');
    b.type = 'button';
    b.title = e.name;
    const img = el('img');
    img.src = e.img;
    img.alt = e.name;
    img.loading = 'lazy';
    b.append(img);
    b.addEventListener('click', () => insertText(e.insert));
    g.append(b);
  }
  box.append(g);
  return box;
}

/*
 * Posición del cursor en el campo de texto. Se recuerda aparte porque en la
 * tablet no volvemos a activar el campo al insertar (eso abría el teclado).
 */
const isTouch = matchMedia('(pointer: coarse)').matches;
let caret = null; // { start, end } o null = al final
const rememberCaret = () => {
  const i = $('#input');
  caret = { start: i.selectionStart ?? i.value.length, end: i.selectionEnd ?? i.value.length };
};
for (const ev of ['input', 'keyup', 'click', 'select', 'blur']) $('#input').addEventListener(ev, rememberCaret);
// Al enviar o vaciar el campo, el cursor vuelve al final
$('#send-form').addEventListener('submit', () => { caret = null; });

// Inserta en la posición del cursor, con espacios alrededor si hace falta
function insertText(text) {
  const input = $('#input');
  const len = input.value.length;
  const start = Math.min(caret ? caret.start : len, len);
  const end = Math.min(caret ? caret.end : len, len);
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  const pre = before && !/\s$/.test(before) ? ' ' : '';
  const post = !after.startsWith(' ') ? ' ' : '';
  input.value = before + pre + text + post + after;
  const pos = (before + pre + text + post).length;
  caret = { start: pos, end: pos };
  // En tablet/celular no se activa el campo: así el teclado no se vuelve a abrir
  if (!isTouch) {
    input.focus({ preventScroll: true });
    input.setSelectionRange(pos, pos);
  }
}

/* ---------- Cargar emotes de cada plataforma ---------- */
const TWITCH_EMOTE_GROUPS = {
  globals: 'Globales', subscriptions: 'Suscripciones', follower: 'De seguidor', bitstier: 'Bits',
  channelpoints: 'Puntos del canal', rewards: 'Premios', hypetrain: 'Hype Train', prime: 'Prime', turbo: 'Turbo',
  smilies: 'Clásicos', limitedtime: 'Por tiempo limitado', twofactor: 'Otros',
};
const twEmoteImg = (id) => `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/dark/2.0`;

async function loadEmotes(t) {
  if (t.p === 'twitch') {
    if (!auth) throw new Error('Inicia sesión con Twitch para ver tus emotes.');
    const out = [];
    if ((auth.scopes || []).includes('user:read:emotes')) {
      // Todos los emotes que puedes usar (globales, tus suscripciones, etc.)
      let after = null;
      for (let page = 0; page < 10; page++) {
        const params = { user_id: auth.userId };
        if (after) params.after = after;
        const j = await helix('GET', 'chat/emotes/user', params);
        for (const e of j.data || []) out.push({ name: e.name, img: twEmoteImg(e.id), insert: e.name, group: TWITCH_EMOTE_GROUPS[e.emote_type] || 'Otros' });
        after = j.pagination && j.pagination.cursor;
        if (!after) break;
      }
    } else {
      // Sin el permiso nuevo: emotes del canal y globales
      const room = twitchRooms[t.ch] || (t.ch === auth.login ? auth.userId : null);
      const [chan, glob] = await Promise.all([
        room ? helix('GET', 'chat/emotes', { broadcaster_id: room }) : { data: [] },
        helix('GET', 'chat/emotes/global'),
      ]);
      for (const e of chan.data || []) out.push({ name: e.name, img: twEmoteImg(e.id), insert: e.name, group: 'Del canal' });
      for (const e of glob.data || []) out.push({ name: e.name, img: twEmoteImg(e.id), insert: e.name, group: 'Globales' });
    }
    return out;
  }
  if (t.p === 'kick') {
    const sets = await kickEmoteSets(t.ch);
    const out = [];
    for (const s of sets) {
      const group = s.name === 'Global' ? 'Globales' : s.name === 'Emojis' ? 'Emojis de Kick' : `Del canal ${s.name || t.ch}`;
      for (const e of s.emotes || []) out.push({ name: e.name, img: `https://files.kick.com/emotes/${e.id}/fullsize`, insert: `:${e.name}:`, group });
    }
    return out;
  }
  // Starvios: emotes del canal y de tu propio canal
  const s = svStreams[t.ch];
  const ids = [...new Set([s && s.channelId, svAuth && svAuth.userId].filter(Boolean))];
  if (!ids.length) throw new Error('Aún no hay conexión con este canal.');
  const rows = await svGet(`channel_emotes?select=code,storage_path,channel_id&channel_id=in.(${ids.join(',')})&order=created_at`);
  return rows.map((e) => ({
    name: e.code, img: svEmoteImg(e.storage_path), insert: `:${e.code}:`,
    group: s && e.channel_id === s.channelId ? `Del canal ${t.ch}` : 'De tu canal',
  }));
}

async function kickEmoteSets(slug) {
  const sets = await kickPublic(slug, '', 'https://kick.com/emotes/');
  const map = new Map();
  for (const s of sets || []) for (const e of s.emotes || []) map.set(e.name, e.id);
  kickEmoteMaps[slug] = map;
  return sets || [];
}

// Kick: ":nombre:" → "[emote:id:nombre]" antes de enviar
async function kickEmotify(slug, text) {
  if (!/:[A-Za-z0-9_]+:/.test(text)) return text;
  if (!kickEmoteMaps[slug]) { try { await kickEmoteSets(slug); } catch { return text; } }
  const map = kickEmoteMaps[slug];
  return text.replace(/:([A-Za-z0-9_]+):/g, (m, name) => (map.has(name) ? `[emote:${map.get(name)}:${name}]` : m));
}

/* ---------- Starvios: mostrar sus emotes en los mensajes ---------- */
const svEmoteImg = (path) => 'https://starvios.com/api/public/img?' + new URLSearchParams({ p: path, w: '64', sq: '1' });
const svEmoteMap = new Map();  // código → imagen
const svEmoteLoaded = new Set();

async function loadStarviosEmotes(channelId) {
  if (!channelId || svEmoteLoaded.has(channelId)) return;
  svEmoteLoaded.add(channelId);
  try {
    for (const e of await svGet(`channel_emotes?select=code,storage_path&channel_id=eq.${channelId}`)) {
      svEmoteMap.set(e.code, svEmoteImg(e.storage_path));
    }
  } catch { svEmoteLoaded.delete(channelId); }
}

// Convierte ":codigo:" en imágenes cuando conocemos el emote
function starviosParts(text) {
  if (!svEmoteMap.size || !text.includes(':')) return [{ text }];
  const out = [];
  const re = /:([A-Za-z0-9_]+):/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    const img = svEmoteMap.get(m[1]);
    if (!img) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ img, alt: m[0] });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}
