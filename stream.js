'use strict';

/* =========================================================
   Panel "Directo": título, categoría y tags del stream
   en uno o varios canales a la vez. Usa las sesiones y
   funciones de app.js (auth, kickAuth, svAuth, helix…).

   Flujo: Estado actual (tarjetas) → elegir cambios →
   Revisar (antes → después) → Aplicar → Resultado por canal.

   Categoría unificada: { name, img, twitch?: {id}, kick?: {id} }
   ========================================================= */
const stDialog = $('#stream');
const MAX_FAVS = 12;
const MAX_RECENT = 3;
const MAX_TAGS = 10;

let stTargets = [];      // canales editables (ver streamTargets)
let stSelected = new Set();
let stCurrent = {};      // id → { status: 'loading'|'ok'|'error', title, category, categoryImg, tags, error }
let stBase = { title: '', tags: [] }; // valores iniciales del formulario
let stDraft = { title: '', tags: [] };
let stCategory = null;   // categoría elegida en el buscador
let stView = 'main';     // 'main' | 'review' | 'applying' | 'done'
let stPending = null;    // cambios que se están revisando
let stEditFavs = false;
let stSearchTimer = null;
let stSearchSeq = 0;
let stLoadSeq = 0;

const catKey = (c) => c.name.trim().toLowerCase();
const favCats = () => store.get('favCats', []);
const recentCats = () => store.get('recentCats', []);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// Permisos nuevos que hacen falta para editar el directo
const needsRelogin = {
  twitch: () => auth && !(auth.scopes || []).includes('channel:manage:broadcast'),
  kick: () => kickAuth && (kickAuth.scope === undefined || (!!kickAuth.scope && !kickAuth.scope.includes('channel:write'))),
  starvios: () => false,
};

/*
 * Canales editables. Twitch y Kick solo permiten editar el canal propio por API
 * (el rol de editor no sirve). Starvios recibe el directo exacto, así que también
 * se ofrecen los canales ajenos de la lista: si tu rol lo permite, Starvios lo
 * acepta; si no, se avisa.  Destino: { id, p, label, name? }
 */
function streamTargets() {
  const list = [];
  if (auth) list.push({ id: 'twitch', p: 'twitch', label: auth.login });
  if (kickAuth) list.push({ id: 'kick', p: 'kick', label: kickAuth.name || 'tu canal' });
  if (svAuth) {
    list.push({ id: 'starvios', p: 'starvios', label: 'tu canal' });
    for (const name of channelsOf('starvios')) {
      const s = svStreams[name];
      if (s && s.channelId === svAuth.userId) continue; // es tu propio canal
      list.push({ id: 'starvios:' + name, p: 'starvios', label: name, name });
    }
  }
  return list;
}
const targetName = (t) => `${PLATFORM_NAMES[t.p]} · ${t.label}`;
const selectedTargets = () => stTargets.filter((t) => stSelected.has(t.id));

/* =========================================================
   Abrir / vistas
   ========================================================= */
function openStream() {
  stTargets = streamTargets();
  stSelected = new Set(stTargets.filter((t) => !t.name).map((t) => t.id)); // los ajenos empiezan sin marcar
  stCurrent = {};
  stCategory = null;
  stBase = { title: '', tags: [] };
  stDraft = { title: '', tags: [] };
  stEditFavs = false;
  $('#st-cat-search').value = '';
  $('#st-cat-results').replaceChildren();

  const notes = [];
  if (!stTargets.length) notes.push('Inicia sesión en ⚙ Ajustes para editar tu directo.');
  for (const p of new Set(stTargets.map((t) => t.p))) {
    if (needsRelogin[p]()) notes.push(`${PLATFORM_NAMES[p]}: cierra sesión y vuelve a iniciarla en ⚙ para dar el permiso de editar el directo.`);
  }
  if (auth || kickAuth) notes.push('En Twitch y Kick solo se puede editar tu propio canal (su API no acepta el rol de editor).');
  $('#st-note').textContent = notes.join(' ');
  $('#st-note').hidden = !notes.length;

  setTab('quick');
  setView('main');
  renderCards();
  renderForm();
  renderFavs();
  stDialog.showModal();
  loadAllCurrent(true);
}

function setView(v) {
  stView = v;
  $('#st-main').hidden = v !== 'main';
  $('#st-review').hidden = v === 'main';
  $('#st-back').hidden = v !== 'review';
  if (v === 'main' || v === 'review') $('#stream .st-body').scrollTop = 0;
  updateFooter();
}

function setTab(tab) {
  for (const b of document.querySelectorAll('#stream .seg button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  $('#tab-quick').hidden = tab !== 'quick';
  $('#tab-edit').hidden = tab !== 'edit';
  updateFooter();
}
const currentTab = () => ($('#tab-edit').hidden ? 'quick' : 'edit');

function updateFooter() {
  const btn = $('#st-primary');
  btn.hidden = false;
  btn.disabled = false;
  if (stView === 'main') {
    const n = countChanges();
    btn.hidden = currentTab() === 'quick';
    btn.textContent = n ? `Revisar cambios (${n})` : 'Sin cambios';
    btn.disabled = !n || !stSelected.size;
  } else if (stView === 'review') {
    btn.textContent = '✓ Confirmar y aplicar';
  } else if (stView === 'applying') {
    btn.textContent = 'Aplicando…';
    btn.disabled = true;
  } else {
    btn.textContent = 'Listo';
  }
  // Sin botones que mostrar (pestaña rápida), el pie se oculta
  $('#stream .st-foot').hidden = btn.hidden && $('#st-back').hidden;
}

for (const b of document.querySelectorAll('#stream .seg button')) b.addEventListener('click', () => setTab(b.dataset.tab));

$('#st-close').addEventListener('click', () => { if (stView !== 'applying') stDialog.close(); });
$('#st-back').addEventListener('click', () => setView('main'));
$('#st-refresh').addEventListener('click', () => loadAllCurrent(false));

$('#st-primary').addEventListener('click', () => {
  if (stView === 'main') startReview(draftChanges());
  else if (stView === 'review') applyPending();
  else if (stView === 'done') { setView('main'); loadAllCurrent(false); }
});

/* =========================================================
   Estado actual (tarjetas)
   ========================================================= */
async function loadAllCurrent(prefill) {
  const seq = ++stLoadSeq;
  for (const t of stTargets) stCurrent[t.id] = { status: 'loading' };
  renderCards();
  await Promise.all(stTargets.map(async (t) => {
    try {
      const cur = await getCurrent(t);
      if (seq !== stLoadSeq) return;
      stCurrent[t.id] = { status: 'ok', ...cur };
    } catch (e) {
      if (seq !== stLoadSeq) return;
      stCurrent[t.id] = { status: 'error', error: e.message };
    }
    renderCards();
  }));
  if (seq !== stLoadSeq || !prefill) return;
  // Rellena el formulario con el primer canal propio que respondió
  const first = stTargets.find((t) => !t.name && stCurrent[t.id].status === 'ok');
  if (first) {
    const c = stCurrent[first.id];
    stBase = { title: c.title || '', tags: [...(c.tags || [])] };
    stDraft = { title: stBase.title, tags: [...stBase.tags] };
    renderForm();
  }
}

async function getCurrent(t) {
  if (t.p === 'twitch') {
    const j = await helix('GET', 'channels', { broadcaster_id: auth.userId });
    const c = j.data && j.data[0];
    if (!c) throw new Error('no se encontró el canal');
    let img = '';
    if (c.game_id) {
      try {
        const g = await helix('GET', 'games', { id: c.game_id });
        img = ((g.data && g.data[0] && g.data[0].box_art_url) || '').replace('{width}x{height}', '72x96');
      } catch { /* sin imagen */ }
    }
    return { title: c.title, category: c.game_name, categoryImg: img, tags: c.tags || [] };
  }
  if (t.p === 'kick') return kickCurrent();
  const s = await svStreamFor(t);
  return { title: s.title, category: s.category, categoryImg: '', tags: s.tags || [] };
}

/*
 * Estado de tu canal de Kick. La API oficial a veces devuelve el título y la
 * categoría vacíos (sobre todo fuera de directo), así que se completa con la
 * API pública de kick.com: el directo actual o, si no hay, la última categoría.
 */
async function kickCurrent() {
  let official = null;
  let officialErr = null;
  try {
    const j = await kickApi('GET', 'channels?broadcaster_user_id=' + encodeURIComponent(await kickUserId()));
    official = j.data && j.data[0];
    if (!official) officialErr = 'la API oficial no devolvió tu canal';
  } catch (e) { officialErr = e.message; }

  let pub = null;
  const slug = ((official && official.slug) || kickAuth.name || '').toLowerCase().replace(/_/g, '-');
  if (slug) {
    try { pub = await fetchJson('https://kick.com/api/v2/channels/' + encodeURIComponent(slug)); } catch { /* sin respaldo */ }
  }
  if (!official && !pub) throw new Error('Kick: ' + officialErr);

  const live = pub ? !!pub.livestream : !!(official && official.stream && official.stream.is_live);
  const ls = pub && pub.livestream;
  const pubCat = (ls && ls.categories && ls.categories[0]) || (pub && pub.recent_categories && pub.recent_categories[0]);
  const offCat = official && official.category && official.category.name ? official.category : null;
  const offTags = official && official.stream && official.stream.custom_tags;
  return {
    title: (official && official.stream_title) || (ls && ls.session_title) || '',
    category: (offCat && offCat.name) || (pubCat && pubCat.name) || '',
    categoryImg: (offCat && offCat.thumbnail) || '',
    tags: (offTags && offTags.length ? offTags : ls && ls.tags) || [],
    live,
    note: officialErr && pub ? 'Datos públicos (la API con tu sesión falló: ' + officialErr + ')' : '',
  };
}

// ID de tu usuario de Kick (las sesiones antiguas podrían no tenerlo guardado)
async function kickUserId() {
  if (kickAuth.userId) return kickAuth.userId;
  const me = await kickApi('GET', 'users');
  const u = me.data && me.data[0];
  if (!u) throw new Error('Kick no devolvió tu usuario');
  kickAuth.userId = u.user_id;
  kickAuth.name = kickAuth.name || u.name;
  store.set('kickAuth', kickAuth);
  return kickAuth.userId;
}

// Directo de Starvios a editar: el tuyo, o el de un canal ajeno de la lista
async function svStreamFor(t) {
  let channelId = svAuth.userId;
  if (t.name) {
    const [profile] = await svGet('profiles?select=id&username=eq.' + encodeURIComponent(t.name));
    if (!profile) throw new Error(`el canal ${t.name} no existe`);
    channelId = profile.id;
  }
  const [s] = await svGet(`live_streams?select=id,title,category,tags,language&order=started_at.desc&limit=1&channel_id=eq.${channelId}`);
  if (!s) throw new Error(t.name ? `${t.name} no tiene canal de directos` : 'tu cuenta de Starvios no tiene canal de directos');
  return s;
}

function renderCards() {
  const box = $('#st-cards');
  if (!stTargets.length) { box.replaceChildren(el('p', 'note', 'No hay canales con sesión iniciada.')); return; }
  box.replaceChildren(...stTargets.map((t) => {
    const cur = stCurrent[t.id] || { status: 'loading' };
    const card = el('button', `st-card ${t.p}`);
    card.type = 'button';
    card.setAttribute('aria-pressed', String(stSelected.has(t.id)));

    const head = el('div', 'st-card-head');
    head.append(el('span', `badge-platform ${t.p}`, PLATFORM_NAMES[t.p]), el('span', 'st-card-name', t.label));
    if (t.name) head.append(el('span', 'st-card-tag', 'ajeno'));
    head.append(el('span', 'st-check', stSelected.has(t.id) ? '✓' : ''));
    card.append(head);

    if (cur.status === 'loading') {
      card.append(el('div', 'st-skel'), el('div', 'st-skel short'));
    } else if (cur.status === 'error') {
      card.append(el('p', 'st-card-error', '⚠ ' + cur.error));
    } else {
      if (cur.live !== undefined) {
        card.append(el('span', 'st-live ' + (cur.live ? 'on' : 'off'), cur.live ? '● En vivo' : 'Fuera de directo'));
      }
      card.append(el('p', 'st-card-title', cur.title || 'Sin título'));
      const cat = el('div', 'st-card-cat');
      cat.append(catImage({ name: cur.category || '?', img: cur.categoryImg }), el('span', null, cur.category || 'Sin categoría'));
      card.append(cat);
      if (cur.tags && cur.tags.length) {
        const tags = el('div', 'st-card-tags');
        tags.append(...cur.tags.map((x) => el('span', 'tag', x)));
        card.append(tags);
      } else {
        card.append(el('p', 'st-card-muted', 'Sin tags'));
      }
      if (cur.note) card.append(el('p', 'st-card-warn', cur.note));
    }
    if (needsRelogin[t.p]()) card.append(el('p', 'st-card-warn', 'Vuelve a iniciar sesión para poder editar'));

    card.addEventListener('click', () => {
      if (stSelected.has(t.id)) stSelected.delete(t.id); else stSelected.add(t.id);
      renderCards();
      updateFooter();
    });
    return card;
  }));
}

/* =========================================================
   Formulario: título, categoría y tags
   ========================================================= */
const sameTags = (a, b) => a.join('\n').toLowerCase() === b.join('\n').toLowerCase();

function draftChanges() {
  const title = stDraft.title.trim();
  return {
    title: title && title !== stBase.title.trim() ? title : null,
    cat: stCategory,
    tags: sameTags(stDraft.tags, stBase.tags) ? null : [...stDraft.tags],
  };
}
function countChanges() {
  const c = draftChanges();
  return (c.title ? 1 : 0) + (c.cat ? 1 : 0) + (c.tags ? 1 : 0);
}

function renderForm() {
  const title = $('#st-title');
  if (title.value !== stDraft.title) title.value = stDraft.title;
  const c = draftChanges();
  $('#st-title-count').textContent = `${stDraft.title.length}/140`;
  $('#st-title-mod').hidden = !c.title;
  $('#st-cat-mod').hidden = !c.cat;
  $('#st-tags-mod').hidden = !c.tags;
  renderTags();
  renderSelectedCat();
  updateFooter();
}

$('#st-title').addEventListener('input', (e) => { stDraft.title = e.target.value; renderForm(); });
$('#st-reset').addEventListener('click', () => {
  stDraft = { title: stBase.title, tags: [...stBase.tags] };
  stCategory = null;
  renderForm();
});

/* ---------- Tags como etiquetas ---------- */
function renderTags() {
  const box = $('#st-tags');
  const input = $('#st-tag-input');
  const chips = stDraft.tags.map((t, i) => {
    const chip = el('span', 'tag removable', t);
    const x = el('button', null, '✕');
    x.type = 'button';
    x.setAttribute('aria-label', 'Quitar tag ' + t);
    x.addEventListener('click', () => { stDraft.tags.splice(i, 1); renderForm(); });
    chip.append(x);
    return chip;
  });
  box.replaceChildren(...chips, input);
  $('#st-tags-count').textContent = `${stDraft.tags.length}/${MAX_TAGS}`;
  input.disabled = stDraft.tags.length >= MAX_TAGS;
  input.placeholder = input.disabled ? 'Máximo 10 tags' : 'Escribe un tag y pulsa Enter';
}

function addTag(raw) {
  const t = raw.trim().replace(/^#/, '');
  if (!t) return;
  if (stDraft.tags.length >= MAX_TAGS) { toast(`Máximo ${MAX_TAGS} tags.`, true); return; }
  if (stDraft.tags.some((x) => x.toLowerCase() === t.toLowerCase())) return;
  stDraft.tags.push(t.slice(0, 25));
  renderForm();
}

$('#st-tag-input').addEventListener('keydown', (e) => {
  const input = e.target;
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addTag(input.value);
    input.value = '';
    input.focus();
  } else if (e.key === 'Backspace' && !input.value && stDraft.tags.length) {
    stDraft.tags.pop();
    renderForm();
    $('#st-tag-input').focus();
  }
});
// En teclados de tablet la coma puede no generar keydown: se revisa al escribir
$('#st-tag-input').addEventListener('input', (e) => {
  if (!e.target.value.includes(',')) return;
  const parts = e.target.value.split(',');
  e.target.value = parts.pop();
  parts.forEach(addTag);
  $('#st-tag-input').focus();
});
$('#st-tags').addEventListener('click', () => $('#st-tag-input').focus());

/* =========================================================
   Buscar categorías
   ========================================================= */
$('#st-cat-search').addEventListener('input', (e) => {
  clearTimeout(stSearchTimer);
  const q = e.target.value.trim();
  if (q.length < 2) { $('#st-cat-results').replaceChildren(); return; }
  stSearchTimer = setTimeout(() => runSearch(q), 400);
});

async function runSearch(q) {
  const seq = ++stSearchSeq;
  const list = $('#st-cat-results');
  list.replaceChildren(el('p', 'note', 'Buscando…'));
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
    const img = el('img');
    img.src = c.img;
    img.alt = '';
    img.loading = 'lazy';
    return img;
  }
  return el('span', 'cat-ph', (c.name || '?').slice(0, 1).toUpperCase());
}

function catRow(c) {
  const row = el('div', 'cat-row');
  const pick = el('button', 'cat-pick');
  pick.type = 'button';
  const name = el('span', null, c.name);
  name.append(el('br'), el('small', null, [c.twitch && 'Twitch', c.kick && 'Kick'].filter(Boolean).join(' · ') || 'texto libre'));
  pick.append(catImage(c), name);
  pick.addEventListener('click', () => {
    stCategory = c;
    $('#st-cat-results').replaceChildren();
    $('#st-cat-search').value = '';
    renderForm();
  });

  const star = el('button', 'cat-star');
  star.type = 'button';
  const isFav = () => favCats().some((f) => catKey(f) === catKey(c));
  star.textContent = isFav() ? '★' : '☆';
  star.title = 'Agregar o quitar de favoritas';
  star.addEventListener('click', () => { toggleFav(c); star.textContent = isFav() ? '★' : '☆'; });
  row.append(pick, star);
  return row;
}

function renderSelectedCat() {
  const box = $('#st-cat-selected');
  if (!stCategory) { box.replaceChildren(); return; }
  const chip = el('div', 'cat-chosen');
  const x = el('button', 'icon-btn small', '✕');
  x.type = 'button';
  x.setAttribute('aria-label', 'Quitar categoría elegida');
  x.addEventListener('click', () => { stCategory = null; renderForm(); });
  const txt = el('span', null, stCategory.name);
  txt.prepend(el('small', null, 'Nueva categoría'), el('br'));
  chip.append(catImage(stCategory), txt, x);
  box.replaceChildren(chip);
}

function catTile(c, onClick) {
  const b = el('button', 'cat-tile');
  b.type = 'button';
  b.append(catImage(c), el('span', null, c.name));
  b.addEventListener('click', onClick);
  return b;
}

/* ---------- Favoritas y recientes ---------- */
function renderFavs() {
  const favs = favCats();
  const tiles = favs.map((c) => {
    const t = catTile(c, () => (stEditFavs ? toggleFav(c) : startReview({ cat: c })));
    if (stEditFavs) t.classList.add('removing');
    return t;
  });
  for (let i = favs.length; i < MAX_FAVS; i++) {
    const empty = el('button', 'cat-tile empty', '+');
    empty.type = 'button';
    empty.title = 'Agrega favoritas desde "Editar todo": busca una categoría y toca ☆';
    empty.addEventListener('click', () => { setTab('edit'); $('#st-cat-search').focus(); });
    tiles.push(empty);
  }
  $('#st-favs').replaceChildren(...tiles);

  const recent = recentCats();
  $('#st-recent').replaceChildren(...recent.map((c) => catTile(c, () => startReview({ cat: c }))));
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
  store.set('recentCats', [c, ...recentCats().filter((r) => catKey(r) !== catKey(c))].slice(0, MAX_RECENT));
}

$('#st-edit-favs').addEventListener('click', () => { stEditFavs = !stEditFavs; renderFavs(); });

/* =========================================================
   Revisión: antes → después, canal por canal
   ========================================================= */
function startReview(changes) {
  const targets = selectedTargets();
  if (!targets.length) { toast('Marca al menos un canal en "Estado actual".', true); return; }
  if (!changes.title && !changes.cat && !changes.tags) { toast('No hay cambios que aplicar.', true); return; }
  stPending = { changes, targets };
  $('#st-review-title').textContent = 'Revisa los cambios';
  $('#st-review-note').textContent = 'Esto es lo que se va a cambiar en cada canal:';
  $('#st-review-list').replaceChildren(...targets.map((t) => reviewCard(t, changes)));
  setView('review');
}

function diffRow(label, before, after) {
  const row = el('div', 'diff');
  row.append(el('span', 'diff-label', label));
  const vals = el('div', 'diff-vals');
  if (before && String(before).trim().toLowerCase() === String(after).trim().toLowerCase()) {
    vals.append(el('span', 'diff-same', `${after} (ya está así)`));
    row.append(vals);
    return row;
  }
  vals.append(el('span', 'diff-old', before || '—'), el('span', 'diff-arrow', '→'), el('span', 'diff-new', after));
  row.append(vals);
  return row;
}

function reviewCard(t, changes) {
  const cur = stCurrent[t.id] || {};
  const card = el('div', `st-rcard ${t.p}`);
  card.dataset.id = t.id;
  const head = el('div', 'st-card-head');
  head.append(el('span', `badge-platform ${t.p}`, PLATFORM_NAMES[t.p]), el('span', 'st-card-name', t.label), el('span', 'st-result'));
  card.append(head);

  let any = false;
  if (changes.title) { card.append(diffRow('Título', cur.title, changes.title)); any = true; }
  if (changes.cat) { card.append(diffRow('Categoría', cur.category, changes.cat.name)); any = true; }
  if (changes.tags) {
    if (t.p === 'starvios' && t.name) {
      card.append(el('p', 'st-card-muted', 'Tags: Starvios solo permite cambiarlos en tu propio canal, se omiten.'));
    } else {
      // Twitch y Starvios guardan los tags sin espacios ni símbolos
      const shown = t.p === 'kick' ? changes.tags : cleanTags(changes.tags);
      card.append(diffRow('Tags', (cur.tags || []).join(', '), shown.join(', ') || '(sin tags)'));
      any = true;
    }
  }
  if (!any) card.append(el('p', 'st-card-muted', 'Nada que cambiar aquí.'));
  return card;
}

/* =========================================================
   Aplicar y mostrar el resultado por canal
   ========================================================= */
// Formato de tags de Twitch y Starvios: sin espacios ni símbolos, máximo 25 caracteres
const twitchTag = (t) => t.normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 25);
const cleanTags = (tags) => [...new Set(tags.map(twitchTag).filter(Boolean))];

async function applyTo(target, changes) {
  const p = target.p;
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
    if (tags) body.tags = cleanTags(tags);
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
    // Los tags solo se pueden cambiar en tu propio canal (set_live_tags no recibe otro canal)
    const doTags = tags && !target.name;
    if (!title && !cat && !doTags) return 'omitido';
    const s = await svStreamFor(target);
    const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    if (title || cat) {
      const wanted = { title: title || s.title, category: cat ? cat.name : s.category };
      await svAuthed('POST', 'rpc/update_stream_info', { _stream_id: s.id, _title: wanted.title, _category: wanted.category });
      // Comprueba que de verdad cambió (si tu rol no lo permite, Starvios podría ignorarlo sin error)
      const after = await svStreamFor(target);
      if (!same(after.title, wanted.title) || !same(after.category, wanted.category)) {
        throw new Error('Starvios no aplicó el cambio; tu rol en ese canal no lo permite');
      }
    }
    if (doTags) {
      // Mismo formato que la web de Starvios; se conserva el idioma que ya tenía el directo
      await svAuthed('POST', 'rpc/set_live_tags', { _tags: cleanTags(tags), _language: s.language || 'es' });
    }
  }
  if (missingCat) {
    throw new Error(`no tiene la categoría "${missingCat}"${title || tags ? ' (lo demás sí se cambió)' : ''}`);
  }
  return 'ok';
}

function setResult(id, kind, text) {
  const card = document.querySelector(`#st-review-list .st-rcard[data-id="${CSS.escape(id)}"]`);
  if (!card) return;
  card.dataset.result = kind;
  card.querySelector('.st-result').textContent = { busy: '⏳', ok: '✓', skip: '–', fail: '✕' }[kind];
  let msg = card.querySelector('.st-result-msg');
  if (!msg) { msg = el('p', 'st-result-msg'); card.append(msg); }
  msg.textContent = text;
}

async function applyPending() {
  const { changes, targets } = stPending;
  setView('applying');
  $('#st-review-title').textContent = 'Aplicando cambios…';
  $('#st-review-note').textContent = 'No cierres esta ventana.';
  for (const t of targets) setResult(t.id, 'busy', 'Aplicando…');

  const results = await Promise.allSettled(targets.map((t) => applyTo(t, changes)));
  let ok = 0;
  let fail = 0;
  targets.forEach((t, i) => {
    const r = results[i];
    if (r.status === 'rejected') { fail++; setResult(t.id, 'fail', r.reason.message); }
    else if (r.value === 'omitido') setResult(t.id, 'skip', 'Sin cambios aplicables');
    else { ok++; setResult(t.id, 'ok', 'Actualizado'); }
  });

  if (changes.cat && ok) { addRecent(changes.cat); renderFavs(); }
  if (ok) {
    // Lo aplicado pasa a ser el nuevo punto de partida del formulario
    if (changes.title) stBase.title = changes.title;
    if (changes.tags) stBase.tags = [...changes.tags];
    stDraft = { title: stBase.title, tags: [...stBase.tags] };
    stCategory = null;
    renderForm();
  }
  $('#st-review-title').textContent = fail
    ? (ok ? `Cambios aplicados en ${ok} de ${ok + fail}` : 'No se pudo aplicar')
    : '✓ Cambios aplicados';
  $('#st-review-note').textContent = fail ? 'Revisa el motivo en cada canal marcado con ✕.' : 'Todo quedó actualizado.';
  toast(fail ? `Aplicado en ${ok}, falló en ${fail}.` : 'Directo actualizado.', !!fail);
  setView('done');
}

$('#btn-stream').addEventListener('click', openStream);
