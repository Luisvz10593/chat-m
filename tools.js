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
  body.append(targetPicker(id));
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
    const c = el('span', 'count', `0/${input.maxLength}`);
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
   🏆 Canjes: recompensas y canjes de puntos de tu canal
   Twitch y Kick solo dejan gestionar (canjes, devolver puntos,
   editar) las recompensas creadas desde la misma app, es decir,
   desde Chat M. Starvios permite gestionar todas las de tu canal.
   Ninguna permite dar o quitar puntos a mano.
   ========================================================= */
RENDER.rewards = function (body) {
  const sections = el('div', 'stack');
  sections.id = 'tl-rw';
  body.append(redeemSection());
  body.append(
    el('p', 'note warn', 'Twitch y Kick solo dejan ver los canjes, devolver puntos y editar las recompensas creadas desde Chat M. '
      + 'Las que creaste en su web aparecen sin botones: usa "Duplicar en Chat M" y desactiva la original en su web. '
      + 'Ninguna plataforma permite dar o quitar puntos a mano; solo devolver los de un canje.'),
    sections, results(),
  );
  loadRewards();
  tlTimer = setInterval(loadRewards, 10000); // los canjes pendientes se actualizan solos
};

const RW = {
  twitch: {
    async list(t) {
      const room = await twRoom(t);
      const [all, mine] = await Promise.all([
        helix('GET', 'channel_points/custom_rewards', { broadcaster_id: room }),
        helix('GET', 'channel_points/custom_rewards', { broadcaster_id: room, only_manageable_rewards: true }),
      ]);
      const own = new Set((mine.data || []).map((r) => r.id));
      const rewards = (all.data || []).map((r) => ({
        id: r.id, title: r.title, cost: r.cost, enabled: r.is_enabled, paused: r.is_paused,
        input: r.is_user_input_required, prompt: r.prompt, color: r.background_color, manage: own.has(r.id),
      }));
      // Canjes pendientes de las recompensas que Chat M puede gestionar
      const pending = [];
      await Promise.all(rewards.filter((r) => r.manage).map(async (r) => {
        const j = await helix('GET', 'channel_points/custom_rewards/redemptions', { broadcaster_id: room, reward_id: r.id, status: 'UNFULFILLED', first: 50 });
        for (const x of j.data || []) pending.push({ id: x.id, reward: r, user: x.user_name, input: x.user_input, at: x.redeemed_at });
      }));
      return { rewards, pending };
    },
    setRedemption: async (t, x, ok) => helix('PATCH', 'channel_points/custom_rewards/redemptions',
      { id: x.id, broadcaster_id: await twRoom(t), reward_id: x.reward.id }, { status: ok ? 'FULFILLED' : 'CANCELED' }),
    update: async (t, r, changes) => helix('PATCH', 'channel_points/custom_rewards', { broadcaster_id: await twRoom(t), id: r.id }, {
      ...(changes.enabled !== undefined ? { is_enabled: changes.enabled } : {}),
      ...(changes.paused !== undefined ? { is_paused: changes.paused } : {}),
      ...(changes.cost !== undefined ? { cost: changes.cost } : {}),
    }),
    remove: async (t, r) => helix('DELETE', 'channel_points/custom_rewards', { broadcaster_id: await twRoom(t), id: r.id }),
    create: async (t, f) => helix('POST', 'channel_points/custom_rewards', { broadcaster_id: await twRoom(t) }, {
      title: f.title.slice(0, 45), cost: f.cost, prompt: f.prompt || undefined,
      is_user_input_required: f.input, ...(f.color ? { background_color: f.color } : {}),
    }),
    canPause: true,
  },
  kick: {
    async list() {
      const [rw, rd] = await Promise.all([kickApi('GET', 'channels/rewards'), kickApi('GET', 'channels/rewards/redemptions?status=pending')]);
      const manageIds = new Set();
      const pending = [];
      for (const g of rd.data || []) {
        if (g.reward && g.reward.can_manage) manageIds.add(g.reward.id);
        for (const x of g.redemptions || []) {
          pending.push({ id: x.id, reward: { id: g.reward.id, title: g.reward.title, manage: !!g.reward.can_manage }, user: '#' + x.redeemer.user_id, input: x.user_input, at: x.redeemed_at });
        }
      }
      // Kick no dice en la lista de recompensas cuáles creó esta app: lo recordamos al crearlas
      const created = new Set(store.get('kickRewardsMine', []));
      const rewards = (rw.data || []).map((r) => ({
        id: r.id, title: r.title, cost: r.cost, enabled: r.is_enabled, paused: r.is_paused,
        input: r.is_user_input_required, prompt: r.description, color: r.background_color,
        manage: created.has(r.id) || manageIds.has(r.id),
      }));
      for (const x of pending) x.reward.manage = x.reward.manage || created.has(x.reward.id);
      return { rewards, pending: pending.filter((x) => x.reward.manage) };
    },
    async setRedemption(t, x, ok) {
      const j = await kickApi('POST', `channels/rewards/redemptions/${ok ? 'accept' : 'reject'}`, { ids: [x.id] });
      const fail = j.data && j.data[0];
      if (fail) throw new Error(`Kick lo rechazó (${fail.reason})`);
    },
    update: (t, r, changes) => kickApi('PATCH', 'channels/rewards/' + encodeURIComponent(r.id), {
      ...(changes.enabled !== undefined ? { is_enabled: changes.enabled } : {}),
      ...(changes.paused !== undefined ? { is_paused: changes.paused } : {}),
      ...(changes.cost !== undefined ? { cost: changes.cost } : {}),
    }),
    remove: (t, r) => kickApi('DELETE', 'channels/rewards/' + encodeURIComponent(r.id)),
    async create(t, f) {
      const j = await kickApi('POST', 'channels/rewards', {
        title: f.title.slice(0, 50), cost: f.cost, description: f.prompt || undefined,
        is_user_input_required: f.input, ...(f.color ? { background_color: f.color } : {}),
      });
      if (j.data && j.data.id) store.set('kickRewardsMine', [...store.get('kickRewardsMine', []), j.data.id]);
    },
    canPause: true,
  },
  starvios: {
    async list() {
      const me = svAuth.userId;
      const [rewards, reds] = await Promise.all([
        svGet(`channel_rewards?select=*&channel_id=eq.${me}&order=sort,cost`),
        svGet(`channel_reward_redemptions?select=id,reward_title,cost,input,status,created_at,user_id&channel_id=eq.${me}&order=created_at.desc&limit=30`),
      ]);
      const ids = [...new Set(reds.map((x) => x.user_id))];
      const names = {};
      if (ids.length) {
        for (const p of await svGet(`profiles?select=id,username,display_name&id=in.(${ids.join(',')})`)) names[p.id] = p.display_name || p.username;
      }
      return {
        rewards: rewards.map((r) => ({ id: r.id, title: r.title, cost: r.cost, enabled: r.enabled, input: (r.max_chars || 0) > 0, prompt: r.description, kind: r.kind, manage: true })),
        // Starvios no tiene cola de "pendientes": se listan los últimos y se pueden devolver
        pending: reds.filter((x) => !/refund/i.test(x.status || '')).map((x) => ({
          id: x.id, reward: { title: x.reward_title, manage: true }, user: names[x.user_id] || 'alguien', input: x.input, at: x.created_at, status: x.status,
        })),
      };
    },
    async setRedemption(t, x, ok) {
      if (ok) return; // en Starvios el canje ya se aplicó; solo existe "devolver"
      await svAuthed('POST', 'rpc/refund_channel_redemption', { _id: x.id });
    },
    async update(t, r, changes) {
      const body = {};
      if (changes.enabled !== undefined) body.enabled = changes.enabled;
      if (changes.cost !== undefined) body.cost = changes.cost;
      const rows = await svAuthed('PATCH', `channel_rewards?id=eq.${encodeURIComponent(r.id)}&select=id`, body, { Prefer: 'return=representation' });
      if (!rows || !rows.length) throw new Error('Starvios no aceptó el cambio');
    },
    async remove(t, r) {
      const rows = await svAuthed('DELETE', `channel_rewards?id=eq.${encodeURIComponent(r.id)}&select=id`, null, { Prefer: 'return=representation' });
      if (!rows || !rows.length) throw new Error('Starvios no borró la recompensa');
    },
    async create(t, f) {
      const rows = await svAuthed('POST', 'channel_rewards?select=id', {
        channel_id: svAuth.userId, title: f.title.slice(0, 50), kind: 'custom', description: f.prompt || null,
        cost: f.cost, enabled: true, max_chars: f.input ? 200 : 0, ...(f.color ? { color: f.color } : {}),
      }, { Prefer: 'return=representation' });
      if (!rows || !rows.length) throw new Error('Starvios no creó la recompensa');
    },
    canPause: false,
  },
};

/* ---------- 🎁 Canjear como espectador (solo Starvios) ----------
 * Twitch y Kick no tienen en su API una forma de canjear puntos.
 * Starvios sí: redeem_channel_reward, con tu saldo de puntos del canal.
 */
let rdChannel = null;

function redeemSection() {
  const sec = el('section', 'tl-live-card starvios rd-sec');
  sec.append(el('h3', null, '🎁 Canjear como espectador'));
  if (!svAuth) {
    sec.append(el('p', 'note', 'Inicia sesión con Starvios en ⚙ para canjear recompensas. Twitch y Kick no permiten canjear puntos desde otras apps.'));
    return sec;
  }
  sec.append(el('p', 'note', 'Solo Starvios lo permite; en Twitch y Kick hay que canjear desde su web o su app.'));
  const chans = [{ name: 'tu canal', id: svAuth.userId }];
  for (const name of channelsOf('starvios')) {
    const s = svStreams[name];
    if (s && s.channelId !== svAuth.userId) chans.push({ name, id: s.channelId });
  }
  if (!rdChannel || !chans.some((c) => c.id === rdChannel)) rdChannel = (chans[1] || chans[0]).id;
  const pick = choiceRow(chans.map((c) => [c.id, c.name]), rdChannel);
  const list = el('div', 'stack');
  list.id = 'rd-list';
  pick.addEventListener('click', () => { if (pick.value !== rdChannel) { rdChannel = pick.value; loadRedeem(); } });
  sec.append(pick, list);
  setTimeout(loadRedeem);
  return sec;
}

async function loadRedeem() {
  const list = $('#rd-list');
  if (!list) return;
  const ch = rdChannel;
  list.replaceChildren(el('p', 'note', 'Cargando…'));
  try {
    const [status, rewards, state] = await Promise.all([
      svAuthed('POST', 'rpc/channel_points_status', { _channel: ch }),
      svGet(`channel_rewards?select=*&enabled=eq.true&channel_id=eq.${ch}&order=sort,cost`),
      svAuthed('POST', 'rpc/channel_rewards_state', { _channel: ch }),
    ]);
    if (ch !== rdChannel || !document.body.contains(list)) return;
    const st = status || {};
    const byId = new Map((state || []).map((x) => [x.id, x]));
    const points = Number(st.points || 0);
    const rows = [el('p', 'rd-points', `Tus puntos: ${points.toLocaleString('es')}` + (st.is_live === false ? ' · el canal no está en directo' : ''))];
    if (!rewards.length) rows.push(el('p', 'note', 'Este canal no tiene recompensas activas.'));
    for (const r of rewards) {
      const why = redeemBlock(r, byId.get(r.id), st, points);
      const row = el('div', 'rw-row' + (why ? ' off' : ''));
      const info = el('div', 'rw-info');
      info.append(el('strong', null, r.title), el('span', 'rw-cost', ` · ${Number(r.cost).toLocaleString('es')} pts`));
      if (r.description) info.append(el('div', 'note', r.description));
      const b = rwButton(why || '🎁 Canjear', 'choice small' + (why ? '' : ' ok'), () => redeem(r));
      b.disabled = !!why;
      row.append(info, b);
      rows.push(row);
    }
    list.replaceChildren(...rows);
  } catch (e) {
    if (document.body.contains(list)) list.replaceChildren(el('p', 'st-card-error', '⚠ ' + e.message));
  }
}

// Mismas reglas que la web de Starvios para saber si se puede canjear ahora
function redeemBlock(r, s, st, points) {
  if (st.is_live === false) return 'Solo en directo';
  if (r.subs_only && !st.is_subscriber) return 'Solo subs';
  if (s && s.ready_at) {
    const left = (Date.parse(s.ready_at) - Date.now()) / 1000;
    if (left > 0) return `En ${fmtClock(left)}`;
  }
  if (r.max_per_stream != null && ((s && s.stream_used) || 0) >= r.max_per_stream) return 'Agotada';
  if (r.max_per_user_per_stream != null && ((s && s.mine_stream) || 0) >= r.max_per_user_per_stream) return 'Límite del directo';
  if (r.max_per_user_total != null && ((s && s.mine_total) || 0) >= r.max_per_user_total) return 'Límite alcanzado';
  if (points < r.cost) return 'Faltan puntos';
  return null;
}

async function redeem(r) {
  let input = null;
  if ((r.max_chars || 0) > 0) {
    input = prompt(`${r.title}\n${r.description || 'Escribe tu mensaje'} (máx. ${r.max_chars})`, '');
    if (input === null) return;
    input = input.trim().slice(0, r.max_chars) || null;
  } else if (!confirm(`¿Canjear "${r.title}" por ${Number(r.cost).toLocaleString('es')} puntos?`)) {
    return;
  }
  try {
    await svAuthed('POST', 'rpc/redeem_channel_reward', { _reward: r.id, _input: input });
    toast(`¡Canjeado: ${r.title}!`);
  } catch (e) {
    toast(e.message, true);
  }
  loadRedeem();
}

// Dibuja (o actualiza) una sección por canal, sin tocar el formulario de "Nueva recompensa"
async function loadRewards() {
  const box = $('#tl-rw');
  if (!box) return;
  const targets = chosen('rewards');
  if (!targets.length) { box.replaceChildren(el('p', 'note', 'Marca tu canal arriba para ver sus recompensas.')); return; }
  for (const t of targets) {
    let sec = box.querySelector(`.rw-sec[data-id="${CSS.escape(t.id)}"]`);
    if (!sec) {
      sec = el('section', `tl-live-card ${t.p} rw-sec`);
      sec.dataset.id = t.id;
      const head = el('div', 'st-card-head');
      head.append(el('span', `badge-platform ${t.p}`, PLATFORM_NAMES[t.p]), el('span', 'st-card-name', t.ch));
      const data = el('div', 'stack rw-data');
      data.append(el('p', 'note', 'Cargando…'));
      sec.append(head, data, newRewardForm(t));
      box.append(sec);
    }
    const data = sec.querySelector('.rw-data');
    try {
      const { rewards, pending } = await RW[t.p].list(t);
      if (!document.body.contains(data)) return;
      data.replaceChildren(pendingList(t, pending), rewardList(t, rewards));
    } catch (e) {
      if (document.body.contains(data)) data.replaceChildren(el('p', 'st-card-error', '⚠ ' + e.message));
    }
  }
  for (const s of box.querySelectorAll('.rw-sec')) if (!targets.some((t) => t.id === s.dataset.id)) s.remove();
  for (const n of box.querySelectorAll(':scope > .note')) n.remove();
}

function pendingList(t, pending) {
  const wrap = el('div', 'stack');
  wrap.append(el('h4', null, t.p === 'starvios' ? `Canjes recientes (${pending.length})` : `Canjes pendientes (${pending.length})`));
  if (!pending.length) { wrap.append(el('p', 'note', 'No hay canjes por revisar.')); return wrap; }
  for (const x of pending) {
    const row = el('div', 'rw-row');
    const info = el('div', 'rw-info');
    info.append(el('strong', null, x.user), el('span', null, ` canjeó "${x.reward.title}"`));
    if (x.input) info.append(el('div', 'rw-input', '💬 ' + x.input));
    info.append(el('div', 'note', fmtTime(new Date(x.at)) + (x.status ? ` · ${x.status}` : '')));
    const acts = el('div', 'rw-acts');
    if (t.p !== 'starvios') acts.append(rwButton('✓ Completar', 'choice small ok', () => redemption(t, x, true)));
    acts.append(rwButton('↩ Devolver puntos', 'choice small', () => {
      if (confirm(`¿Devolver los puntos a ${x.user} por "${x.reward.title}"?`)) redemption(t, x, false);
    }));
    row.append(info, acts);
    wrap.append(row);
  }
  return wrap;
}

function rewardList(t, rewards) {
  const wrap = el('div', 'stack');
  wrap.append(el('h4', null, `Recompensas (${rewards.length})`));
  if (!rewards.length) { wrap.append(el('p', 'note', 'Este canal no tiene recompensas.')); return wrap; }
  const api = RW[t.p];
  for (const r of rewards) {
    const row = el('div', 'rw-row' + (r.enabled ? '' : ' off'));
    const info = el('div', 'rw-info');
    const title = el('strong', null, r.title);
    if (r.color) title.style.borderLeft = `4px solid ${r.color}`;
    info.append(title, el('span', 'rw-cost', ` · ${Number(r.cost).toLocaleString('es')} pts`));
    const tags = el('div', 'st-card-tags');
    tags.append(el('span', 'tag' + (r.enabled ? ' on' : ''), r.enabled ? 'Activa' : 'Desactivada'));
    if (r.paused) tags.append(el('span', 'tag', '⏸ Pausada'));
    if (r.input) tags.append(el('span', 'tag', '💬 Pide texto'));
    if (r.manage && t.p !== 'starvios') tags.append(el('span', 'tag on', 'Chat M'));
    info.append(tags);
    const acts = el('div', 'rw-acts');
    if (r.manage) {
      acts.append(rwButton(r.enabled ? 'Desactivar' : 'Activar', 'choice small', () => rewardChange(t, r, { enabled: !r.enabled })));
      if (api.canPause) acts.append(rwButton(r.paused ? '▶ Reanudar' : '⏸ Pausar', 'choice small', () => rewardChange(t, r, { paused: !r.paused })));
      acts.append(rwButton('✎ Costo', 'choice small', () => {
        const v = Math.floor(Number(prompt(`Nuevo costo para "${r.title}"`, r.cost)));
        if (v >= 1) rewardChange(t, r, { cost: v });
      }));
      acts.append(rwButton('🗑', 'choice small danger', () => {
        if (confirm(`¿Borrar la recompensa "${r.title}"?`)) rwDo(t, 'Recompensa borrada', () => api.remove(t, r));
      }));
    } else {
      acts.append(rwButton('⧉ Duplicar en Chat M', 'choice small', () => {
        const title = prompt('Nombre de la copia (debe ser distinto al original):', r.title + ' ★');
        if (title) rwDo(t, 'Copia creada: desactiva la original en la web de ' + PLATFORM_NAMES[t.p],
          () => api.create(t, { title, cost: r.cost, prompt: r.prompt, input: r.input, color: r.color }));
      }));
    }
    row.append(info, acts);
    wrap.append(row);
  }
  return wrap;
}

function newRewardForm(t) {
  const d = el('details', 'rw-new');
  d.append(el('summary', null, '＋ Nueva recompensa'));
  const title = textInput(45, 'Ej.: Elige la próxima rutina');
  const cost = el('input');
  cost.type = 'number';
  cost.min = '1';
  cost.value = '500';
  cost.inputMode = 'numeric';
  const desc = textInput(200, 'Texto que verá quien la canjee (opcional)');
  const inputLbl = el('label', 'check');
  const input = el('input');
  input.type = 'checkbox';
  inputLbl.append(input, ' Pedir un texto al canjear');
  const go = bigButton('Crear recompensa', async () => {
    const f = { title: title.value.trim(), cost: Math.floor(Number(cost.value)), prompt: desc.value.trim(), input: input.checked };
    if (!f.title || !(f.cost >= 1)) { toast('Escribe el nombre y un costo de al menos 1.', true); return; }
    if (await rwDo(t, 'Recompensa creada', () => RW[t.p].create(t, f))) { title.value = ''; desc.value = ''; d.open = false; }
  });
  d.append(field('Nombre', title, true), field('Costo en puntos', cost), field('Descripción', desc, true), inputLbl, go);
  return d;
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
    return false;
  }
}
const redemption = (t, x, ok) => rwDo(t, ok ? 'Canje completado' : 'Puntos devueltos', () => RW[t.p].setRedemption(t, x, ok));
const rewardChange = (t, r, changes) => rwDo(t, 'Recompensa actualizada', () => RW[t.p].update(t, r, changes));

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
