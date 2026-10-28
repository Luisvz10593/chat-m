'use strict';

/* =========================================================
   📺 Reproductor del directo, arriba del chat
   - Varios directos a la vez (hasta 4), acomodados solos en cuadrícula
   - Solo uno con sonido: al activar el audio de uno, los demás se silencian
     (también si le subes el volumen desde el propio reproductor de Twitch
     o Starvios; Kick no avisa, por eso su audio se cambia con el botón 🔊)
   - Tamaño: chico / mediano / grande o arrastrando la barrita de abajo
   Twitch: su reproductor con API (player.twitch.tv/js/embed/v1.js)
   Kick: player.kick.com (se recarga para cambiar el audio)
   Starvios: video HLS por el proxy de su web, con hls.js
   Usa funciones de app.js ($, store, sources, svGet, kickPublic…).
   ========================================================= */
const PL_MAX = 4;
const PL_SIZES = [['s', 0.24, 'Chico'], ['m', 0.38, 'Mediano'], ['l', 0.58, 'Grande']];
const PL = Object.assign({ open: false, keys: [], hv: 0.38 }, store.get('player', {}));
if (!Array.isArray(PL.keys)) PL.keys = [];
if (PL.key && !PL.keys.length) PL.keys = [PL.key]; // versión anterior: un solo canal
if (PL.size && !store.get('player', {}).hv) PL.hv = (PL_SIZES.find((x) => x[0] === PL.size) || PL_SIZES[1])[1];
PL.audio = null; // al abrir la app todo empieza sin sonido
const HLS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.15/hls.min.js';
const TW_EMBED = 'https://player.twitch.tv/js/embed/v1.js';
const plTiles = new Map(); // key → { el, media, setMuted, getMuted, destroy }
const kickSlugs = {};

const savePlayer = () => store.set('player', { open: PL.open, keys: PL.keys, hv: PL.hv });
const plHeight = () => Math.round(innerHeight * PL.hv);

// Canales que se pueden ver: los visibles del chat + los participantes del chat compartido
function playerSources() {
  const out = sources().filter((s) => !cfg.hidden.includes(s.key)).map((s) => ({ key: s.key, p: s.p, ch: s.ch }));
  for (const [ch, s] of Object.entries(twShared)) {
    for (const id of s.ids) {
      if (id === twitchRooms[ch]) continue;
      const login = twRoomName(id);
      if (login && !out.some((o) => o.p === 'twitch' && o.ch === login)) out.push({ key: srcKey('twitch', login), p: 'twitch', ch: login, shared: id });
    }
  }
  return out;
}

// Abre el reproductor; con key agrega ese canal (si cabe)
function openPlayer(key) {
  PL.open = true;
  if (key && !PL.keys.includes(key)) {
    if (PL.keys.length >= PL_MAX) toast(`Máximo ${PL_MAX} directos a la vez: quita uno primero.`, true);
    else PL.keys.push(key);
  }
  savePlayer();
  renderPlayer();
}

function closePlayer() {
  PL.open = false;
  savePlayer();
  renderPlayer();
}

function toggleStream(key) {
  if (PL.keys.includes(key)) PL.keys = PL.keys.filter((k) => k !== key);
  else if (PL.keys.length >= PL_MAX) { toast(`Máximo ${PL_MAX} directos a la vez: quita uno primero.`, true); return; }
  else PL.keys.push(key);
  if (PL.audio && !PL.keys.includes(PL.audio)) PL.audio = null;
  savePlayer();
  renderPlayer();
}

/* ---------- Dibujo ---------- */
function renderPlayer() {
  const box = $('#player');
  $('#btn-player').setAttribute('aria-pressed', String(PL.open));
  if (!PL.open) {
    for (const t of plTiles.values()) t.destroy();
    plTiles.clear();
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  box.hidden = false;
  const list = playerSources();
  PL.keys = PL.keys.filter((k) => list.some((s) => s.key === k));
  if (!PL.keys.length && list.length && !box.dataset.ready) PL.keys = [list[0].key]; // primera vez: el primer canal
  box.dataset.ready = '1';

  // Esqueleto (se crea una vez; los videos no se recargan al cambiar la barra)
  let bar = box.querySelector('.pl-bar');
  let grid = box.querySelector('.pl-grid');
  if (!grid) {
    bar = el('div', 'pl-bar');
    grid = el('div', 'pl-grid');
    box.replaceChildren(bar, grid, gripEl());
  }

  // Barra: canales (tocar = agregar/quitar), tamaño y cerrar
  const keepLeft = (bar.querySelector('.pl-pills') || {}).scrollLeft || 0;
  const pills = el('div', 'pill-tabs pl-pills');
  if (!list.length) pills.append(el('span', 'note', 'Agrega canales en ⚙ Ajustes para ver su directo aquí.'));
  for (const s of list) {
    const on = PL.keys.includes(s.key);
    const b = el('button');
    b.type = 'button';
    b.setAttribute('aria-selected', String(on));
    b.title = on ? 'Quitar del reproductor' : 'Agregar al reproductor';
    if (s.shared) b.style.setProperty('--sh', sharedColor(s.shared));
    b.append(el('span', 'plat-dot ' + s.p), el('span', null, (s.shared ? '🤝 ' : '') + s.ch));
    if (PL.audio === s.key) b.append(el('span', 'pl-pill-audio', '🔊'));
    b.addEventListener('click', () => toggleStream(s.key));
    pills.append(b);
  }
  const sizes = el('div', 'pl-sizes');
  sizes.setAttribute('role', 'group');
  sizes.setAttribute('aria-label', 'Tamaño del reproductor');
  for (const [id, hv, label] of PL_SIZES) {
    const b = el('button', 'pl-size');
    b.type = 'button';
    b.title = label;
    b.dataset.hv = hv;
    b.append(el('i', 'sz-ic sz-' + id));
    b.addEventListener('click', () => setPlayerHeight(hv, true));
    sizes.append(b);
  }
  const close = el('button', 'icon-btn small pl-close', '✕');
  close.type = 'button';
  close.title = 'Cerrar reproductor';
  close.addEventListener('click', closePlayer);
  bar.replaceChildren(pills, sizes, close);
  pills.scrollLeft = keepLeft;
  markSize();

  // Mosaicos: quita los que ya no van y agrega los nuevos al final (mover un iframe lo recarga)
  for (const [key, t] of plTiles) {
    if (!PL.keys.includes(key)) { t.destroy(); t.el.remove(); plTiles.delete(key); }
  }
  for (const key of PL.keys) {
    if (plTiles.has(key)) continue;
    const s = list.find((x) => x.key === key);
    const t = makeTile(s);
    plTiles.set(key, t);
    grid.append(t.el);
    t.load();
  }
  const empty = grid.querySelector('.pl-hint');
  if (!PL.keys.length && !empty) grid.append(el('div', 'pl-hint', 'Toca un canal de arriba para ver su directo. Puedes ver hasta 4 a la vez.'));
  if (PL.keys.length && empty) empty.remove();
  updateAudioUi();
  layoutGrid();
}

/* ---------- Tamaño ---------- */
function setPlayerHeight(hv, save) {
  PL.hv = Math.min(0.75, Math.max(0.15, hv));
  layoutGrid();
  markSize();
  if (save) savePlayer();
}

function markSize() {
  for (const b of document.querySelectorAll('#player .pl-size')) {
    b.setAttribute('aria-pressed', String(Math.abs(Number(b.dataset.hv) - PL.hv) < 0.04));
  }
}

// Barrita para arrastrar y cambiar la altura
function gripEl() {
  const g = el('div', 'pl-grip');
  g.title = 'Arrastra para cambiar el tamaño';
  g.append(el('i'));
  let startY = 0, startH = 0, raf = 0;
  g.addEventListener('pointerdown', (e) => {
    g.setPointerCapture(e.pointerId);
    startY = e.clientY;
    startH = plHeight();
    $('#player').classList.add('resizing');
  });
  g.addEventListener('pointermove', (e) => {
    if (!g.hasPointerCapture(e.pointerId)) return;
    const hv = (startH + e.clientY - startY) / innerHeight;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => setPlayerHeight(hv, false));
  });
  const end = (e) => {
    if (!g.hasPointerCapture(e.pointerId)) return;
    g.releasePointerCapture(e.pointerId);
    $('#player').classList.remove('resizing');
    savePlayer();
  };
  g.addEventListener('pointerup', end);
  g.addEventListener('pointercancel', end);
  // Doble toque: vuelve al tamaño mediano
  g.addEventListener('dblclick', () => setPlayerHeight(0.38, true));
  return g;
}

// Acomoda los directos: elige columnas para que cada video quede lo más grande posible
function layoutGrid() {
  const grid = $('#player .pl-grid');
  if (!grid) return;
  const n = grid.querySelectorAll('.pl-tile').length;
  const H = plHeight();
  grid.style.setProperty('--pl-h', H + 'px');
  if (!n) { grid.style.gridTemplateColumns = ''; return; }
  const W = grid.clientWidth;
  const gap = 6;
  let best = { cols: 1, w: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = Math.min((W - gap * (cols - 1)) / cols, ((H - gap * (rows - 1)) / rows) * 16 / 9);
    if (w > best.w + 1) best = { cols, w };
  }
  grid.style.gridTemplateColumns = `repeat(${best.cols}, ${Math.max(80, Math.floor(best.w))}px)`;
}
new ResizeObserver(() => layoutGrid()).observe($('#player'));
addEventListener('resize', layoutGrid);

/* ---------- Audio: solo uno a la vez ---------- */
function setAudio(key) {
  PL.audio = key;
  for (const [k, t] of plTiles) t.setMuted(k !== key);
  updateAudioUi();
}

function updateAudioUi() {
  for (const [k, t] of plTiles) {
    const on = PL.audio === k;
    t.el.classList.toggle('has-audio', on);
    const b = t.el.querySelector('.pl-audio');
    b.textContent = on ? '🔊' : '🔇';
    b.title = on ? 'Silenciar' : 'Escuchar este (silencia los demás)';
    b.setAttribute('aria-pressed', String(on));
  }
  for (const b of document.querySelectorAll('#player .pl-pills button')) {
    const old = b.querySelector('.pl-pill-audio');
    if (old) old.remove();
  }
  const list = playerSources();
  const i = list.findIndex((s) => s.key === PL.audio);
  const pill = i >= 0 && document.querySelectorAll('#player .pl-pills button')[i];
  if (pill) pill.append(el('span', 'pl-pill-audio', '🔊'));
}

// El reproductor de Twitch o Starvios cambió el sonido por su cuenta
function onNativeAudio(key, muted) {
  if (!muted && PL.audio !== key) setAudio(key);
  else if (muted && PL.audio === key) { PL.audio = null; updateAudioUi(); }
}

// Twitch no avisa cuando le quitas el silencio desde su reproductor: se revisa cada segundo
setInterval(() => {
  if (!PL.open) return;
  for (const [k, t] of plTiles) if (t.poll) onNativeAudio(k, t.getMuted());
}, 1000);

/* ---------- Mosaico de un directo ---------- */
const publicUrl = (s) => ({
  twitch: `https://www.twitch.tv/${encodeURIComponent(s.ch)}`,
  kick: `https://kick.com/${encodeURIComponent(kickSlugs[s.ch] || s.ch)}`,
  starvios: `https://starvios.com/live/${encodeURIComponent(s.ch)}`,
}[s.p]);

function makeTile(s) {
  const tile = el('div', `pl-tile ${s.p}`);
  tile.dataset.key = s.key;
  if (s.shared) tile.style.setProperty('--sh', sharedColor(s.shared));
  const media = el('div', 'pl-media');
  const head = el('div', 'pl-tile-head');
  head.append(el('span', 'plat-dot ' + s.p), el('span', 'pl-tile-name', (s.shared ? '🤝 ' : '') + s.ch));
  const ext = el('a', 'pl-tbtn', '↗');
  ext.href = publicUrl(s);
  ext.target = '_blank';
  ext.rel = 'noopener';
  ext.title = 'Abrir en su página';
  const rm = el('button', 'pl-tbtn', '✕');
  rm.type = 'button';
  rm.title = 'Quitar';
  rm.addEventListener('click', () => toggleStream(s.key));
  head.append(ext, rm);
  const audio = el('button', 'pl-audio', '🔇');
  audio.type = 'button';
  audio.addEventListener('click', () => setAudio(PL.audio === s.key ? null : s.key));
  tile.append(media, head, audio);

  const t = {
    el: tile, media, poll: false, muted: true, seq: 0, hls: null,
    setMuted() {}, getMuted: () => true,
    destroy() { t.seq++; if (t.hls) { t.hls.destroy(); t.hls = null; } media.replaceChildren(); },
    msg(text) { media.replaceChildren(el('div', 'pl-msg', text)); },
    async load() {
      const seq = ++t.seq;
      t.msg('Cargando…');
      try {
        if (s.p === 'twitch') await loadTwitch(t, s, seq);
        else if (s.p === 'kick') await loadKick(t, s, seq, ext);
        else await loadStarvios(t, s, seq);
        if (seq === t.seq) t.setMuted(PL.audio !== s.key);
      } catch (e) {
        if (seq === t.seq) t.msg('⚠ ' + e.message);
      }
    },
  };
  return t;
}

function iframe(src) {
  const f = el('iframe');
  f.src = src;
  f.allow = 'autoplay; fullscreen; picture-in-picture';
  f.allowFullscreen = true;
  f.referrerPolicy = 'origin';
  return f;
}

async function loadTwitch(t, s, seq) {
  // Con la API de Twitch se puede silenciar y saber si le subieron el volumen
  try {
    await loadScript(TW_EMBED);
    if (seq !== t.seq) return;
    const holder = el('div', 'pl-embed');
    holder.id = 'tw-' + Math.random().toString(36).slice(2);
    t.media.replaceChildren(holder);
    const p = new Twitch.Player(holder.id, { channel: s.ch, parent: [location.hostname], muted: true, autoplay: true, width: '100%', height: '100%' });

    t.setMuted = (m) => { try { p.setMuted(m); if (!m && p.getVolume() < 0.05) p.setVolume(0.5); } catch { /* aún cargando */ } };
    t.getMuted = () => { try { return p.getMuted(); } catch { return true; } };
    p.addEventListener(Twitch.Player.READY, () => { t.setMuted(PL.audio !== s.key); t.poll = true; });
  } catch {
    // Sin la API: el reproductor normal, recargándolo para cambiar el audio
    const url = (m) => 'https://player.twitch.tv/?' + new URLSearchParams({ channel: s.ch, parent: location.hostname, muted: String(m), autoplay: 'true' });
    reloadingIframe(t, url);
  }
}

async function loadKick(t, s, seq, ext) {
  if (!kickSlugs[s.ch]) {
    try { kickSlugs[s.ch] = (await kickPublic(s.ch)).slug || s.ch; } catch { kickSlugs[s.ch] = s.ch; }
    if (seq !== t.seq) return;
    ext.href = publicUrl(s);
  }
  reloadingIframe(t, (m) => `https://player.kick.com/${encodeURIComponent(kickSlugs[s.ch])}?muted=${m}&autoplay=true`);
}

// Reproductores sin API: para cambiar el audio se recarga con muted=true/false
function reloadingIframe(t, url) {
  const f = iframe(url(true));
  t.muted = true;
  t.media.replaceChildren(f);
  t.setMuted = (m) => { if (t.muted !== m) { t.muted = m; f.src = url(m); } };
  t.getMuted = () => t.muted;
}

async function loadStarvios(t, s, seq) {
  let channelId = svStreams[s.ch] && svStreams[s.ch].channelId;
  if (!channelId) {
    const [p] = await svGet('profiles?select=id&username=eq.' + encodeURIComponent(s.ch));
    if (!p) throw new Error('El canal no existe en Starvios');
    channelId = p.id;
  }
  const [row] = await svGet(`live_streams?select=playback_id,status,thumbnail_url&channel_id=eq.${channelId}&order=started_at.desc&limit=1`);
  if (seq !== t.seq) return;
  if (!row || row.status !== 'live' || !row.playback_id) { t.msg('⚫ Fuera de directo'); return; }
  const video = el('video');
  video.controls = true;
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  if (row.thumbnail_url) video.poster = row.thumbnail_url;
  t.media.replaceChildren(video);
  t.setMuted = (m) => { video.muted = m; if (!m) video.play().catch(() => {}); };
  t.getMuted = () => video.muted;
  video.addEventListener('volumechange', () => onNativeAudio(s.key, video.muted));
  // Igual que su web: los de Livepeer pasan por el proxy de Starvios (el enlace directo no deja verlos desde otra página)
  const lp = /^https:\/\/(?:livepeer\.studio|livepeercdn\.studio|playback\.livepeer\.studio)\/hls\/([A-Za-z0-9]{8,40})\/index\.m3u8/.exec(row.playback_id);
  const src = lp ? `https://starvios.com/api/public/lp-hls/${lp[1]}` : row.playback_id;
  try { await loadScript(HLS_URL); } catch { /* sin hls.js: se intenta el reproductor del navegador */ }
  if (seq !== t.seq) return;
  if (!window.Hls || !Hls.isSupported()) {
    // iPhone / Safari reproducen HLS solos (Chrome dice "maybe" pero muchas veces falla, por eso va al final)
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.onerror = () => { if (seq === t.seq) t.msg('⚠ No se pudo cargar el video. Usa ↗ para abrirlo en su página.'); };
      video.src = src;
    } else t.msg('Este navegador no puede reproducir el directo de Starvios. Usa ↗ para abrirlo en su página.');
    return;
  }
  t.hls = new Hls({ lowLatencyMode: true });
  t.hls.on(Hls.Events.ERROR, (_, d) => {
    if (d.fatal && seq === t.seq) t.msg('⚠ No se pudo cargar el video (puede que el directo acabe de empezar o terminar).');
  });
  t.hls.loadSource(src);
  t.hls.attachMedia(video);
}

const loadedScripts = {};
function loadScript(src) {
  if (!loadedScripts[src]) {
    loadedScripts[src] = new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = src;
      sc.onload = res;
      sc.onerror = () => { delete loadedScripts[src]; rej(new Error('No se pudo cargar el reproductor')); };
      document.head.append(sc);
    });
  }
  return loadedScripts[src];
}

$('#btn-player').addEventListener('click', () => (PL.open ? closePlayer() : openPlayer()));

// Tocar un canal del chat compartido agrega su directo
$('#shared-bar').addEventListener('click', (e) => {
  const chip = e.target.closest('.shared-chip');
  if (!chip) return;
  const login = chip.textContent.replace(/^👑\s*/, '').trim();
  if (login && login !== 'otro canal') openPlayer(srcKey('twitch', login));
});

// Si cambian los canales visibles o el chat compartido, actualiza la barra (los videos siguen)
let plLastList = '';
setInterval(() => {
  if (!PL.open) return;
  const sig = playerSources().map((s) => s.key).join('|');
  if (sig !== plLastList) {
    const had = plLastList;
    plLastList = sig;
    if (had) renderPlayer();
  }
}, 3000);

if (PL.open) setTimeout(renderPlayer, 500); // espera a que carguen los canales
