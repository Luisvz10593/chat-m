'use strict';

/* =========================================================
   Panel "Directo": título, categoría y tags del stream
   en una plataforma o en varias a la vez. Usa las sesiones
   y funciones de app.js (auth, kickAuth, svAuth, helix…).
   Categoría unificada: { name, img, twitch?: {id}, kick?: {id} }
   ========================================================= */
const stDialog = $('#stream');
const MAX_FAVS = 12;
const MAX_RECENT = 3;
let stCategory = null;  // categoría elegida en el buscador
let stDirty = {};       // campos que el usuario cambió: { title, tags }
let stEditFavs = false;
let stSearchTimer = null;
let stSearchSeq = 0;

const catKey = (c) => c.name.trim().toLowerCase();
const favCats = () => store.get('favCats', []);
const recentCats = () => store.get('recentCats', []);

// Permisos nuevos que hacen falta para editar el directo
const needsRelogin = {
  twitch: () => auth && !(auth.scopes || []).includes('channel:manage:broadcast'),
  // Sesiones de antes de este panel no guardaban "scope"; si Kick no lo informa (''), no avisamos
  kick: () => kickAuth && (kickAuth.scope === undefined || (!!kickAuth.scope && !kickAuth.scope.includes('channel:write'))),
  starvios: () => false,
};

function streamPlatforms() {
  return PLATFORMS.filter((p) => PROVIDERS[p].logged());
}
function checkedPlatforms() {
  return [...document.querySelectorAll('#st-targets input:checked')].map((i) => i.value);
}

/* ---------- Abrir el panel ---------- */
function openStream() {
  const plats = streamPlatforms();
  $('#st-targets').replaceChildren(...plats.map((p) => {
    const label = document.createElement('label');
    label.className = 'pick ' + p;
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = p;
    box.checked = true;
    label.append(box, ' ' + PLATFORM_NAMES[p]);
    return label;
  }));

  const notes = [];
  if (!plats.length) notes.push('Inicia sesión en ⚙ Ajustes para editar tu directo.');
  for (const p of plats) {
    if (needsRelogin[p]()) notes.push(`${PLATFORM_NAMES[p]}: cierra sesión y vuelve a iniciarla en ⚙ para dar el permiso de editar el directo.`);
  }
  if (plats.includes('starvios')) notes.push('Starvios no permite cambiar tags; ahí solo se cambian título y categoría.');
  $('#st-note').textContent = notes.join(' ');
  $('#st-note').hidden = !notes.length;

  stCategory = null;
  stDirty = {};
  stEditFavs = false;
  $('#st-title').value = '';
  $('#st-tags').value = '';
  $('#st-cat-search').value = '';
  $('#st-current').textContent = '';
  $('#st-cat-results').replaceChildren();
  renderSelectedCat();
  renderFavs();
  stDialog.showModal();
  if (plats.length) loadCurrent(plats);
}

// Rellena los campos con lo que tiene ahora el directo (de la primera plataforma que responda)
async function loadCurrent(plats) {
  for (const p of plats) {
    try {
      const cur = await getCurrent(p);
      if (!cur) continue;
      if (!stDirty.title) $('#st-title').value = cur.title || '';
      if (!stDirty.tags) $('#st-tags').value = (cur.tags || []).join(', ');
      $('#st-current').textContent = `Ahora en ${PLATFORM_NAMES[p]}: ${cur.category || 'sin categoría'}`;
      return;
    } catch { /* prueba con la siguiente plataforma */ }
  }
}

async function getCurrent(p) {
  if (p === 'twitch') {
    const j = await helix('GET', 'channels', { broadcaster_id: auth.userId });
    const c = j.data && j.data[0];
    return c && { title: c.title, category: c.game_name, tags: c.tags };
  }
  if (p === 'kick') {
    const j = await kickApi('GET', 'channels');
    const c = j.data && j.data[0];
    return c && { title: c.stream_title, category: c.category && c.category.name, tags: c.stream && c.stream.custom_tags };
  }
  const s = await svOwnStream();
  return { title: s.title, category: s.category, tags: [] };
}

async function svOwnStream() {
  const [s] = await svGet(`live_streams?select=id,title,category&order=started_at.desc&limit=1&channel_id=eq.${svAuth.userId}`);
  if (!s) throw new Error('Tu cuenta de Starvios no tiene canal de directos.');
  return s;
}

/* ---------- Buscar categorías ---------- */
$('#st-cat-search').addEventListener('input', (e) => {
  clearTimeout(stSearchTimer);
  const q = e.target.value.trim();
  if (q.length < 2) { $('#st-cat-results').replaceChildren(); return; }
  stSearchTimer = setTimeout(() => runSearch(q), 400);
});

async function runSearch(q) {
  const seq = ++stSearchSeq;
  const list = $('#st-cat-results');
  list.replaceChildren(Object.assign(document.createElement('p'), { className: 'note', textContent: 'Buscando…' }));
  const results = await searchCategories(q);
  if (seq !== stSearchSeq) return;
  list.replaceChildren(...results.map(catRow));
}

async function searchCategories(q) {
  const jobs = [];
  if (auth) {
    jobs.push(helix('GET', 'search/categories', { query: q, first: 20 }).then((j) => (j.data || []).map((c) => ({
      name: c.name, img: (c.box_art_url || '').replace(/\d+x\d+/, '144x192'), twitch: { id: c.id },
    }))));
  }
  if (kickAuth) jobs.push(kickSearch(q));
  const merged = new Map();
  for (const r of await Promise.allSettled(jobs)) {
    if (r.status !== 'fulfilled') continue;
    for (const c of r.value) {
      const k = catKey(c);
      const prev = merged.get(k);
      merged.set(k, prev ? { ...c, ...prev, img: prev.img || c.img, twitch: prev.twitch || c.twitch, kick: prev.kick || c.kick } : c);
    }
  }
  const out = [...merged.values()];
  // Siempre se puede usar el texto tal cual (útil en Starvios, que acepta cualquier categoría)
  if (!out.some((c) => catKey(c) === q.toLowerCase())) out.push({ name: q });
  return out;
}

async function kickSearch(q) {
  let j;
  try { j = await kickApi('GET', 'categories?q=' + encodeURIComponent(q)); }
  catch { j = await kickApi('GET', 'categories?' + new URLSearchParams({ name: q, limit: 20 })); }
  return (j.data || []).map((c) => ({ name: c.name, img: c.thumbnail, kick: { id: c.id } }));
}

// Busca el ID de la categoría en una plataforma donde todavía no lo tenemos
async function resolveCat(cat, p) {
  if (cat[p]) return cat[p];
  let found = [];
  if (p === 'twitch') {
    const j = await helix('GET', 'search/categories', { query: cat.name, first: 20 });
    found = (j.data || []).map((c) => ({ name: c.name, id: c.id }));
  } else if (p === 'kick') {
    found = (await kickSearch(cat.name)).map((c) => ({ name: c.name, id: c.kick.id }));
  }
  const hit = found.find((c) => catKey(c) === catKey(cat));
  if (!hit) return null;
  cat[p] = { id: hit.id };
  return cat[p];
}

/* ---------- Dibujo de categorías ---------- */
function catImage(c) {
  if (c.img) {
    const img = document.createElement('img');
    img.src = c.img;
    img.alt = '';
    img.loading = 'lazy';
    return img;
  }
  const ph = document.createElement('span');
  ph.className = 'cat-ph';
  ph.textContent = c.name.slice(0, 1).toUpperCase();
  return ph;
}

function catRow(c) {
  const row = document.createElement('div');
  row.className = 'cat-row';
  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'cat-pick';
  const name = document.createElement('span');
  name.textContent = c.name;
  const where = document.createElement('small');
  where.textContent = [c.twitch && 'Twitch', c.kick && 'Kick'].filter(Boolean).join(' · ') || 'texto libre';
  name.append(document.createElement('br'), where);
  pick.append(catImage(c), name);
  pick.addEventListener('click', () => { stCategory = c; renderSelectedCat(); });

  const star = document.createElement('button');
  star.type = 'button';
  star.className = 'cat-star';
  const isFav = () => favCats().some((f) => catKey(f) === catKey(c));
  star.textContent = isFav() ? '★' : '☆';
  star.title = 'Agregar o quitar de favoritas';
  star.addEventListener('click', () => {
    toggleFav(c);
    star.textContent = isFav() ? '★' : '☆';
  });
  row.append(pick, star);
  return row;
}

function renderSelectedCat() {
  const box = $('#st-cat-selected');
  if (!stCategory) { box.replaceChildren(); return; }
  const chip = document.createElement('div');
  chip.className = 'cat-chosen';
  const txt = document.createElement('span');
  txt.textContent = 'Categoría elegida: ' + stCategory.name;
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'icon-btn small';
  x.textContent = '✕';
  x.addEventListener('click', () => { stCategory = null; renderSelectedCat(); });
  chip.append(catImage(stCategory), txt, x);
  box.replaceChildren(chip);
}

function catTile(c, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cat-tile';
  const name = document.createElement('span');
  name.textContent = c.name;
  b.append(catImage(c), name);
  b.addEventListener('click', onClick);
  return b;
}

function renderFavs() {
  const favs = favCats();
  const tiles = favs.map((c) => {
    const t = catTile(c, () => (stEditFavs ? toggleFav(c) : quickCategory(c)));
    if (stEditFavs) t.classList.add('removing');
    return t;
  });
  for (let i = favs.length; i < MAX_FAVS; i++) {
    const empty = document.createElement('button');
    empty.type = 'button';
    empty.className = 'cat-tile empty';
    empty.textContent = '+';
    empty.title = 'Busca una categoría abajo y toca ☆ para agregarla';
    empty.addEventListener('click', () => $('#st-cat-search').focus());
    tiles.push(empty);
  }
  $('#st-favs').replaceChildren(...tiles);

  const recent = recentCats();
  $('#st-recent').replaceChildren(...recent.map((c) => catTile(c, () => quickCategory(c))));
  $('#st-recent-box').hidden = !recent.length;
  $('#st-edit-favs').textContent = stEditFavs ? 'Listo' : 'Quitar favoritas';
  $('#st-edit-favs').hidden = !favs.length;
}

function toggleFav(c) {
  let favs = favCats();
  if (favs.some((f) => catKey(f) === catKey(c))) {
    favs = favs.filter((f) => catKey(f) !== catKey(c));
  } else {
    if (favs.length >= MAX_FAVS) { toast(`Máximo ${MAX_FAVS} favoritas. Quita una primero.`, true); return; }
    favs.push(c);
  }
  store.set('favCats', favs);
  renderFavs();
}

function addRecent(c) {
  const list = [c, ...recentCats().filter((r) => catKey(r) !== catKey(c))].slice(0, MAX_RECENT);
  store.set('recentCats', list);
}

$('#st-edit-favs').addEventListener('click', () => { stEditFavs = !stEditFavs; renderFavs(); });

/* ---------- Aplicar cambios ---------- */
// Formato de tags de Twitch: sin espacios ni símbolos, máximo 25 caracteres
const twitchTag = (t) => t.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 25);

function readTags() {
  return $('#st-tags').value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10);
}

async function applyTo(p, changes) {
  const { title, cat, tags } = changes;
  // Si la plataforma no tiene la categoría, igual aplica título y tags y luego avisa
  let missingCat = null;
  if (p === 'twitch') {
    const body = {};
    if (title) body.title = title.slice(0, 140);
    if (cat) {
      const t = await resolveCat(cat, 'twitch');
      if (t) body.game_id = t.id; else missingCat = cat.name;
    }
    if (tags) body.tags = [...new Set(tags.map(twitchTag).filter(Boolean))];
    if (Object.keys(body).length) await helix('PATCH', 'channels', { broadcaster_id: auth.userId }, body);
  } else if (p === 'kick') {
    const body = {};
    if (title) body.stream_title = title;
    if (cat) {
      const k = await resolveCat(cat, 'kick');
      if (k) body.category_id = Number(k.id); else missingCat = cat.name;
    }
    if (tags) body.custom_tags = tags;
    if (Object.keys(body).length) await kickApi('PATCH', 'channels', body);
  } else if (p === 'starvios') {
    if (!title && !cat) return 'omitido';
    const s = await svOwnStream();
    await svAuthed('POST', 'rpc/update_stream_info', {
      _stream_id: s.id,
      _title: title || s.title,
      _category: cat ? cat.name : s.category,
    });
  }
  if (missingCat) {
    const rest = title || tags ? ' (lo demás sí se cambió)' : '';
    throw new Error(`no tiene la categoría "${missingCat}"${rest}`);
  }
  return 'ok';
}

async function applyChanges(changes) {
  const plats = checkedPlatforms();
  if (!plats.length) { toast('Elige al menos una plataforma.', true); return false; }
  if (!changes.title && !changes.cat && !changes.tags) { toast('No hay cambios que aplicar.', true); return false; }

  const btn = $('#st-apply');
  btn.disabled = true;
  try {
    const results = await Promise.allSettled(plats.map((p) => applyTo(p, changes)));
    const ok = plats.filter((p, i) => results[i].status === 'fulfilled' && results[i].value === 'ok');
    const failed = plats.map((p, i) => [p, results[i]]).filter(([, r]) => r.status === 'rejected');
    if (changes.cat && ok.length) { addRecent(changes.cat); renderFavs(); }
    if (!failed.length) {
      toast('Directo actualizado en ' + ok.map((p) => PLATFORM_NAMES[p]).join(', ') + '.');
      return true;
    }
    const msg = failed.map(([p, r]) => `${PLATFORM_NAMES[p]}: ${r.reason.message}`).join(' · ');
    toast((ok.length ? 'Actualizado en ' + ok.map((p) => PLATFORM_NAMES[p]).join(', ') + '. ' : '') + 'Falló — ' + msg, true);
    return false;
  } finally {
    btn.disabled = false;
  }
}

// Tocar una favorita o reciente cambia solo la categoría, al momento
function quickCategory(c) {
  applyChanges({ cat: c });
}

$('#st-title').addEventListener('input', () => { stDirty.title = true; });
$('#st-tags').addEventListener('input', () => { stDirty.tags = true; });

$('#st-apply').addEventListener('click', () => {
  applyChanges({
    title: stDirty.title ? $('#st-title').value.trim() : null,
    cat: stCategory,
    tags: stDirty.tags ? readTags() : null,
  });
});

$('#st-close').addEventListener('click', () => stDialog.close());
$('#btn-stream').addEventListener('click', openStream);
