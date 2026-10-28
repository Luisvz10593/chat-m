'use strict';

/* =========================================================
   📺 Reproductor del directo, arriba del chat
   - Botones con los canales visibles (y los del chat compartido)
   - Twitch y Kick: su reproductor oficial incrustado
   - Starvios: el video HLS del directo (hls.js; Safari lo reproduce solo)
   Empieza silenciado para que no se oiga tu propio directo con eco;
   se le sube el volumen desde el mismo reproductor.
   Usa funciones de app.js ($, store, sources, svGet, kickPublic…).
   ========================================================= */
const PL = Object.assign({ open: false, key: null, size: 'm' }, store.get('player', {}));
const HLS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.15/hls.min.js';
let plHls = null;
let plSeq = 0;
const kickSlugs = {};

const savePlayer = () => store.set('player', { open: PL.open, key: PL.key, size: PL.size });

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

function openPlayer(key) {
  if (key) PL.key = key;
  PL.open = true;
  savePlayer();
  renderPlayer();
}

function closePlayer() {
  PL.open = false;
  savePlayer();
  renderPlayer();
}

function renderPlayer() {
  const box = $('#player');
  const btn = $('#btn-player');
  btn.setAttribute('aria-pressed', String(PL.open));
  if (!PL.open) { stopPlayer(); box.hidden = true; box.replaceChildren(); return; }
  const list = playerSources();
  box.hidden = false;
  if (!list.length) {
    stopPlayer();
    box.replaceChildren(el('p', 'note pl-empty', 'Agrega canales en ⚙ Ajustes para ver su directo aquí.'));
    return;
  }
  if (!list.some((s) => s.key === PL.key)) PL.key = list[0].key;
  const cur = list.find((s) => s.key === PL.key);

  // Barra: canales + tamaño + abrir aparte + cerrar
  const bar = el('div', 'pl-bar');
  const pills = el('div', 'pill-tabs pl-pills');
  for (const s of list) {
    const b = el('button');
    b.type = 'button';
    b.setAttribute('aria-selected', String(s.key === PL.key));
    if (s.shared) b.style.setProperty('--sh', sharedColor(s.shared));
    b.append(el('span', 'plat-dot ' + s.p), el('span', null, (s.shared ? '🤝 ' : '') + s.ch));
    b.addEventListener('click', () => { if (PL.key !== s.key) { PL.key = s.key; savePlayer(); renderPlayer(); } });
    pills.append(b);
  }
  const keepLeft = ($('#player .pl-pills') || {}).scrollLeft || 0;
  const size = el('button', 'icon-btn small', { s: '▫', m: '◻', l: '⬜' }[PL.size]);
  size.type = 'button';
  size.title = 'Cambiar tamaño';
  size.addEventListener('click', () => {
    PL.size = { s: 'm', m: 'l', l: 's' }[PL.size];
    savePlayer();
    box.dataset.size = PL.size;
    size.textContent = { s: '▫', m: '◻', l: '⬜' }[PL.size];
  });
  const ext = el('a', 'icon-btn small pl-ext', '↗');
  ext.title = 'Abrir en su página';
  ext.target = '_blank';
  ext.rel = 'noopener';
  ext.href = publicUrl(cur);
  const close = el('button', 'icon-btn small', '✕');
  close.type = 'button';
  close.title = 'Cerrar reproductor';
  close.addEventListener('click', closePlayer);
  bar.append(pills, size, ext, close);

  const frame = el('div', 'pl-frame');
  box.dataset.size = PL.size;
  box.replaceChildren(bar, frame);
  pills.scrollLeft = keepLeft;
  const sel = pills.querySelector('[aria-selected="true"]');
  if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  loadStream(cur, frame, ext);
}

function stopPlayer() {
  plSeq++;
  if (plHls) { plHls.destroy(); plHls = null; }
}

const publicUrl = (s) => ({
  twitch: `https://www.twitch.tv/${encodeURIComponent(s.ch)}`,
  kick: `https://kick.com/${encodeURIComponent(kickSlugs[s.ch] || s.ch)}`,
  starvios: `https://starvios.com/live/${encodeURIComponent(s.ch)}`,
}[s.p]);

async function loadStream(s, frame, ext) {
  stopPlayer();
  const seq = plSeq;
  const msg = (text) => frame.replaceChildren(el('div', 'pl-msg', text));
  msg('Cargando…');
  try {
    if (s.p === 'twitch') {
      // Twitch exige "parent" = el dominio donde está la app
      const q = new URLSearchParams({ channel: s.ch, parent: location.hostname, muted: 'true', autoplay: 'true' });
      frame.replaceChildren(iframe('https://player.twitch.tv/?' + q));
    } else if (s.p === 'kick') {
      if (!kickSlugs[s.ch]) {
        try { kickSlugs[s.ch] = (await kickPublic(s.ch)).slug || s.ch; } catch { kickSlugs[s.ch] = s.ch; }
        if (seq !== plSeq) return;
        ext.href = publicUrl(s);
      }
      frame.replaceChildren(iframe(`https://player.kick.com/${encodeURIComponent(kickSlugs[s.ch])}?muted=true&autoplay=true`));
    } else {
      await loadStarvios(s, frame, seq, msg);
    }
  } catch (e) {
    if (seq === plSeq) msg('⚠ ' + e.message);
  }
}

function iframe(src) {
  const f = el('iframe');
  f.src = src;
  f.allow = 'autoplay; fullscreen; picture-in-picture';
  f.allowFullscreen = true;
  f.referrerPolicy = 'origin';
  return f;
}

async function loadStarvios(s, frame, seq, msg) {
  let channelId = svStreams[s.ch] && svStreams[s.ch].channelId;
  if (!channelId) {
    const [p] = await svGet('profiles?select=id&username=eq.' + encodeURIComponent(s.ch));
    if (!p) throw new Error('El canal no existe en Starvios');
    channelId = p.id;
  }
  const [row] = await svGet(`live_streams?select=playback_id,status,thumbnail_url&channel_id=eq.${channelId}&order=started_at.desc&limit=1`);
  if (seq !== plSeq) return;
  if (!row || row.status !== 'live' || !row.playback_id) { msg('⚫ Fuera de directo'); return; }
  const video = el('video');
  video.controls = true;
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  if (row.thumbnail_url) video.poster = row.thumbnail_url;
  frame.replaceChildren(video);
  // Igual que su web: los de Livepeer pasan por el proxy de Starvios (el enlace directo no deja verlos desde otra página)
  const lp = /^https:\/\/(?:livepeer\.studio|livepeercdn\.studio|playback\.livepeer\.studio)\/hls\/([A-Za-z0-9]{8,40})\/index\.m3u8/.exec(row.playback_id);
  const src = lp ? `https://starvios.com/api/public/lp-hls/${lp[1]}` : row.playback_id;
  try { await loadHlsLib(); } catch { /* sin hls.js: se intenta el reproductor del navegador */ }
  if (seq !== plSeq) return;
  if (!window.Hls || !Hls.isSupported()) {
    // iPhone / Safari reproducen HLS solos (Chrome dice "maybe" pero muchas veces falla, por eso va al final)
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.onerror = () => { if (seq === plSeq) msg('⚠ No se pudo cargar el video. Usa ↗ para abrirlo en su página.'); };
      video.src = src;
    } else msg('Este navegador no puede reproducir el directo de Starvios. Usa ↗ para abrirlo en su página.');
    return;
  }
  plHls = new Hls({ lowLatencyMode: true });
  plHls.on(Hls.Events.ERROR, (_, d) => {
    if (d.fatal && seq === plSeq) msg('⚠ No se pudo cargar el video (puede que el directo acabe de empezar o terminar). Toca el canal para reintentar.');
  });
  plHls.loadSource(src);
  plHls.attachMedia(video);
}

let hlsLoading = null;
function loadHlsLib() {
  if (window.Hls) return Promise.resolve();
  if (!hlsLoading) {
    hlsLoading = new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = HLS_URL;
      sc.onload = res;
      sc.onerror = () => { hlsLoading = null; rej(new Error('No se pudo cargar el reproductor de video')); };
      document.head.append(sc);
    });
  }
  return hlsLoading;
}

$('#btn-player').addEventListener('click', () => (PL.open ? closePlayer() : openPlayer()));

// Tocar un canal del chat compartido abre su directo
$('#shared-bar').addEventListener('click', (e) => {
  const chip = e.target.closest('.shared-chip');
  if (!chip) return;
  const login = chip.textContent.replace(/^👑\s*/, '').trim();
  if (login && login !== 'otro canal') openPlayer(srcKey('twitch', login));
});

// Si cambian los canales visibles o el chat compartido, actualiza los botones (sin recargar el video si sigue igual)
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
