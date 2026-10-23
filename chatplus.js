'use strict';

/* =========================================================
   Mejoras del chat
   - Insignias reales de Twitch (imágenes) y cheermotes (bits)
   - Barra del mensaje fijado (Twitch y Starvios) con "Quitar"
   - Susurros recibidos de Twitch
   - Color de tu nombre en Twitch (en ⚙ Ajustes)
   - Agregar con un toque los canales de Twitch donde eres mod
   ========================================================= */

/* ---------- Insignias de Twitch ---------- */
const twBadgeSets = { global: null };   // sala ("global" o id del canal) → Map("set/versión" → imagen)
const twBadgeLoading = new Set();

async function loadTwitchBadges(room) {
  const key = room || 'global';
  if (twBadgeSets[key] || twBadgeLoading.has(key) || !auth) return;
  twBadgeLoading.add(key);
  try {
    const j = await helix('GET', room ? 'chat/badges' : 'chat/badges/global', room ? { broadcaster_id: room } : null);
    const map = new Map();
    for (const set of j.data || []) for (const v of set.versions || []) map.set(`${set.set_id}/${v.id}`, { img: v.image_url_2x || v.image_url_1x, title: v.title });
    twBadgeSets[key] = map;
  } catch { /* sin sesión o sin permiso: se quedan las etiquetas de texto */ }
  twBadgeLoading.delete(key);
}

// Imágenes de insignias para un mensaje de Twitch, o null si aún no hay datos
function twitchBadgeImgs(m) {
  if (m.platform !== 'twitch' || !m.twBadges || !m.twBadges.length) return null;
  if (!twBadgeSets.global) { loadTwitchBadges(null); if (m.badgeRoom) loadTwitchBadges(m.badgeRoom); return null; }
  const chan = m.badgeRoom && twBadgeSets[m.badgeRoom];
  if (m.badgeRoom && !chan) loadTwitchBadges(m.badgeRoom);
  const out = [];
  for (const [set, ver] of m.twBadges) {
    const b = (chan && chan.get(`${set}/${ver}`)) || twBadgeSets.global.get(`${set}/${ver}`);
    if (!b) continue;
    const img = document.createElement('img');
    img.className = 'tw-badge';
    img.src = b.img;
    img.alt = img.title = b.title || set;
    out.push(img);
  }
  return out;
}

/* ---------- Cheermotes (imágenes de bits) ---------- */
const cheerSets = {};   // sala → Map(prefijo en minúsculas → [{min, img}])
async function loadCheermotes(room) {
  const key = room || 'global';
  if (cheerSets[key] || !auth) return;
  cheerSets[key] = new Map();
  try {
    const j = await helix('GET', 'bits/cheermotes', room ? { broadcaster_id: room } : null);
    for (const c of j.data || []) {
      cheerSets[key].set(c.prefix.toLowerCase(), (c.tiers || []).map((t) => ({
        min: t.min_bits, img: (t.images && t.images.dark && (t.images.dark.animated || t.images.dark.static) || {})['2'],
      })).sort((a, b) => a.min - b.min));
    }
  } catch { delete cheerSets[key]; }
}

// "Cheer100" → imagen del cheermote del nivel que corresponde
function cheerify(parts, room) {
  const set = cheerSets[room || 'global'];
  if (!set) { loadCheermotes(room); return parts; }
  const out = [];
  for (const p of parts) {
    if (!p.text) { out.push(p); continue; }
    for (const word of p.text.split(/(\s+)/)) {
      const m = /^([a-z]+)(\d+)$/i.exec(word);
      const tiers = m && set.get(m[1].toLowerCase());
      if (tiers) {
        const n = Number(m[2]);
        const tier = [...tiers].reverse().find((t) => n >= t.min) || tiers[0];
        if (tier && tier.img) { out.push({ img: tier.img, alt: word }, { text: n + ' ' }); continue; }
      }
      out.push({ text: word });
    }
  }
  return out;
}

/* ---------- Mensaje fijado ---------- */
const pinned = new Map(); // canal (srcKey) → { text, user, ends, unpin }

async function refreshPinned() {
  const jobs = [];
  if (auth) {
    for (const ch of channelsOf('twitch')) {
      const room = twitchRooms[ch];
      if (!room) continue;
      jobs.push(helix('GET', 'chat/pins', { broadcaster_id: room, moderator_id: auth.userId }).then((j) => {
        const p = j.data && j.data[0];
        const key = srcKey('twitch', ch);
        if (!p) { pinned.delete(key); return; }
        pinned.set(key, {
          text: (p.message && p.message.text) || '', user: p.sender_user_name, ends: p.ends_at,
          unpin: () => helix('DELETE', 'chat/pins', { broadcaster_id: room, moderator_id: auth.userId, message_id: p.message_id }),
        });
      }).catch(() => {}));
    }
  }
  for (const name of channelsOf('starvios')) {
    const s = svStreams[name];
    if (!s) continue;
    jobs.push(svGet(`live_chat_messages?select=id,body,pinned_until,profiles:profiles!live_chat_messages_user_id_fkey(display_name,username)&stream_id=eq.${s.id}&pinned_until=gt.${encodeURIComponent(new Date().toISOString())}&order=pinned_until.desc&limit=1`).then(([p]) => {
      const key = srcKey('starvios', name);
      if (!p) { pinned.delete(key); return; }
      pinned.set(key, {
        text: p.body, user: (p.profiles && (p.profiles.display_name || p.profiles.username)) || '', ends: p.pinned_until,
        unpin: svAuth ? () => svAuthed('POST', 'rpc/pin_chat_message', { _id: p.id, _minutes: 0 }) : null,
      });
    }).catch(() => {}));
  }
  await Promise.all(jobs);
  renderPinned();
}

function renderPinned() {
  const bar = $('#pinned-bar');
  const items = [...pinned.entries()].filter(([key]) => !cfg.hidden.includes(key));
  bar.hidden = !items.length;
  bar.replaceChildren(...items.map(([key, p]) => {
    const [plat, ch] = splitKey(key);
    const row = el('div', 'pin-row');
    const txt = el('span', 'pin-text');
    txt.append(el('span', 'plat-dot ' + plat), ` 📌 ${multiChannel() ? '#' + ch + ' ' : ''}`, el('strong', null, p.user + ': '), p.text);
    row.append(txt);
    if (p.ends) {
      const left = (Date.parse(p.ends) - Date.now()) / 1000;
      if (left > 0 && left < 86400) row.append(el('span', 'sub', fmtClock(left)));
    }
    if (p.unpin) {
      const b = el('button', null, 'Quitar');
      b.type = 'button';
      b.addEventListener('click', async () => {
        try { await p.unpin(); pinned.delete(key); renderPinned(); toast('Mensaje desfijado'); } catch (e) { toast(e.message, true); }
      });
      row.append(b);
    }
    return row;
  }));
}
setTimeout(refreshPinned, 6000);
setInterval(refreshPinned, 60000);
setInterval(renderPinned, 1000 * 15);
// Tras fijar un mensaje desde el menú, se actualiza la barra
document.addEventListener('click', (e) => {
  if (e.target.closest('#actions [data-act="pin"]')) setTimeout(refreshPinned, 1500);
});

/* ---------- Susurros recibidos ---------- */
onTwitchEvent((type, ev) => {
  if (type !== 'user.whisper.message') return;
  const text = (ev.whisper && ev.whisper.text) || '';
  addSystem('twitch', `💬 Susurro de ${ev.from_user_name}: ${text}`, true);
  toast(`💬 ${ev.from_user_name}: ${text.slice(0, 80)}`);
});

/* ---------- Color de tu nombre (Twitch) ---------- */
const TW_COLORS = [
  ['blue', '#0000FF'], ['blue_violet', '#8A2BE2'], ['cadet_blue', '#5F9EA0'], ['chocolate', '#D2691E'], ['coral', '#FF7F50'],
  ['dodger_blue', '#1E90FF'], ['firebrick', '#B22222'], ['golden_rod', '#DAA520'], ['green', '#008000'], ['hot_pink', '#FF69B4'],
  ['orange_red', '#FF4500'], ['red', '#FF0000'], ['sea_green', '#2E8B57'], ['spring_green', '#00FF7F'], ['yellow_green', '#9ACD32'],
];
async function renderColorRow() {
  const row = $('#color-row');
  if (!auth) { row.replaceChildren(el('span', 'note', 'Inicia sesión con Twitch para cambiarlo.')); return; }
  let current = '';
  try { const j = await helix('GET', 'chat/color', { user_id: auth.userId }); current = ((j.data && j.data[0]) || {}).color || ''; } catch { /* sin datos */ }
  const swatches = TW_COLORS.map(([name, hex]) => {
    const b = el('button', 'swatch');
    b.type = 'button';
    b.title = name.replace(/_/g, ' ');
    b.style.background = hex;
    if (current.toUpperCase() === hex) b.classList.add('on');
    b.addEventListener('click', async () => {
      try {
        await helix('PUT', 'chat/color', { user_id: auth.userId, color: name });
        toast('Color de tu nombre actualizado');
        renderColorRow();
      } catch (e) { toast(e.message, true); }
    });
    return b;
  });
  const custom = el('input');
  custom.type = 'color';
  custom.value = /^#[0-9a-f]{6}$/i.test(current) ? current : '#9146ff';
  custom.title = 'Color personalizado (Prime o Turbo)';
  custom.addEventListener('change', async () => {
    try {
      await helix('PUT', 'chat/color', { user_id: auth.userId, color: custom.value });
      toast('Color de tu nombre actualizado');
      renderColorRow();
    } catch (e) { toast('Los colores personalizados son solo para Prime o Turbo. ' + e.message, true); }
  });
  row.replaceChildren(...swatches, custom);
}

/* ---------- Canales de Twitch donde eres moderador ---------- */
$('#add-mod-channels').addEventListener('click', async () => {
  if (!auth) { toast('Inicia sesión con Twitch primero.', true); return; }
  try {
    const logins = [];
    let after = null;
    for (let i = 0; i < 5; i++) {
      const j = await helix('GET', 'moderation/channels', { user_id: auth.userId, first: 100, ...(after ? { after } : {}) });
      logins.push(...(j.data || []).map((c) => c.broadcaster_login));
      after = j.pagination && j.pagination.cursor;
      if (!after) break;
    }
    const input = $('#settings-form').elements.twitchChannel;
    const have = new Set(input.value.toLowerCase().split(/[\s,;]+/).filter(Boolean));
    const add = [auth.login, ...logins].filter((l) => !have.has(l));
    if (!add.length) { toast('Ya tienes todos tus canales de moderación.'); return; }
    input.value = [...have, ...add].join(', ');
    toast(`Se agregaron ${add.length} canales. Toca Guardar.`);
  } catch (e) { toast(e.message, true); }
});
