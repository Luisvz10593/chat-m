'use strict';

/* =========================================================
   Panel "Herramientas": encuestas, predicciones, anuncios,
   marcadores, publicidad, modos del chat, raids, shoutouts
   y clips. Cada plataforma permite cosas distintas; el panel
   muestra solo lo que cada una acepta y explica el resto.
   Usa sesiones y funciones de app.js y stream.js.
   ========================================================= */
const tlDialog = $('#tools');

const TOOLS = [
  { id: 'poll', icon: '📊', name: 'Encuesta' },
  { id: 'prediction', icon: '🔮', name: 'Predicción' },
  { id: 'announce', icon: '📣', name: 'Anuncio' },
  { id: 'marker', icon: '📍', name: 'Marcador' },
  { id: 'ads', icon: '📺', name: 'Publicidad' },
  { id: 'chatmodes', icon: '💬', name: 'Modos del chat' },
  { id: 'raid', icon: '🚀', name: 'Raid y shoutout' },
  { id: 'clip', icon: '🎬', name: 'Clip' },
  { id: 'rewards', icon: '🏆', name: 'Canjes' },
];

// Qué permite cada plataforma. null = se puede; texto = por qué no.
const NO = (p, what) => `${PLATFORM_NAMES[p]} no permite ${what} por API`;
const SUPPORT = {
  poll: (t) => (t.p === 'twitch' ? (t.own ? null : 'Twitch solo permite encuestas en tu canal')
    : t.p === 'starvios' ? null : NO(t.p, 'encuestas')),
  prediction: (t) => (t.p === 'twitch' ? (t.own ? null : 'Twitch solo permite predicciones en tu canal')
    : t.p === 'starvios' ? null : NO(t.p, 'predicciones')),
  announce: (t) => (t.p === 'twitch' ? null : NO(t.p, 'anuncios')),
  marker: (t) => (t.p === 'twitch' ? null : NO(t.p, 'marcadores')),
  ads: (t) => (t.p === 'twitch' ? (t.own ? null : 'Twitch solo permite publicidad en tu canal')
    : t.p === 'kick' ? null : NO(t.p, 'controlar la publicidad')),
  chatmodes: (t) => (t.p === 'kick' ? NO('kick', 'cambiar los modos del chat') : null),
  raid: (t) => (t.p === 'kick' ? NO('kick', 'raids ni shoutouts') : null),
  clip: (t) => (t.p === 'twitch' ? null : NO(t.p, 'crear clips')),
  rewards: (t) => (t.own ? null : 'Las recompensas solo se gestionan en tu propio canal'),
};
// Dentro de "Raid y shoutout" cada acción tiene sus propias reglas
const RAID_OK = (t) => (t.own && t.p !== 'kick' ? null : t.p === 'kick' ? NO('kick', 'raids') : 'Solo puedes hacer raid desde tu canal');
const SHOUTOUT_OK = (t) => (t.p === 'twitch' ? null : NO(t.p, 'shoutouts'));

let tlTool = 'poll';
let tlTargets = [];
const tlSel = {};       // herramienta → Set de ids marcados
let tlTimer = null;     // refresco del estado en vivo (encuestas, predicciones…)
let tlLiveSeq = 0;

const fmtClock = (secs) => {
  const s = Math.max(0, Math.round(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0');
};
const tName = (t) => `${PLATFORM_NAMES[t.p]} · ${t.ch}`;

/* ---------- Canales disponibles ---------- */
function buildTargets() {
  const list = [];
  if (auth) {
    const chans = channelsOf('twitch');
    if (!chans.includes(auth.login)) chans.unshift(auth.login);
    for (const ch of chans) {
      list.push({ id: 'twitch:' + ch, p: 'twitch', ch, own: ch === auth.login, room: ch === auth.login ? auth.userId : twitchRooms[ch] });
    }
  }
  if (kickAuth) list.push({ id: 'kick', p: 'kick', ch: kickAuth.name || 'tu canal', own: true });
  if (svAuth) {
    let ownListed = false;
    for (const name of channelsOf('starvios')) {
      const s = svStreams[name];
      const own = !!s && s.channelId === svAuth.userId;
      ownListed = ownListed || own;
      list.push({ id: 'starvios:' + name, p: 'starvios', ch: name, name, own });
    }
    if (!ownListed) list.push({ id: 'starvios:me', p: 'starvios', ch: 'tu canal', own: true });
  }
  return list;
}

const twIds = {};
async function twUserId(login) {
  const key = String(login).toLowerCase().replace(/^@/, '');
  if (twIds[key]) return twIds[key];
  const j = await helix('GET', 'users', { login: key });
  const u = j.data && j.data[0];
  if (!u) throw new Error(`el usuario "${key}" no existe en Twitch`);
  twIds[key] = u.id;
  return u.id;
}
const twRoom = async (t) => t.room || twitchRooms[t.ch] || twUserId(t.ch);

// Directo de Starvios del destino: { id (directo), channelId }
async function svTarget(t) {
  if (t.name && svStreams[t.name]) return svStreams[t.name];
  let channelId = svAuth.userId;
  if (t.name) {
    const [p] = await svGet('profiles?select=id&username=eq.' + encodeURIComponent(t.name));
    if (!p) throw new Error(`el canal ${t.name} no existe`);
    channelId = p.id;
  }
  const [s] = await svGet(`live_streams?select=id&order=started_at.desc&limit=1&channel_id=eq.${channelId}`);
  if (!s) throw new Error('no tiene canal de directos');
  return { id: s.id, channelId };
}

/* =========================================================
   Abrir, pestañas y selección de canales
   ========================================================= */
function openTools() {
  tlTargets = buildTargets();
  renderToolTabs();
  showTool(tlTool);
  tlDialog.showModal();
}

function closeTools() {
  stopLive();
  tlDialog.close();
}

function renderToolTabs() {
  $('#tl-tabs').replaceChildren(...TOOLS.map((tool) => {
    const b = el('button', 'tl-tab', `${tool.icon} ${tool.name}`);
    b.type = 'button';
    b.dataset.id = tool.id;
    b.setAttribute('aria-selected', String(tool.id === tlTool));
    b.addEventListener('click', () => showTool(tool.id));
    return b;
  }));
}

function showTool(id) {
  tlTool = id;
  stopLive();
  for (const b of document.querySelectorAll('#tl-tabs .tl-tab')) {
    b.setAttribute('aria-selected', String(b.dataset.id === id));
    if (b.dataset.id === id) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  const body = $('#tl-body');
  body.replaceChildren();
  body.scrollTop = 0;
  if (!tlTargets.length) {
    body.append(el('p', 'note', 'Inicia sesión en ⚙ Ajustes con Twitch, Kick o Starvios para usar las herramientas.'));
    return;
  }
  if (id !== 'rewards') body.append(targetPicker(id)); // Canjes tiene su propia fila de canales
  RENDER[id](body);
}

// Fila de canales: los compatibles se pueden marcar; los demás muestran por qué no
function targetPicker(tool) {
  const box = el('section', 'stack');
  box.append(el('h3', null, 'Canales'));
  if (!tlSel[tool]) tlSel[tool] = new Set(tlTargets.filter((t) => !SUPPORT[tool](t) && t.own).map((t) => t.id));
  const row = el('div', 'row');
  const reasons = [];
  for (const t of tlTargets) {
    const why = SUPPORT[tool](t);
    const label = el('label', `pick ${t.p}${why ? ' off' : ''}`);
    const box2 = el('input');
    box2.type = 'checkbox';
    box2.checked = !why && tlSel[tool].has(t.id);
    box2.disabled = !!why;
    box2.addEventListener('change', () => {
      if (box2.checked) tlSel[tool].add(t.id); else tlSel[tool].delete(t.id);
      if (LIVE[tool]) startLive();
      if (tool === 'chatmodes') loadModes();
      if (tool === 'rewards') loadRewards();
    });
    label.append(box2, ' ' + tName(t));
    if (why) { label.title = why; reasons.push(`${tName(t)}: ${why}.`); }
    row.append(label);
  }
  box.append(row);
  if (reasons.length) box.append(el('p', 'note', reasons.join(' ')));
  return box;
}

const chosen = (tool) => tlTargets.filter((t) => !SUPPORT[tool](t) && tlSel[tool] && tlSel[tool].has(t.id));

/* =========================================================
   Ejecutar una acción en varios canales y mostrar el resultado
   fn(t) devuelve un texto, { text, link } o lanza un error.
   ========================================================= */
async function runOn(title, targets, fn, check) {
  const box = $('#tl-results');
  if (!targets.length) { toast('Marca al menos un canal compatible.', true); return; }
  box.replaceChildren(el('h3', null, title));
  const rows = targets.map((t) => {
    const card = el('div', `st-rcard ${t.p}`);
    card.dataset.result = 'busy';
    const head = el('div', 'st-card-head');
    head.append(el('span', `badge-platform ${t.p}`, PLATFORM_NAMES[t.p]), el('span', 'st-card-name', t.ch), el('span', 'st-result', '⏳'));
    const msg = el('p', 'st-result-msg', 'Enviando…');
    card.append(head, msg);
    box.append(card);
    return { card, msg, mark: head.querySelector('.st-result') };
  });
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const results = await Promise.allSettled(targets.map(async (t) => {
    const why = check ? check(t) : null;
    if (why) return { skip: why };
    return fn(t);
  }));
  let ok = 0;
  results.forEach((r, i) => {
    const { card, msg, mark } = rows[i];
    if (r.status === 'rejected') {
      card.dataset.result = 'fail'; mark.textContent = '✕'; msg.textContent = r.reason.message;
      return;
    }
    // Ojo: un texto suelto se convierte en objeto (los strings tienen un método .link() antiguo)
    const v = typeof r.value === 'string' ? { text: r.value } : r.value || {};
    if (v.skip) { card.dataset.result = 'skip'; mark.textContent = '–'; msg.textContent = v.skip; return; }
    ok++;
    card.dataset.result = 'ok';
    mark.textContent = '✓';
    msg.textContent = v.text || 'Listo';
    if (v.link) {
      const a = el('a', 'tl-link', v.linkText || 'Abrir');
      a.href = v.link;
      a.target = '_blank';
      a.rel = 'noopener';
      card.append(a);
    }
  });
  toast(ok === targets.length ? `${title}: listo.` : `${title}: ${ok} de ${targets.length} correctos.`, ok !== targets.length);
  if (LIVE[tlTool]) refreshLive();
  return ok;
}

/* ---------- Pequeñas piezas de formulario ---------- */
function field(label, input, counter) {
  const f = el('div', 'field');
  const head = el('div', 'field-head');
  const l = el('label', null, label);
  head.append(l);
  if (counter) {
    const c = el('span', 'count', `${input.value.length}/${input.maxLength}`);
    input.addEventListener('input', () => { c.textContent = `${input.value.length}/${input.maxLength}`; });
    head.append(c);
  }
  f.append(head, input);
  return f;
}
function textInput(max, placeholder) {
  const i = el('input');
  i.maxLength = max;
  i.placeholder = placeholder || '';
  i.autocomplete = 'off';
  return i;
}
// Botones de opción única (duración, color…)
function choiceRow(options, initial) {
  const row = el('div', 'choice-row');
  row.value = initial;
  for (const [value, label] of options) {
    const b = el('button', 'choice', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(value === initial));
    b.addEventListener('click', () => {
      row.value = value;
      for (const x of row.children) x.setAttribute('aria-pressed', String(x === b));
    });
    row.append(b);
  }
  return row;
}
function bigButton(text, onClick) {
  const b = el('button', 'primary big', text);
  b.type = 'button';
  b.addEventListener('click', async () => {
    b.disabled = true;
    try { await onClick(); } finally { b.disabled = false; }
  });
  return b;
}
const results = () => { const r = el('section', 'st-review'); r.id = 'tl-results'; return r; };

// Lista editable de opciones (encuesta 2–5, predicción 2–10)
function optionList(min, max, maxLen, placeholders) {
  const box = el('div', 'stack');
  const list = el('div', 'stack');
  const add = el('button', 'link-btn', '+ Agregar opción');
  add.type = 'button';
  const addRow = (value = '') => {
    const row = el('div', 'opt-row');
    const i = textInput(maxLen, placeholders[list.children.length] || `Opción ${list.children.length + 1}`);
    i.value = value;
    const x = el('button', 'icon-btn small', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', 'Quitar opción');
    x.addEventListener('click', () => { if (list.children.length > min) { row.remove(); sync(); } });
    row.append(i, x);
    list.append(row);
    sync();
  };
  const sync = () => {
    add.hidden = list.children.length >= max;
    for (const r of list.children) r.querySelector('.icon-btn').disabled = list.children.length <= min;
  };
  add.addEventListener('click', () => addRow());
  for (let k = 0; k < min; k++) addRow();
  box.values = () => [...list.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean);
  box.append(list, add);
  return box;
}

/* =========================================================
   Estado en vivo (encuestas y predicciones activas)
   ========================================================= */
function stopLive() { clearInterval(tlTimer); tlTimer = null; tlLiveSeq++; }
function startLive() { stopLive(); refreshLive(); tlTimer = setInterval(refreshLive, 3000); }

async function refreshLive() {
  const box = $('#tl-live');
  if (!box || !LIVE[tlTool]) return;
  const seq = tlLiveSeq;
  const tool = tlTool;
  const targets = chosen(tool);
  if (!targets.length) { box.replaceChildren(el('p', 'note', 'Marca un canal para ver si hay algo en curso.')); return; }
  const states = await Promise.allSettled(targets.map((t) => LIVE[tool].get(t)));
  if (seq !== tlLiveSeq || !document.body.contains(box)) return;
  const cards = [];
  states.forEach((r, i) => {
    const t = targets[i];
    if (r.status === 'rejected') { cards.push(liveCard(t, null, '⚠ ' + r.reason.message)); return; }
    if (r.value) cards.push(liveCard(t, r.value));
  });
  box.replaceChildren(...(cards.length ? cards : [el('p', 'note', 'No hay nada en curso en los canales marcados.')]));
}

// Tarjeta con barras de resultados y botones de control
function liveCard(t, s, error) {
  const card = el('div', `tl-live-card ${t.p}`);
  const head = el('div', 'st-card-head');
  head.append(el('span', `badge-platform ${t.p}`, PLATFORM_NAMES[t.p]), el('span', 'st-card-name', t.ch));
  card.append(head);
  if (error) { card.append(el('p', 'st-card-error', error)); return card; }

  card.append(el('p', 'tl-live-title', s.title));
  const left = (s.ends - Date.now()) / 1000;
  card.append(el('p', 'note', s.statusText || (left > 0 ? `Termina en ${fmtClock(left)}` : 'Tiempo terminado')));
  const total = s.rows.reduce((a, r) => a + r.value, 0) || 0;
  const max = Math.max(0, ...s.rows.map((r) => r.value));
  for (const [i, r] of s.rows.entries()) {
    const pct = total ? Math.round((r.value / total) * 100) : 0;
    const row = el('div', 'bar-row' + (r.value === max && total ? ' lead' : ''));
    const bar = el('div', 'bar');
    bar.style.setProperty('--w', pct + '%');
    const label = el('span', 'bar-label', r.label);
    const val = el('span', 'bar-val', `${pct}% · ${r.detail || r.value}`);
    bar.append(label, val);
    row.append(bar);
    // Como espectador (Starvios): votar en la encuesta o apostar en la predicción
    if (s.vote) {
      const b = el('button', 'choice small', '🗳 Votar');
      b.type = 'button';
      b.addEventListener('click', () => liveAction(t, () => s.vote(i), 'Voto enviado'));
      row.append(b);
    }
    if (s.bet) {
      const b = el('button', 'choice small', '💰 Apostar');
      b.type = 'button';
      b.addEventListener('click', () => {
        const pts = Math.floor(Number(prompt(`¿Cuántos puntos apuestas a "${r.label}"?`, '100')));
        if (pts >= 1) liveAction(t, () => s.bet(i, pts), 'Apuesta enviada');
      });
      row.append(b);
    }
    if (s.pick) {
      const b = el('button', 'choice small', '🏆 Ganó');
      b.type = 'button';
      b.addEventListener('click', () => {
        if (confirm(`¿Confirmas que ganó "${r.label}"? Se repartirán los puntos.`)) liveAction(t, () => s.pick(i), 'Predicción resuelta');
      });
      row.append(b);
    }
    card.append(row);
  }
  if (s.actions && s.actions.length) {
    const acts = el('div', 'row');
    for (const [label, fn, confirmText] of s.actions) {
      const b = el('button', 'choice', label);
      b.type = 'button';
      b.addEventListener('click', () => { if (!confirmText || confirm(confirmText)) liveAction(t, fn, label.replace(/^\S+\s/, '')); });
      acts.append(b);
    }
    card.append(acts);
  }
  return card;
}

async function liveAction(t, fn, label) {
  try {
    await fn();
    toast(`${label} en ${tName(t)}.`);
  } catch (e) {
    toast(`${tName(t)}: ${e.message}`, true);
  }
  refreshLive();
}

// Starvios: estado interactivo del directo (encuesta y predicción activas)
async function svInteractive(t) {
  const s = await svTarget(t);
  return (await svAuthed('POST', 'rpc/chat_interactive_state', { _stream: s.id })) || {};
}

const LIVE = {
  poll: {
    async get(t) {
      if (t.p === 'twitch') {
        const room = await twRoom(t);
        const j = await helix('GET', 'polls', { broadcaster_id: room, first: 1 });
        const p = j.data && j.data[0];
        if (!p || p.status !== 'ACTIVE') return null;
        const end = (status) => helix('PATCH', 'polls', null, { broadcaster_id: room, id: p.id, status });
        return {
          title: p.title,
          ends: Date.parse(p.started_at) + p.duration * 1000,
          rows: p.choices.map((c) => ({ label: c.title, value: c.votes || 0, detail: `${c.votes || 0} votos` })),
          actions: [['⏹ Terminar', () => end('TERMINATED')], ['🗑 Terminar y ocultar', () => end('ARCHIVED'), '¿Terminar la encuesta y ocultarla?']],
        };
      }
      const p = (await svInteractive(t)).poll;
      if (!p || p.status !== 'active') return null;
      const counts = Array.isArray(p.counts) ? p.counts : [];
      return {
        title: p.title,
        ends: Date.parse(p.ends_at),
        rows: (p.options || []).map((o, i) => ({ label: o, value: Number(counts[i] || 0), detail: `${Number(counts[i] || 0)} votos` })),
        vote: (i) => svAuthed('POST', 'rpc/vote_chat_poll', { _poll: p.id, _option: i }),
        actions: [
          ['⏹ Terminar', () => svAuthed('POST', 'rpc/end_chat_poll', { _poll: p.id, _cancel: false })],
          ['✕ Cancelar', () => svAuthed('POST', 'rpc/end_chat_poll', { _poll: p.id, _cancel: true }), '¿Cancelar la encuesta?'],
        ],
      };
    },
  },
  prediction: {
    async get(t) {
      if (t.p === 'twitch') {
        const room = await twRoom(t);
        const j = await helix('GET', 'predictions', { broadcaster_id: room, first: 1 });
        const p = j.data && j.data[0];
        if (!p || (p.status !== 'ACTIVE' && p.status !== 'LOCKED')) return null;
        const patch = (body) => helix('PATCH', 'predictions', null, { broadcaster_id: room, id: p.id, ...body });
        const locked = p.status === 'LOCKED';
        return {
          title: p.title,
          ends: Date.parse(p.created_at) + p.prediction_window * 1000,
          statusText: locked ? '🔒 Bloqueada: elige el resultado ganador' : null,
          rows: p.outcomes.map((o) => ({ label: o.title, value: o.channel_points || 0, detail: `${(o.channel_points || 0).toLocaleString('es')} pts · ${o.users || 0} personas` })),
          pick: (i) => patch({ status: 'RESOLVED', winning_outcome_id: p.outcomes[i].id }),
          actions: [
            ...(locked ? [] : [['🔒 Bloquear', () => patch({ status: 'LOCKED' })]]),
            ['✕ Cancelar y devolver puntos', () => patch({ status: 'CANCELED' }), '¿Cancelar la predicción y devolver los puntos?'],
          ],
        };
      }
      const p = (await svInteractive(t)).prediction;
      if (!p || (p.status !== 'active' && p.status !== 'locked')) return null;
      const pts = Array.isArray(p.points) ? p.points : [];
      const users = Array.isArray(p.users) ? p.users : [];
      const manage = (body) => svAuthed('POST', 'rpc/manage_chat_prediction', { _prediction: p.id, ...body });
      const locked = p.status === 'locked';
      return {
        title: p.title,
        ends: Date.parse(p.locks_at),
        statusText: locked ? '🔒 Bloqueada: elige el resultado ganador' : null,
        rows: (p.outcomes || []).map((o, i) => ({ label: o, value: Number(pts[i] || 0), detail: `${Number(pts[i] || 0).toLocaleString('es')} pts · ${Number(users[i] || 0)} personas` })),
        pick: (i) => manage({ _action: 'resolve', _winner: i }),
        bet: locked ? null : (i, pts) => svAuthed('POST', 'rpc/bet_chat_prediction', { _prediction: p.id, _outcome: i, _points: pts }),
        actions: [
          ...(locked ? [] : [['🔒 Bloquear', () => manage({ _action: 'lock' })]]),
          ['✕ Cancelar y devolver puntos', () => manage({ _action: 'cancel' }), '¿Cancelar la predicción y devolver los puntos?'],
        ],
      };
    },
  },
};

/* =========================================================
   Herramientas
   ========================================================= */
const DURATIONS = [[60, '1 min'], [120, '2 min'], [300, '5 min'], [600, '10 min']];

const RENDER = {
  poll(body) {
    const q = textInput(60, '¿Qué juego jugamos después?');
    const opts = optionList(2, 5, 25, ['Opción A', 'Opción B']);
    const dur = choiceRow(DURATIONS, 120);
    const go = bigButton('📊 Lanzar encuesta', async () => {
      const title = q.value.trim();
      const options = opts.values();
      if (!title || options.length < 2) { toast('Escribe la pregunta y al menos 2 opciones.', true); return; }
      const ok = await runOn('Encuesta', chosen('poll'), async (t) => {
        if (t.p === 'twitch') {
          await helix('POST', 'polls', null, { broadcaster_id: await twRoom(t), title, choices: options.map((c) => ({ title: c })), duration: dur.value });
        } else {
          await svAuthed('POST', 'rpc/create_chat_poll', { _stream: (await svTarget(t)).id, _title: title, _options: options, _seconds: dur.value });
        }
        return 'Encuesta publicada';
      });
      if (ok) q.value = '';
    });
    body.append(
      field('Pregunta', q, true), field('Opciones (2 a 5, máx. 25 caracteres)', opts), field('Duración', dur), go,
      liveSection('En curso'), results(),
    );
    startLive();
  },

  prediction(body) {
    const q = textInput(45, '¿Gano esta partida?');
    const opts = optionList(2, 10, 25, ['Sí', 'No']);
    const dur = choiceRow(DURATIONS, 120);
    const go = bigButton('🔮 Lanzar predicción', async () => {
      const title = q.value.trim();
      const outcomes = opts.values();
      if (!title || outcomes.length < 2) { toast('Escribe la pregunta y al menos 2 resultados.', true); return; }
      const ok = await runOn('Predicción', chosen('prediction'), async (t) => {
        if (t.p === 'twitch') {
          await helix('POST', 'predictions', null, { broadcaster_id: await twRoom(t), title, outcomes: outcomes.map((o) => ({ title: o })), prediction_window: dur.value });
        } else {
          await svAuthed('POST', 'rpc/create_chat_prediction', { _stream: (await svTarget(t)).id, _title: title, _outcomes: outcomes, _seconds: dur.value });
        }
        return 'Predicción publicada';
      });
      if (ok) q.value = '';
    });
    body.append(
      field('Pregunta', q, true), field('Resultados posibles (2 a 10)', opts), field('Tiempo para apostar', dur), go,
      liveSection('En curso'), results(),
    );
    startLive();
  },

  announce(body) {
    const msg = el('textarea', 'tl-textarea');
    msg.maxLength = 500;
    msg.rows = 3;
    msg.placeholder = 'Ej.: ¡Gracias por el raid! Síganse en todas las redes 💜';
    const color = choiceRow([['primary', 'Color del canal'], ['purple', '🟣 Morado'], ['blue', '🔵 Azul'], ['green', '🟢 Verde'], ['orange', '🟠 Naranja']], 'primary');
    const go = bigButton('📣 Enviar anuncio', async () => {
      const message = msg.value.trim();
      if (!message) { toast('Escribe el anuncio.', true); return; }
      const ok = await runOn('Anuncio', chosen('announce'), async (t) => {
        await helix('POST', 'chat/announcements', { broadcaster_id: await twRoom(t), moderator_id: auth.userId }, { message, color: color.value });
        return 'Anuncio enviado';
      });
      if (ok) msg.value = '';
    });
    body.append(field('Mensaje (máx. 500)', msg, true), field('Color', color), go, results());
  },

  marker(body) {
    const d = textInput(140, 'Ej.: momento épico, clip para YouTube');
    const go = bigButton('📍 Crear marcador', async () => {
      await runOn('Marcador', chosen('marker'), async (t) => {
        const j = await helix('POST', 'streams/markers', null, { user_id: await twRoom(t), description: d.value.trim() || undefined });
        const m = j.data && j.data[0];
        return m ? `Marcador creado en ${fmtClock(m.position_seconds)} del directo` : 'Marcador creado';
      });
      d.value = '';
    });
    body.append(
      el('p', 'note', 'Marca este momento del directo para encontrarlo después en el VOD. Funciona en tu canal y donde seas editor; el directo debe estar en vivo con VODs activados.'),
      field('Descripción (opcional)', d, true), go, results(),
    );
  },

  ads(body) {
    const dur = choiceRow([[30, '30 s'], [60, '1 min'], [90, '1:30'], [120, '2 min'], [180, '3 min']], 60);
    const status = el('div', 'stack');
    status.id = 'tl-ads-status';
    const go = bigButton('📺 Lanzar publicidad', async () => {
      if (!confirm(`¿Lanzar ${fmtClock(dur.value)} de publicidad ahora?`)) return;
      await runOn('Publicidad', chosen('ads'), async (t) => {
        if (t.p === 'twitch') {
          const j = await helix('POST', 'channels/commercial', null, { broadcaster_id: await twRoom(t), length: dur.value });
          const r = j.data && j.data[0];
          return r ? `${r.message || 'Publicidad iniciada'}${r.retry_after ? ` · próxima posible en ${fmtClock(r.retry_after)}` : ''}` : 'Publicidad iniciada';
        }
        if (dur.value > 90) return { skip: 'Kick permite pausas de hasta 90 s' };
        const id = crypto.randomUUID ? crypto.randomUUID() : randomString(16);
        const j = await kickApi('POST', 'ads/ad-break', { break_duration_seconds: dur.value, id });
        const left = j.data && j.data.remaining_ad_breaks;
        return `Pausa publicitaria iniciada${left != null ? ` · quedan ${left}` : ''}`;
      });
      loadAdStatus();
    });
    body.append(field('Duración', dur), go, el('h3', null, 'Estado'), status, results());
    loadAdStatus();
  },

  chatmodes(body) {
    const status = el('div', 'stack');
    status.id = 'tl-modes-status';
    const row = (title, options, apply) => {
      const box = el('div', 'field');
      box.append(el('div', 'field-head', title));
      const r = el('div', 'choice-row');
      for (const [value, label] of options) {
        const b = el('button', 'choice', label);
        b.type = 'button';
        b.addEventListener('click', async () => {
          await runOn(`${title}: ${label}`, chosen('chatmodes'), (t) => apply(t, value));
          loadModes();
        });
        r.append(b);
      }
      box.append(r);
      return box;
    };
    body.append(
      el('p', 'note', 'Toca una opción para aplicarla al momento en los canales marcados.'),
      row('🐢 Modo lento', [[0, 'Apagado'], [5, '5 s'], [10, '10 s'], [30, '30 s'], [60, '1 min'], [120, '2 min']], (t, v) => setMode(t, 'slow', v)),
      row('👥 Solo seguidores', [[-1, 'Apagado'], [10, '10 min'], [60, '1 h'], [1440, '1 día'], [10080, '1 semana']], (t, v) => setMode(t, 'followers', v)),
      row('⭐ Solo suscriptores', [[false, 'Apagado'], [true, 'Encendido']], (t, v) => setMode(t, 'subs', v)),
      row('😀 Solo emotes', [[false, 'Apagado'], [true, 'Encendido']], (t, v) => setMode(t, 'emote', v)),
      row('🔁 Mensajes únicos', [[false, 'Apagado'], [true, 'Encendido']], (t, v) => setMode(t, 'unique', v)),
      el('h3', null, 'Estado actual'), status, results(),
    );
    loadModes();
  },

  raid(body) {
    const user = textInput(40, 'Nombre del canal');
    const go = bigButton('🚀 Iniciar raid', async () => {
      const name = user.value.trim().replace(/^@/, '');
      if (!name) { toast('Escribe el canal al que quieres hacer raid.', true); return; }
      await runOn(`Raid a ${name}`, chosen('raid'), async (t) => {
        if (t.p === 'twitch') {
          await helix('POST', 'raids', { from_broadcaster_id: await twRoom(t), to_broadcaster_id: await twUserId(name) });
          return 'Raid preparada: Twitch la lanza en 90 s o al pulsar "Raid ahora" en Twitch';
        }
        await svAuthed('POST', 'rpc/start_raid', { _username: name });
        return 'Raid preparada';
      }, RAID_OK);
    });
    const cancel = el('button', 'choice', '✋ Cancelar raid');
    cancel.type = 'button';
    cancel.addEventListener('click', () => runOn('Cancelar raid', chosen('raid'), async (t) => {
      if (t.p === 'twitch') {
        await helix('DELETE', 'raids', { broadcaster_id: await twRoom(t) });
        return 'Raid cancelada';
      }
      const s = await svTarget(t);
      const [r] = await svGet(`live_raids?select=id&status=eq.pending&from_stream_id=eq.${s.id}`);
      if (!r) return { skip: 'No hay raid pendiente' };
      await svAuthed('POST', 'rpc/cancel_raid', { _id: r.id });
      return 'Raid cancelada';
    }, RAID_OK));

    const so = textInput(40, 'Canal a recomendar');
    const soBtn = bigButton('📢 Dar shoutout', async () => {
      const name = so.value.trim().replace(/^@/, '');
      if (!name) { toast('Escribe el canal para el shoutout.', true); return; }
      await runOn(`Shoutout a ${name}`, chosen('raid'), async (t) => {
        await helix('POST', 'chat/shoutouts', { from_broadcaster_id: await twRoom(t), to_broadcaster_id: await twUserId(name), moderator_id: auth.userId });
        return 'Shoutout enviado';
      }, SHOUTOUT_OK);
    });
    body.append(
      el('h3', null, '🚀 Raid'),
      el('p', 'note', 'Envía a tus espectadores a otro canal. Solo desde tu propio canal (Twitch y Starvios).'),
      field('Canal destino', user), go, cancel,
      el('h3', null, '📢 Shoutout'),
      el('p', 'note', 'Recomienda otro canal en el chat. Solo Twitch, en tu canal o donde seas moderador; tu directo debe estar en vivo.'),
      field('Canal', so), soBtn, results(),
    );
  },

  clip(body) {
    const title = textInput(100, 'Título del clip (opcional)');
    const dur = choiceRow([[15, '15 s'], [30, '30 s'], [45, '45 s'], [60, '60 s']], 30);
    const go = bigButton('🎬 Crear clip', async () => {
      await runOn('Clip', chosen('clip'), async (t) => {
        const params = { broadcaster_id: await twRoom(t), duration: dur.value };
        if (title.value.trim()) params.title = title.value.trim();
        const j = await helix('POST', 'clips', params);
        const c = j.data && j.data[0];
        return c ? { text: 'Clip creado (tarda unos segundos en procesarse)', link: c.edit_url, linkText: '✂️ Editar y publicar' } : 'Clip creado';
      });
    });
    body.append(
      el('p', 'note', 'Crea un clip de los últimos segundos del directo. Funciona en cualquier canal de Twitch que esté en vivo y permita clips.'),
      field('Título', title, true), field('Duración', dur), go, results(),
    );
  },
};

/* =========================================================
   🏆 Canjes: solicitudes y recompensas de tus canales
   - 📥 Solicitudes: los canjes de todos tus canales juntos o de
     uno solo; completar, devolver puntos (uno o todos).
   - 🏆 Recompensas: activar, pausar, editar todo, crear y borrar.
   Twitch y Kick solo dejan gestionar las recompensas creadas
   desde la misma app (Chat M). Starvios permite todas. Ninguna
   plataforma permite dar o quitar puntos a mano.
   ========================================================= */
const RWS = { view: 'requests', ch: 'all', status: 'all', data: {}, sig: '', seq: 0 };
const RW_STATUS = [['all', 'Todos'], ['pending', '⏳ Por revisar'], ['done', '✓ Completados'], ['refunded', '↩ Devueltos']];
const RW_STATUS_TAG = { pending: '⏳ Por revisar', done: '✓ Completado', refunded: '↩ Devuelto' };
const rwTargets = () => tlTargets.filter((t) => !SUPPORT.rewards(t));
const nfp = (n) => Number(n || 0).toLocaleString('es');

// Fila de opciones que cambia la selección sin volver a dibujarse (no regresa al inicio)
function pillRow(options, value, onPick) {
  const row = el('div', 'pill-tabs');
  for (const [v, label, p] of options) {
    const b = el('button');
    b.type = 'button';
    b.dataset.v = v;
    b.setAttribute('aria-selected', String(v === value));
    if (p) b.append(el('span', 'plat-dot ' + p));
    b.append(el('span', null, label), el('span', 'pill-count'));
    b.addEventListener('click', () => {
      for (const x of row.children) x.setAttribute('aria-selected', String(x === b));
      b.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      onPick(v);
    });
    row.append(b);
  }
  return row;
}

RENDER.rewards = function (body) {
  const targets = rwTargets();
  if (!targets.length) {
    body.append(el('p', 'note', 'Inicia sesión en ⚙ Ajustes con tu cuenta de Twitch, Kick o Starvios para ver los canjes de tu canal.'));
    return;
  }
  if (RWS.ch !== 'all' && !targets.some((t) => t.id === RWS.ch)) RWS.ch = 'all';
  RWS.sig = '';

  const views = pillRow([['requests', '📥 Solicitudes'], ['rewards', '🏆 Recompensas']], RWS.view, (v) => {
    RWS.view = v;
    statusRow.hidden = v !== 'requests';
    loadRewards();
  });
  views.classList.add('rw-views');
  const chans = pillRow([['all', '🌐 Todos'], ...targets.map((t) => [t.id, t.ch, t.p])], RWS.ch, (v) => { RWS.ch = v; drawRewards(); });
  chans.id = 'rw-chans';
  const statusRow = pillRow(RW_STATUS, RWS.status, (v) => { RWS.status = v; loadRewards(); });
  statusRow.hidden = RWS.view !== 'requests';
  const bulk = el('div', 'rw-bulk');
  bulk.id = 'rw-bulk';
  const list = el('div', 'stack');
  list.id = 'rw-list';
  list.append(el('p', 'note', 'Cargando…'));
  body.append(views, chans, statusRow, bulk, list,
    el('p', 'note', 'Twitch y Kick solo dejan gestionar las recompensas creadas desde Chat M; las de su web aparecen como "solo lectura" '
      + '(usa "Duplicar en Chat M" y desactiva la original). Ninguna plataforma permite dar o quitar puntos a mano: solo devolver los de un canje.'));
  loadRewards();
  tlTimer = setInterval(() => { if (RWS.view === 'requests') loadRewards(); }, 15000); // las solicitudes se actualizan solas
};

/* ---------- Datos de cada plataforma (todo normalizado) ----------
 * recompensa: { id, title, cost, enabled, paused, input, prompt, color, manage, ... }
 * canje:      { id, rewardId, rewardTitle, cost, user, input, at, status: pending|done|refunded }
 */
const RW = {
  twitch: {
    async rewards(t) {
      const room = await twRoom(t);
      const [all, mine] = await Promise.all([
        helix('GET', 'channel_points/custom_rewards', { broadcaster_id: room }),
        helix('GET', 'channel_points/custom_rewards', { broadcaster_id: room, only_manageable_rewards: true }),
      ]);
      const own = new Set((mine.data || []).map((r) => r.id));
      return (all.data || []).map((r) => ({
        id: r.id, title: r.title, cost: r.cost, enabled: r.is_enabled, paused: r.is_paused,
        input: r.is_user_input_required, prompt: r.prompt, color: r.background_color, manage: own.has(r.id),
        skipQueue: r.should_redemptions_skip_request_queue,
        maxStream: r.max_per_stream_setting && r.max_per_stream_setting.is_enabled ? r.max_per_stream_setting.max_per_stream : 0,
        maxUserStream: r.max_per_user_per_stream_setting && r.max_per_user_per_stream_setting.is_enabled ? r.max_per_user_per_stream_setting.max_per_user_per_stream : 0,
        cooldown: r.global_cooldown_setting && r.global_cooldown_setting.is_enabled ? r.global_cooldown_setting.global_cooldown_seconds : 0,
      }));
    },
    async redemptions(t, rewards, status) {
      const room = await twRoom(t);
      const map = { pending: 'UNFULFILLED', done: 'FULFILLED', refunded: 'CANCELED' };
      const wanted = status === 'all' ? Object.keys(map) : [status];
      const out = [];
      await Promise.all(rewards.filter((r) => r.manage).flatMap((r) => wanted.map(async (st) => {
        const j = await helix('GET', 'channel_points/custom_rewards/redemptions', { broadcaster_id: room, reward_id: r.id, status: map[st], sort: 'NEWEST', first: 50 });
        for (const x of j.data || []) out.push({ id: x.id, rewardId: r.id, rewardTitle: r.title, cost: x.reward ? x.reward.cost : r.cost, user: x.user_name, input: x.user_input, at: x.redeemed_at, status: st });
      })));
      return out;
    },
    async setRedemptions(t, list, ok) {
      const room = await twRoom(t);
      // Twitch acepta hasta 50 canjes de la misma recompensa por llamada
      const byReward = {};
      for (const x of list) (byReward[x.rewardId] = byReward[x.rewardId] || []).push(x.id);
      for (const [rid, ids] of Object.entries(byReward)) {
        for (let i = 0; i < ids.length; i += 50) {
          const q = new URLSearchParams({ broadcaster_id: room, reward_id: rid });
          for (const id of ids.slice(i, i + 50)) q.append('id', id);
          await helix('PATCH', 'channel_points/custom_rewards/redemptions?' + q, null, { status: ok ? 'FULFILLED' : 'CANCELED' });
        }
      }
    },
    async save(t, r, f) {
      const body = {
        title: f.title, cost: f.cost, prompt: f.prompt, is_enabled: f.enabled, is_user_input_required: f.input,
        should_redemptions_skip_request_queue: f.skipQueue,
        is_max_per_stream_enabled: f.maxStream > 0, ...(f.maxStream > 0 ? { max_per_stream: f.maxStream } : {}),
        is_max_per_user_per_stream_enabled: f.maxUserStream > 0, ...(f.maxUserStream > 0 ? { max_per_user_per_stream: f.maxUserStream } : {}),
        is_global_cooldown_enabled: f.cooldown > 0, ...(f.cooldown > 0 ? { global_cooldown_seconds: f.cooldown } : {}),
        ...(f.color ? { background_color: f.color.toUpperCase() } : {}),
      };
      const room = await twRoom(t);
      if (r) await helix('PATCH', 'channel_points/custom_rewards', { broadcaster_id: room, id: r.id }, { ...body, is_paused: f.paused });
      else await helix('POST', 'channel_points/custom_rewards', { broadcaster_id: room }, body);
    },
    quick: async (t, r, changes) => helix('PATCH', 'channel_points/custom_rewards', { broadcaster_id: await twRoom(t), id: r.id }, {
      ...(changes.enabled !== undefined ? { is_enabled: changes.enabled } : {}),
      ...(changes.paused !== undefined ? { is_paused: changes.paused } : {}),
    }),
    remove: async (t, r) => helix('DELETE', 'channel_points/custom_rewards', { broadcaster_id: await twRoom(t), id: r.id }),
    maxTitle: 45,
    fields: ['input', 'paused', 'skipQueue', 'maxStream', 'maxUserStream', 'cooldown'],
  },

  kick: {
    async rewards() {
      // Las solicitudes pendientes dicen qué recompensas puede gestionar esta app
      const [rw, rd] = await Promise.all([kickApi('GET', 'channels/rewards'), kickApi('GET', 'channels/rewards/redemptions?status=pending').catch(() => ({}))]);
      const manageIds = new Set();
      for (const g of rd.data || []) if (g.reward && g.reward.can_manage) manageIds.add(g.reward.id);
      const created = new Set(store.get('kickRewardsMine', [])); // Kick no lo dice en la lista: lo recordamos al crearlas
      return (rw.data || []).map((r) => ({
        id: r.id, title: r.title, cost: r.cost, enabled: r.is_enabled, paused: r.is_paused,
        input: r.is_user_input_required, prompt: r.description, color: r.background_color,
        skipQueue: r.should_redemptions_skip_request_queue, manage: created.has(r.id) || manageIds.has(r.id) || !!r.can_manage,
      }));
    },
    async redemptions(t, rewards, status) {
      const map = { pending: 'pending', done: 'accepted', refunded: 'rejected' };
      const wanted = status === 'all' ? Object.keys(map) : [status];
      const manage = new Set(rewards.filter((r) => r.manage).map((r) => r.id));
      const out = [];
      await Promise.all(wanted.map(async (st) => {
        const j = await kickApi('GET', 'channels/rewards/redemptions?status=' + map[st]);
        for (const g of j.data || []) {
          if (!g.reward || !(manage.has(g.reward.id) || g.reward.can_manage)) continue;
          for (const x of g.redemptions || []) {
            out.push({ id: x.id, rewardId: g.reward.id, rewardTitle: g.reward.title, cost: g.reward.cost, userId: x.redeemer && x.redeemer.user_id, input: x.user_input, at: x.redeemed_at, status: st });
          }
        }
      }));
      await kickNames(out);
      return out;
    },
    async setRedemptions(t, list, ok) {
      const ids = list.map((x) => x.id);
      for (let i = 0; i < ids.length; i += 25) {
        const j = await kickApi('POST', `channels/rewards/redemptions/${ok ? 'accept' : 'reject'}`, { ids: ids.slice(i, i + 25) });
        const fail = j && j.data && j.data[0];
        if (fail) throw new Error(`Kick rechazó ${j.data.length} (${fail.reason})`);
      }
    },
    async save(t, r, f) {
      const body = {
        title: f.title, cost: f.cost, description: f.prompt || '', is_enabled: f.enabled, is_user_input_required: f.input,
        should_redemptions_skip_request_queue: f.skipQueue, ...(f.color ? { background_color: f.color } : {}),
      };
      if (r) await kickApi('PATCH', 'channels/rewards/' + encodeURIComponent(r.id), { ...body, is_paused: f.paused });
      else {
        const j = await kickApi('POST', 'channels/rewards', body);
        if (j && j.data && j.data.id) store.set('kickRewardsMine', [...store.get('kickRewardsMine', []), j.data.id]);
      }
    },
    quick: (t, r, changes) => kickApi('PATCH', 'channels/rewards/' + encodeURIComponent(r.id), {
      ...(changes.enabled !== undefined ? { is_enabled: changes.enabled } : {}),
      ...(changes.paused !== undefined ? { is_paused: changes.paused } : {}),
    }),
    remove: (t, r) => kickApi('DELETE', 'channels/rewards/' + encodeURIComponent(r.id)),
    maxTitle: 50,
    fields: ['input', 'paused', 'skipQueue'],
  },

  starvios: {
    async rewards() {
      const rows = await svGet(`channel_rewards?select=*&channel_id=eq.${svAuth.userId}&order=sort,cost`);
      return rows.map((r) => ({
        id: r.id, title: r.title, cost: r.cost, enabled: r.enabled, prompt: r.description, color: r.color, kind: r.kind, emoji: r.emoji,
        input: false, maxChars: r.max_chars || 150, manage: true, // en Starvios el texto siempre es opcional (10–200 letras)
        cooldown: r.cooldown_seconds || 0, userCooldown: r.user_cooldown_seconds || 0,
        maxStream: r.max_per_stream || 0, maxUserStream: r.max_per_user_per_stream || 0, maxUserTotal: r.max_per_user_total || 0,
        subsOnly: !!r.subs_only,
      }));
    },
    async redemptions(t, rewards, status) {
      const reds = await svAuthed('GET', `channel_reward_redemptions?select=id,reward_title,cost,input,status,created_at,user_id&channel_id=eq.${svAuth.userId}&order=created_at.desc&limit=60`);
      const ids = [...new Set((reds || []).map((x) => x.user_id))];
      const names = {};
      if (ids.length) {
        for (const p of await svGet(`profiles?select=id,username,display_name&id=in.(${ids.join(',')})`)) names[p.id] = p.display_name || p.username;
      }
      // Starvios aplica el canje al momento ("done"); lo único que queda es devolverlo
      return (reds || []).map((x) => ({
        id: x.id, rewardTitle: x.reward_title, cost: x.cost, user: names[x.user_id] || 'alguien', input: x.input, at: x.created_at,
        status: x.status === 'done' ? 'done' : x.status === 'pending' ? 'pending' : 'refunded',
      })).filter((x) => status === 'all' || x.status === status);
    },
    async setRedemptions(t, list, ok) {
      if (ok) return; // ya están aplicados
      for (const x of list) await svAuthed('POST', 'rpc/refund_channel_redemption', { _id: x.id });
    },
    async save(t, r, f) {
      const body = {
        title: f.title, description: f.prompt || '', cost: f.cost, enabled: f.enabled, ...(f.color ? { color: f.color } : {}),
        max_chars: Math.min(200, Math.max(10, f.maxChars || 150)),
        cooldown_seconds: f.cooldown, user_cooldown_seconds: f.userCooldown,
        max_per_stream: f.maxStream || null, max_per_user_per_stream: f.maxUserStream || null, max_per_user_total: f.maxUserTotal || null,
        subs_only: f.subsOnly,
      };
      const rows = r
        ? await svAuthed('PATCH', `channel_rewards?id=eq.${encodeURIComponent(r.id)}&select=id`, body, { Prefer: 'return=representation' })
        : await svAuthed('POST', 'channel_rewards?select=id', { ...body, channel_id: svAuth.userId, kind: 'custom', emoji: '🎁' }, { Prefer: 'return=representation' });
      if (!rows || !rows.length) throw new Error('Starvios no aceptó el cambio');
    },
    async quick(t, r, changes) {
      const rows = await svAuthed('PATCH', `channel_rewards?id=eq.${encodeURIComponent(r.id)}&select=id`, { enabled: changes.enabled }, { Prefer: 'return=representation' });
      if (!rows || !rows.length) throw new Error('Starvios no aceptó el cambio');
    },
    async remove(t, r) {
      const rows = await svAuthed('DELETE', `channel_rewards?id=eq.${encodeURIComponent(r.id)}&select=id`, null, { Prefer: 'return=representation' });
      if (!rows || !rows.length) throw new Error('Starvios no borró la recompensa');
    },
    maxTitle: 45,
    fields: ['maxChars', 'subsOnly', 'maxStream', 'maxUserStream', 'maxUserTotal', 'cooldown', 'userCooldown'],
  },
};

// Kick solo da el id de quien canjeó: busca los nombres (y los recuerda)
const kickNameCache = new Map();
async function kickNames(list) {
  const missing = [...new Set(list.map((x) => x.userId).filter((id) => id && !kickNameCache.has(id)))];
  for (let i = 0; i < missing.length; i += 50) {
    try {
      const j = await kickApi('GET', 'users?' + missing.slice(i, i + 50).map((id) => 'id=' + id).join('&'));
      for (const u of j.data || []) kickNameCache.set(u.user_id, u.name);
    } catch { /* sin permiso: se muestra el número */ }
  }
  for (const x of list) x.user = kickNameCache.get(x.userId) || (x.userId ? '#' + x.userId : 'alguien');
}

/* ---------- Carga y dibujo ---------- */
async function loadRewards() {
  if (!$('#rw-list')) return;
  const seq = ++RWS.seq;
  const view = RWS.view;
  const status = RWS.status;
  await Promise.all(rwTargets().map(async (t) => {
    const api = RW[t.p];
    try {
      const rewards = await api.rewards(t);
      const reds = view === 'requests' ? await api.redemptions(t, rewards, status) : null;
      RWS.data[t.id] = { rewards, reds, error: null };
    } catch (e) {
      RWS.data[t.id] = { rewards: [], reds: [], error: e.message };
    }
  }));
  if (seq === RWS.seq) drawRewards();
}

function drawRewards() {
  const list = $('#rw-list');
  if (!list) return;
  const targets = rwTargets();
  const shown = RWS.ch === 'all' ? targets : targets.filter((t) => t.id === RWS.ch);
  // Números en los botones de canal
  for (const b of document.querySelectorAll('#rw-chans button')) {
    const ids = b.dataset.v === 'all' ? targets.map((t) => t.id) : [b.dataset.v];
    const n = ids.reduce((a, id) => {
      const d = RWS.data[id];
      if (!d) return a;
      return a + (RWS.view === 'requests' ? (d.reds || []).filter((x) => x.status === 'pending').length : d.rewards.length);
    }, 0);
    b.querySelector('.pill-count').textContent = n ? String(n) : '';
  }
  // No vuelve a dibujar si nada cambió (para no saltar mientras lees)
  const sig = JSON.stringify([RWS.view, RWS.ch, RWS.status, shown.map((t) => RWS.data[t.id])]);
  if (sig === RWS.sig) return;
  RWS.sig = sig;
  if (RWS.view === 'requests') drawRequests(list, shown);
  else drawRewardList(list, shown);
}

function drawRequests(list, shown) {
  const rows = [];
  const errors = [];
  for (const t of shown) {
    const d = RWS.data[t.id];
    if (!d) continue;
    if (d.error) errors.push(el('p', 'st-card-error', `⚠ ${tName(t)}: ${d.error}`));
    for (const x of d.reds || []) rows.push({ t, x });
  }
  rows.sort((a, b) => Date.parse(b.x.at) - Date.parse(a.x.at));

  // Acciones para todos los que están por revisar
  const bulk = $('#rw-bulk');
  const pending = rows.filter((r) => r.x.status === 'pending');
  const canComplete = pending.filter((r) => r.t.p !== 'starvios');
  bulk.replaceChildren();
  if (canComplete.length > 1) bulk.append(rwButton(`✓ Completar todos (${canComplete.length})`, 'choice small ok', () => rwBulk(canComplete, true)));
  if (pending.length > 1) bulk.append(rwButton(`↩ Devolver todos (${pending.length})`, 'choice small danger', () => rwBulk(pending, false)));

  const nodes = [...errors];
  if (!rows.length) nodes.push(el('p', 'empty', RWS.status === 'pending' ? 'No hay canjes por revisar. 🎉' : 'No hay canjes para mostrar.'));
  for (const { t, x } of rows.slice(0, 200)) {
    const row = el('div', `rw-req ${t.p} ${x.status}`);
    const info = el('div', 'rw-info');
    const head = el('div', 'rw-req-head');
    if (RWS.ch === 'all') head.append(el('span', `badge-platform ${t.p}`, t.ch));
    head.append(el('strong', null, x.user), el('span', 'tag', RW_STATUS_TAG[x.status]));
    info.append(head, el('div', null, `🏆 ${x.rewardTitle}` + (x.cost ? ` · ${nfp(x.cost)} pts` : '')));
    if (x.input) info.append(el('div', 'rw-input', '💬 ' + x.input));
    info.append(el('div', 'note', x.at ? new Date(x.at).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''));
    const acts = el('div', 'rw-acts');
    if (x.status === 'pending' && t.p !== 'starvios') acts.append(rwButton('✓ Completar', 'choice small ok', () => rwBulk([{ t, x }], true, true)));
    if (x.status === 'pending' || (x.status === 'done' && t.p === 'starvios')) {
      acts.append(rwButton('↩ Devolver puntos', 'choice small', () => {
        if (confirm(`¿Devolver ${x.cost ? nfp(x.cost) + ' puntos' : 'los puntos'} a ${x.user} por "${x.rewardTitle}"?`)) rwBulk([{ t, x }], false, true);
      }));
    }
    row.append(info, acts);
    nodes.push(row);
  }
  list.replaceChildren(...nodes);
}

function drawRewardList(list, shown) {
  $('#rw-bulk').replaceChildren();
  const nodes = [];
  for (const t of shown) {
    const d = RWS.data[t.id];
    const sec = el('section', `tl-live-card ${t.p} rw-sec`);
    const head = el('div', 'st-card-head');
    head.append(el('span', `badge-platform ${t.p}`, PLATFORM_NAMES[t.p]), el('span', 'st-card-name', t.ch),
      rwButton('＋ Nueva', 'choice small ok', () => rewardEditor(t, null)));
    sec.append(head);
    if (!d) sec.append(el('p', 'note', 'Cargando…'));
    else if (d.error) sec.append(el('p', 'st-card-error', '⚠ ' + d.error));
    else if (!d.rewards.length) sec.append(el('p', 'note', 'Este canal no tiene recompensas.'));
    else for (const r of d.rewards) sec.append(rewardRow(t, r));
    nodes.push(sec);
  }
  list.replaceChildren(...nodes);
}

function rewardRow(t, r) {
  const api = RW[t.p];
  const row = el('div', 'rw-row' + (r.enabled ? '' : ' off'));
  const info = el('div', 'rw-info');
  const title = el('strong', null, (r.emoji ? r.emoji + ' ' : '') + r.title);
  if (r.color) title.style.borderLeft = `4px solid ${r.color}`;
  info.append(title, el('span', 'rw-cost', ` · ${nfp(r.cost)} pts`));
  if (r.prompt) info.append(el('div', 'note', r.prompt));
  const tags = el('div', 'st-card-tags');
  tags.append(el('span', 'tag' + (r.enabled ? ' on' : ''), r.enabled ? 'Activa' : 'Desactivada'));
  if (r.paused) tags.append(el('span', 'tag', '⏸ Pausada'));
  if (r.input) tags.append(el('span', 'tag', '💬 Pide texto'));
  if (r.skipQueue) tags.append(el('span', 'tag', '⚡ Automática'));
  if (r.subsOnly) tags.append(el('span', 'tag', '⭐ Solo subs'));
  if (r.cooldown) tags.append(el('span', 'tag', `⏱ ${fmtClock(r.cooldown)}`));
  if (r.maxStream) tags.append(el('span', 'tag', `${r.maxStream} por directo`));
  if (!r.manage) tags.append(el('span', 'tag', '🔒 Solo lectura'));
  info.append(tags);
  const acts = el('div', 'rw-acts');
  if (r.manage) {
    const sw = el('label', 'toggle');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !!r.enabled;
    cb.title = r.enabled ? 'Desactivar' : 'Activar';
    cb.addEventListener('change', () => rwDo(t, cb.checked ? 'Recompensa activada' : 'Recompensa desactivada', () => api.quick(t, r, { enabled: cb.checked })));
    sw.append(cb);
    acts.append(sw);
    if (api.fields.includes('paused')) acts.append(rwButton(r.paused ? '▶' : '⏸', 'choice small', () => rwDo(t, r.paused ? 'Reanudada' : 'Pausada', () => api.quick(t, r, { paused: !r.paused }))));
    acts.append(rwButton('✎ Editar', 'choice small', () => rewardEditor(t, r)));
    acts.append(rwButton('🗑', 'choice small danger', () => {
      if (confirm(`¿Borrar la recompensa "${r.title}"?`)) rwDo(t, 'Recompensa borrada', () => api.remove(t, r));
    }));
  } else {
    acts.append(rwButton('⧉ Duplicar en Chat M', 'choice small', () => {
      const name = prompt('Nombre de la copia (debe ser distinto al original):', r.title + ' ★');
      if (name) rwDo(t, 'Copia creada: desactiva la original en la web de ' + PLATFORM_NAMES[t.p], () => api.save(t, null, { ...r, title: name.slice(0, api.maxTitle) }));
    }));
  }
  row.append(info, acts);
  return row;
}

/* ---------- Editor de recompensa (crear o editar todo) ---------- */
function rewardEditor(t, r) {
  const api = RW[t.p];
  const has = (k) => api.fields.includes(k);
  const dlg = $('#user-card');
  const sheet = el('div', 'sheet uc rw-editor');
  const num = (v, min = 0) => { const i = el('input'); i.type = 'number'; i.min = String(min); i.inputMode = 'numeric'; i.value = String(v || 0); return i; };
  const sw = (label, checked, hint) => {
    const l = el('label', 'toggle set-switch');
    const s = el('span', null, label);
    if (hint) s.append(el('small', null, hint));
    const i = el('input');
    i.type = 'checkbox';
    i.checked = !!checked;
    l.append(s, i);
    l.input = i;
    return l;
  };
  const v = r || { title: '', cost: 500, enabled: true, color: '#9146FF', maxChars: 150 };
  const title = textInput(api.maxTitle, 'Ej.: Elige la próxima rutina');
  title.value = v.title || '';
  const cost = num(v.cost, 1);
  const desc = textInput(200, 'Texto que verá quien la canjee (opcional)');
  desc.value = v.prompt || '';
  const color = el('input');
  color.type = 'color';
  color.value = /^#[0-9a-f]{6}$/i.test(v.color || '') ? v.color : '#9146ff';
  const enabled = sw('Activa', v.enabled);
  const parts = [el('h2', null, `${r ? '✎ Editar' : '＋ Nueva'} recompensa · ${PLATFORM_NAMES[t.p]}`),
    field('Nombre', title, true), field('Costo en puntos', cost), field('Descripción', desc, true), field('Color', color), enabled];
  const ctl = {};
  if (has('input')) { ctl.input = sw('Pedir un texto al canjear', v.input); parts.push(ctl.input); }
  if (has('maxChars')) { ctl.maxChars = num(v.maxChars || 150, 10); parts.push(field('Máximo de letras del texto', ctl.maxChars)); }
  if (has('paused') && r) { ctl.paused = sw('Pausada', v.paused, 'Se ve pero no se puede canjear'); parts.push(ctl.paused); }
  if (has('skipQueue')) { ctl.skipQueue = sw('Completar automáticamente', v.skipQueue, 'No pasa por la lista de solicitudes'); parts.push(ctl.skipQueue); }
  if (has('subsOnly')) { ctl.subsOnly = sw('Solo suscriptores', v.subsOnly); parts.push(ctl.subsOnly); }
  const limits = el('div', 'rw-limits');
  if (has('maxStream')) { ctl.maxStream = num(v.maxStream); limits.append(field('Máximo por directo', ctl.maxStream)); }
  if (has('maxUserStream')) { ctl.maxUserStream = num(v.maxUserStream); limits.append(field('Máximo por persona en el directo', ctl.maxUserStream)); }
  if (has('maxUserTotal')) { ctl.maxUserTotal = num(v.maxUserTotal); limits.append(field('Máximo por persona (siempre)', ctl.maxUserTotal)); }
  if (has('cooldown')) { ctl.cooldown = num(Math.round((v.cooldown || 0) / 60)); limits.append(field('Espera entre canjes (min)', ctl.cooldown)); }
  if (has('userCooldown')) { ctl.userCooldown = num(Math.round((v.userCooldown || 0) / 60)); limits.append(field('Espera por persona (min)', ctl.userCooldown)); }
  if (limits.childElementCount) parts.push(el('h4', null, 'Límites (0 = sin límite)'), limits);

  const save = bigButton(r ? 'Guardar cambios' : 'Crear recompensa', async () => {
    const n = (i) => Math.max(0, Math.floor(Number(i && i.value) || 0));
    const f = {
      title: title.value.trim().slice(0, api.maxTitle), cost: Math.floor(Number(cost.value)), prompt: desc.value.trim(),
      color: color.value, enabled: enabled.input.checked,
      input: ctl.input ? ctl.input.input.checked : false, maxChars: n(ctl.maxChars),
      paused: ctl.paused ? ctl.paused.input.checked : !!v.paused, skipQueue: ctl.skipQueue ? ctl.skipQueue.input.checked : false,
      subsOnly: ctl.subsOnly ? ctl.subsOnly.input.checked : false,
      maxStream: n(ctl.maxStream), maxUserStream: n(ctl.maxUserStream), maxUserTotal: n(ctl.maxUserTotal),
      cooldown: n(ctl.cooldown) * 60, userCooldown: n(ctl.userCooldown) * 60,
    };
    if (!f.title || !(f.cost >= 1)) { toast('Escribe el nombre y un costo de al menos 1.', true); return; }
    if (await rwDo(t, r ? 'Recompensa guardada' : 'Recompensa creada', () => api.save(t, r, f))) dlg.close();
  });
  const cancel = rwButton('Cancelar', 'choice', () => dlg.close());
  const row = el('div', 'row end');
  row.append(cancel, save);
  sheet.append(...parts, row);
  dlg.replaceChildren(sheet);
  dlg.showModal();
}

function rwButton(text, cls, onClick) {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

async function rwDo(t, okText, fn) {
  try {
    await fn();
    toast(`${okText} (${tName(t)}).`);
    loadRewards();
    return true;
  } catch (e) {
    toast(`${tName(t)}: ${e.message}`, true);
    loadRewards();
    return false;
  }
}

// Completar (ok) o devolver puntos de varios canjes, agrupados por canal
async function rwBulk(items, ok, single) {
  if (!single && !confirm(ok ? `¿Marcar ${items.length} canjes como completados?` : `¿Devolver los puntos de ${items.length} canjes?`)) return;
  const byT = new Map();
  for (const { t, x } of items) { if (!byT.has(t.id)) byT.set(t.id, { t, list: [] }); byT.get(t.id).list.push(x); }
  let fails = 0;
  for (const { t, list } of byT.values()) {
    try { await RW[t.p].setRedemptions(t, list, ok); } catch (e) { fails++; toast(`${tName(t)}: ${e.message}`, true); }
  }
  if (!fails) toast(ok ? (items.length > 1 ? `${items.length} canjes completados` : 'Canje completado') : (items.length > 1 ? `Puntos devueltos (${items.length})` : 'Puntos devueltos'));
  loadRewards();
}

function liveSection(title) {
  const s = el('section', 'stack');
  const live = el('div', 'stack');
  live.id = 'tl-live';
  s.append(el('h3', null, title), live);
  return s;
}

/* ---------- Publicidad: estado ---------- */
async function loadAdStatus() {
  const box = $('#tl-ads-status');
  if (!box) return;
  const targets = tlTargets.filter((t) => !SUPPORT.ads(t));
  box.replaceChildren(el('p', 'note', 'Cargando…'));
  const cards = await Promise.all(targets.map(async (t) => {
    const card = el('div', `tl-live-card ${t.p}`);
    const head = el('div', 'st-card-head');
    head.append(el('span', `badge-platform ${t.p}`, PLATFORM_NAMES[t.p]), el('span', 'st-card-name', t.ch));
    card.append(head);
    try {
      if (t.p === 'twitch') {
        const room = await twRoom(t);
        const j = await helix('GET', 'channels/ads', { broadcaster_id: room });
        const a = (j.data && j.data[0]) || {};
        const next = a.next_ad_at ? (Date.parse(a.next_ad_at) - Date.now()) / 1000 : null;
        card.append(el('p', null, next != null && next > 0 ? `Próxima publicidad automática en ${fmtClock(next)} (${a.duration || '?'} s)` : 'Sin publicidad automática programada (o no estás en vivo)'));
        if (a.preroll_free_time) card.append(el('p', 'note', `Sin pre-roll durante ${fmtClock(a.preroll_free_time)}`));
        const snooze = el('button', 'choice', `⏰ Posponer 5 min (te quedan ${a.snooze_count ?? 0})`);
        snooze.type = 'button';
        snooze.disabled = !a.snooze_count || next == null;
        snooze.addEventListener('click', async () => {
          try { await helix('POST', 'channels/ads/schedule/snooze', { broadcaster_id: room }); toast('Publicidad pospuesta 5 minutos.'); } catch (e) { toast(e.message, true); }
          loadAdStatus();
        });
        card.append(snooze);
      } else {
        const j = await kickApi('GET', 'ads/ad-break-status');
        const a = j.data || {};
        if (!a.opted_in) card.append(el('p', 'st-card-warn', 'Tu canal no está inscrito en anuncios de Kick (actívalo en Kick, fuera de directo).'));
        else if (a.ads_blocked) card.append(el('p', 'st-card-warn', 'Los anuncios están bloqueados en tu canal.'));
        else card.append(el('p', null, `Pausas disponibles: ${a.remaining_ad_breaks ?? '?'}${a.limits ? ` (máx. ${a.limits.max} cada ${fmtClock(a.limits.period_seconds)})` : ''}`));
        if (a.auto_ads_active) card.append(el('p', 'note', 'Anuncios automáticos activos.'));
      }
    } catch (e) {
      card.append(el('p', 'st-card-error', '⚠ ' + e.message));
    }
    return card;
  }));
  if (document.body.contains(box)) box.replaceChildren(...cards);
}

/* ---------- Modos del chat ---------- */
const SV_MODE_FIELDS = 'slow_mode_seconds,link_policy,blocked_words,followers_only_minutes,block_caps,unique_chat,automod,emote_only,is_members_only,min_account_age_days,adults_only';

async function getModes(t) {
  if (t.p === 'twitch') {
    const j = await helix('GET', 'chat/settings', { broadcaster_id: await twRoom(t), moderator_id: auth.userId });
    const c = (j.data && j.data[0]) || {};
    return {
      slow: c.slow_mode ? c.slow_mode_wait_time : 0,
      followers: c.follower_mode ? c.follower_mode_duration : -1,
      subs: !!c.subscriber_mode, emote: !!c.emote_mode, unique: !!c.unique_chat_mode,
    };
  }
  const s = await svTarget(t);
  const [r] = await svGet(`live_streams?select=${SV_MODE_FIELDS}&id=eq.${s.id}`);
  if (!r) throw new Error('no se encontró el directo');
  return {
    raw: r, slow: r.slow_mode_seconds || 0, followers: r.followers_only_minutes ? r.followers_only_minutes : -1,
    subs: !!r.is_members_only, emote: !!r.emote_only, unique: !!r.unique_chat,
  };
}

async function setMode(t, mode, value) {
  if (t.p === 'twitch') {
    const body = {
      slow: value ? { slow_mode: true, slow_mode_wait_time: Math.max(3, value) } : { slow_mode: false },
      followers: value >= 0 ? { follower_mode: true, follower_mode_duration: value } : { follower_mode: false },
      subs: { subscriber_mode: value },
      emote: { emote_mode: value },
      unique: { unique_chat_mode: value },
    }[mode];
    await helix('PATCH', 'chat/settings', { broadcaster_id: await twRoom(t), moderator_id: auth.userId }, body);
    return 'Aplicado';
  }
  // Starvios pide todos los ajustes juntos: se leen los actuales y se cambia solo uno
  const s = await svTarget(t);
  const cur = (await getModes(t)).raw;
  const next = {
    _channel: s.channelId,
    _slow: cur.slow_mode_seconds || 0,
    _link_policy: cur.link_policy,
    _blocked: cur.blocked_words || [],
    _followers: cur.followers_only_minutes || 0,
    _caps: !!cur.block_caps,
    _unique: !!cur.unique_chat,
    _automod: !!cur.automod,
    _emote: !!cur.emote_only,
    _members: !!cur.is_members_only,
    _min_age_days: cur.min_account_age_days ?? 0,
    _adults: cur.adults_only ?? false,
  };
  if (mode === 'slow') next._slow = value;
  if (mode === 'followers') next._followers = value > 0 ? value : 0;
  if (mode === 'subs') next._members = value;
  if (mode === 'emote') next._emote = value;
  if (mode === 'unique') next._unique = value;
  await svAuthed('POST', 'rpc/update_chat_settings', next);
  return mode === 'subs' ? 'Aplicado (en Starvios es "solo miembros")' : 'Aplicado';
}

async function loadModes() {
  const box = $('#tl-modes-status');
  if (!box) return;
  const targets = chosen('chatmodes');
  if (!targets.length) { box.replaceChildren(el('p', 'note', 'Marca un canal para ver su estado.')); return; }
  const cards = await Promise.all(targets.map(async (t) => {
    const card = el('div', `tl-live-card ${t.p}`);
    const head = el('div', 'st-card-head');
    head.append(el('span', `badge-platform ${t.p}`, PLATFORM_NAMES[t.p]), el('span', 'st-card-name', t.ch));
    card.append(head);
    try {
      const m = await getModes(t);
      const chips = el('div', 'st-card-tags');
      const chip = (on, text) => chips.append(el('span', 'tag' + (on ? ' on' : ''), (on ? '● ' : '○ ') + text));
      chip(m.slow > 0, m.slow > 0 ? `Lento ${m.slow} s` : 'Lento');
      chip(m.followers >= 0, m.followers >= 0 ? `Seguidores ${m.followers ? fmtFollow(m.followers) : ''}`.trim() : 'Seguidores');
      chip(m.subs, t.p === 'starvios' ? 'Solo miembros' : 'Solo subs');
      chip(m.emote, 'Solo emotes');
      chip(m.unique, 'Únicos');
      card.append(chips);
    } catch (e) {
      card.append(el('p', 'st-card-error', '⚠ ' + e.message));
    }
    return card;
  }));
  if (document.body.contains(box)) box.replaceChildren(...cards);
}
const fmtFollow = (min) => (min >= 1440 ? `${Math.round(min / 1440)} d` : min >= 60 ? `${Math.round(min / 60)} h` : `${min} min`);

/* ---------- Eventos ---------- */
$('#btn-tools').addEventListener('click', openTools);
$('#tl-close').addEventListener('click', closeTools);
tlDialog.addEventListener('close', stopLive);
