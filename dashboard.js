'use strict';

/* =========================================================
   📊 Panel en vivo
   - Resumen: todos tus canales de un vistazo
   - Por canal: tarjetas con lo que su plataforma permita
     Twitch: en vivo, seguidores, subs, metas, Hype Train,
             ranking de bits, campaña benéfica
     Kick: en vivo, ranking de KICKs, subs regaladas, metas, encuesta activa
     Starvios: en vivo, metas (editables), ranking del chat,
               actividad, lluvia de estrellas, estadísticas del mes
   Se actualiza solo cada 30 s mientras está abierto.
   ========================================================= */
const DASH = { sel: 'all', timer: null, seq: 0, bitsPeriod: 'week', svPeriod: null, kickPeriod: 'week', month: null };
const nf = (n) => Number(n || 0).toLocaleString('es');
// Kick manda "2026-10-19 01:02:03" (UTC, sin zona horaria): se marca como UTC antes de leerlo
const parseTime = (s) => (/^\d{4}-\d\d-\d\d \d\d:\d\d(:\d\d)?$/.test(s) ? Date.parse(s.replace(' ', 'T') + 'Z') : Date.parse(s));
const uptime = (iso) => (iso ? fmtClock((Date.now() - parseTime(iso)) / 1000) : '—');

function statBox(label, value, cls) {
  const s = el('div', 'stat' + (cls ? ' ' + cls : ''));
  s.append(el('b', null, value), el('span', null, label));
  return s;
}
function dashCard(title, ...children) {
  const c = el('div', 'card');
  const h = el('h3');
  h.append(title);
  c.append(h, ...children);
  return c;
}
const emptyNote = (t) => el('p', 'empty', t);

/* ---------- Dibujo ---------- */
function renderDash() {
  const page = $('#page-panel');
  const restore = keepScroll(page);
  const body = el('div', 'st-body');
  page.replaceChildren(pageHeader('📊', 'Panel en vivo', 'Lo que pasa en tus canales, actualizado cada 30 s'), body);
  const targets = modTargets();
  if (!targets.length) { body.append(emptyNote('Inicia sesión en ⚙ Ajustes para ver tus estadísticas.')); return; }
  if (DASH.sel !== 'all' && !targets.some((t) => t.id === DASH.sel)) DASH.sel = 'all';

  const pills = el('div', 'pill-tabs');
  const pill = (id, label, p) => {
    const b = el('button');
    b.type = 'button';
    b.setAttribute('aria-selected', String(DASH.sel === id));
    if (p) b.append(el('span', 'plat-dot ' + p), ' ');
    b.append(label);
    b.style.display = 'inline-flex';
    b.style.alignItems = 'center';
    b.style.gap = '6px';
    b.addEventListener('click', () => { DASH.sel = id; renderDash(); });
    pills.append(b);
  };
  pill('all', '✨ Resumen');
  for (const t of targets) pill(t.id, t.ch, t.p);
  const content = el('div', 'stack');
  content.id = 'dash-content';
  body.append(pills, content);
  restore();
  loadDash(content, targets);
}

async function loadDash(box, targets) {
  const seq = ++DASH.seq;
  if (!box.childElementCount) box.append(emptyNote('Cargando…'));
  let nodes;
  if (DASH.sel === 'all') {
    nodes = [el('div', 'grid-cards')];
    const cards = await Promise.all(targets.map(summaryCard));
    nodes[0].append(...cards);
  } else {
    const t = targets.find((x) => x.id === DASH.sel);
    const builders = DASH_CARDS[t.p];
    const cards = await Promise.all(builders.map((b) => b(t).catch((e) => dashCard('⚠ Error', el('p', 'st-card-error', e.message)))));
    nodes = [el('div', 'grid-cards dash-grid')];
    nodes[0].append(...cards.filter(Boolean));
  }
  if (seq === DASH.seq && document.body.contains(box)) box.replaceChildren(...nodes);
}

function startDashTimer() {
  stopDashTimer();
  DASH.timer = setInterval(() => {
    const box = $('#dash-content');
    // No interrumpe si se está escribiendo en algún campo del panel
    if (box && !box.contains(document.activeElement)) loadDash(box, modTargets());
  }, 30000);
}
function stopDashTimer() { clearInterval(DASH.timer); DASH.timer = null; }

/* ---------- Resumen por canal ---------- */
async function summaryCard(t) {
  const c = el('div', 'card sum-card ' + t.p);
  const h = el('h3');
  h.append(el('span', 'plat-dot ' + t.p), el('span', 'grow', `${PLATFORM_NAMES[t.p]} · ${t.ch}`));
  c.append(h);
  try {
    const s = await LIVE_SUMMARY[t.p](t);
    h.append(el('span', 'live-pill ' + (s.live ? 'on' : 'off'), s.live ? '● EN VIVO' : 'Fuera de directo'));
    const g = el('div', 'stat-grid');
    if (s.live) g.append(statBox('espectadores', nf(s.viewers), 'live'), statBox('en directo', uptime(s.started)));
    if (s.followers != null) g.append(statBox('seguidores', nf(s.followers)));
    if (s.subs != null) g.append(statBox('subs', nf(s.subs)));
    c.append(g);
    if (s.title) c.append(el('p', 'sub', s.title));
    if (s.category) c.append(el('p', 'sub', '🎮 ' + s.category));
    c.classList.add('clickable');
    c.addEventListener('click', () => { DASH.sel = t.id; renderDash(); });
  } catch (e) {
    c.append(el('p', 'st-card-error', '⚠ ' + e.message));
  }
  return c;
}

const LIVE_SUMMARY = {
  async twitch(t) {
    const room = await twRoom(t);
    const [st, fol] = await Promise.all([
      helix('GET', 'streams', { user_id: room }),
      helix('GET', 'channels/followers', { broadcaster_id: room, first: 1 }).catch(() => null),
    ]);
    const s = st.data && st.data[0];
    let subs = null;
    if (t.own) { try { subs = (await helix('GET', 'subscriptions', { broadcaster_id: room, first: 1 })).total; } catch { /* sin permiso */ } }
    return { live: !!s, viewers: s && s.viewer_count, started: s && s.started_at, title: s && s.title, category: s && s.game_name, followers: fol ? fol.total : null, subs };
  },
  async kick(t) {
    const j = await kickPublic(t.ch);
    const ls = j.livestream;
    return {
      live: !!ls, viewers: ls && ls.viewer_count, started: ls && (ls.start_time || ls.created_at),
      title: ls && ls.session_title, category: ls && ls.categories && ls.categories[0] && ls.categories[0].name,
      followers: j.followers_count != null ? Number(j.followers_count) : null,
    };
  },
  async starvios(t) {
    const s = await svTarget(t);
    const [[row], counts, fol, subs] = await Promise.all([
      svGet(`live_streams?select=status,started_at,title,category&id=eq.${s.id}`),
      svAuthed('POST', 'rpc/live_viewer_counts', { _stream_ids: [s.id] }),
      svAuthed('POST', 'rpc/discovery_follower_counts', { _channels: [s.channelId] }),
      svAuthed('POST', 'rpc/channel_subscriber_count', { _channel_id: s.channelId }),
    ]);
    const live = row && row.status === 'live';
    return {
      live, viewers: ((counts || [])[0] || {}).viewers || 0, started: row && row.started_at,
      title: row && row.title, category: row && row.category,
      followers: Number(((fol || [])[0] || {}).followers || 0), subs: Number(subs || 0),
    };
  },
};

/* ---------- Tarjetas por plataforma ---------- */
const periodPicker = (options, value, onChange) => {
  const row = el('div', 'choice-row');
  for (const [v, label] of options) {
    const b = el('button', 'choice small', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(v === value));
    b.addEventListener('click', (e) => { e.stopPropagation(); onChange(v); });
    row.append(b);
  }
  return row;
};
const rankList = (rows, valueText) => {
  const list = el('div', 'list');
  if (!rows.length) return emptyNote('Sin datos todavía.');
  rows.forEach((r, i) => {
    const li = el('div', 'li');
    li.append(el('span', 'rank', ['🥇', '🥈', '🥉'][i] || String(i + 1)), el('span', 'grow', r.name), el('strong', null, valueText(r)));
    list.append(li);
  });
  return list;
};
const ownOnly = (title, why) => dashCard(title, emptyNote(why || 'Solo disponible en tu propio canal.'));
const refreshDash = () => { const box = $('#dash-content'); if (box) loadDash(box, modTargets()); };

const DASH_CARDS = {
  twitch: [
    async (t) => {
      const s = await LIVE_SUMMARY.twitch(t);
      const g = el('div', 'stat-grid');
      g.append(statBox('estado', s.live ? '● En vivo' : 'Apagado', s.live ? 'live' : ''));
      if (s.live) g.append(statBox('espectadores', nf(s.viewers), 'live'), statBox('en directo', uptime(s.started)));
      if (s.followers != null) g.append(statBox('seguidores', nf(s.followers)));
      if (s.subs != null) g.append(statBox('subs', nf(s.subs)));
      try {
        const ch = await helix('GET', 'chat/chatters', { broadcaster_id: await twRoom(t), moderator_id: auth.userId, first: 1 });
        g.append(statBox('en el chat', nf(ch.total)));
      } catch { /* no eres mod */ }
      const card = dashCard('📡 En vivo', g);
      if (s.title) card.append(el('p', 'sub', s.title));
      if (s.category) card.append(el('p', 'sub', '🎮 ' + s.category));
      return card;
    },
    async (t) => {
      const j = await helix('GET', 'channels/followers', { broadcaster_id: await twRoom(t), first: 10 });
      const list = el('div', 'list');
      for (const f of j.data || []) {
        const li = el('div', 'li clickable');
        li.append(el('span', 'grow', f.user_name), el('span', 'sub', ago(f.followed_at)));
        li.addEventListener('click', () => openUserCard({ platform: 'twitch', channel: t.ch, userId: f.user_id, user: f.user_name }));
        list.append(li);
      }
      return dashCard(`❤️ Últimos seguidores (${nf(j.total)})`, (j.data || []).length ? list : emptyNote('Sin seguidores todavía.'));
    },
    async (t) => {
      if (!t.own) return ownOnly('⭐ Suscriptores');
      const j = await helix('GET', 'subscriptions', { broadcaster_id: await twRoom(t), first: 100 });
      const g = el('div', 'stat-grid');
      g.append(statBox('subs', nf(j.total)), statBox('puntos de sub', nf(j.points)));
      const subs = (j.data || []).filter((s) => s.user_id !== auth.userId);
      const tiers = { 1000: 'N1', 2000: 'N2', 3000: 'N3' };
      const list = el('div', 'list scroll');
      for (const s of subs.slice(0, 100)) {
        const li = el('div', 'li');
        li.append(el('span', 'grow', s.user_name), el('span', 'tag', tiers[s.tier] || s.tier), el('span', 'sub', s.is_gift ? `🎁 de ${s.gifter_name}` : ''));
        list.append(li);
      }
      return dashCard('⭐ Suscriptores', g, list);
    },
    async (t) => {
      if (!t.own) return ownOnly('🎯 Metas');
      const j = await helix('GET', 'goals', { broadcaster_id: await twRoom(t) });
      const types = { follower: 'Seguidores', subscription: 'Puntos de sub', subscription_count: 'Subs', new_subscription: 'Puntos de subs nuevas', new_subscription_count: 'Subs nuevas' };
      const box = el('div', 'stack');
      for (const g of j.data || []) box.append(goalRow(g.description || types[g.type] || g.type, g.current_amount, g.target_amount));
      return dashCard('🎯 Metas', (j.data || []).length ? box : emptyNote('No hay metas activas. Créalas en el panel de creador de Twitch.'));
    },
    async (t) => {
      if (!t.own) return ownOnly('🚂 Hype Train');
      const j = await helix('GET', 'hypetrain/status', { broadcaster_id: await twRoom(t) });
      const d = (j.data && j.data[0]) || {};
      const cur = d.current;
      if (!cur) {
        const hi = d.all_time_high;
        return dashCard('🚂 Hype Train', emptyNote('No hay un Hype Train activo.' + (hi ? ` Récord: nivel ${hi.level} (${nf(hi.total)} puntos).` : '')));
      }
      const left = (Date.parse(cur.expires_at) - Date.now()) / 1000;
      const top = (cur.top_contributions || []).map((c) => ({ name: c.user_name, total: c.total, type: c.type }));
      return dashCard(`🚂 Hype Train · nivel ${cur.level}`, goalRow(`Termina en ${fmtClock(left)}`, cur.progress, cur.goal),
        el('p', 'sub', `Total: ${nf(cur.total)} puntos`), rankList(top, (r) => `${nf(r.total)} (${r.type === 'bits' ? 'bits' : r.type === 'subscription' ? 'subs' : 'otros'})`));
    },
    async (t) => {
      if (!t.own) return ownOnly('💎 Ranking de bits');
      // Twitch a veces exige started_at (una fecha dentro del periodo, sin milisegundos);
      // si aun así lo rechaza, muestra el ranking de siempre
      const now = new Date(Date.now() - 60000).toISOString().replace(/\.\d+Z$/, 'Z');
      const q = { count: 10, period: DASH.bitsPeriod };
      let j;
      try { j = await helix('GET', 'bits/leaderboard', DASH.bitsPeriod === 'all' ? q : { ...q, started_at: now }); } catch (e) {
        if (!/started_at/i.test(e.message)) throw e;
        try { j = await helix('GET', 'bits/leaderboard', q); } catch { DASH.bitsPeriod = 'all'; j = await helix('GET', 'bits/leaderboard', { count: 10, period: 'all' }); }
      }
      return dashCard('💎 Ranking de bits',
        periodPicker([['day', 'Hoy'], ['week', 'Semana'], ['month', 'Mes'], ['year', 'Año'], ['all', 'Siempre']], DASH.bitsPeriod, (v) => { DASH.bitsPeriod = v; refreshDash(); }),
        rankList((j.data || []).map((r) => ({ name: r.user_name, score: r.score })), (r) => nf(r.score)));
    },
    async (t) => {
      if (!t.own) return null;
      const j = await helix('GET', 'charity/campaigns', { broadcaster_id: await twRoom(t) });
      const c = j.data && j.data[0];
      if (!c) return dashCard('💝 Campaña benéfica', emptyNote('No hay una campaña activa.'));
      const money = (a) => (a ? (a.value / 10 ** a.decimal_places).toLocaleString('es', { style: 'currency', currency: a.currency }) : '—');
      const d = await helix('GET', 'charity/donations', { broadcaster_id: await twRoom(t), first: 10 });
      return dashCard(`💝 ${c.charity_name}`, goalRow(`${money(c.current_amount)} de ${money(c.target_amount)}`, c.current_amount.value, c.target_amount.value),
        rankList((d.data || []).map((x) => ({ name: x.user_name, amount: x.amount })), (r) => money(r.amount)));
    },
  ],

  kick: [
    async (t) => {
      const s = await LIVE_SUMMARY.kick(t);
      const g = el('div', 'stat-grid');
      g.append(statBox('estado', s.live ? '● En vivo' : 'Apagado', s.live ? 'live' : ''));
      if (s.live) g.append(statBox('espectadores', nf(s.viewers), 'live'), statBox('en directo', uptime(s.started)));
      if (s.followers != null) g.append(statBox('seguidores', nf(s.followers)));
      const card = dashCard('📡 En vivo', g);
      if (s.title) card.append(el('p', 'sub', s.title));
      if (s.category) card.append(el('p', 'sub', '🎮 ' + s.category));
      return card;
    },
    async (t) => {
      if (!t.own) return ownOnly('🟩 Ranking de KICKs');
      const j = await kickApi('GET', 'kicks/leaderboard?top=10');
      const d = j.data || {};
      const rows = (d[{ week: 'week', month: 'month', lifetime: 'lifetime' }[DASH.kickPeriod]] || []).map((r) => ({ name: r.username, n: r.gifted_amount }));
      return dashCard('🟩 Ranking de KICKs',
        periodPicker([['week', 'Semana'], ['month', 'Mes'], ['lifetime', 'Siempre']], DASH.kickPeriod, (v) => { DASH.kickPeriod = v; refreshDash(); }),
        rankList(rows, (r) => nf(r.n)));
    },
    async (t) => {
      const j = await kickPublic(t.ch, '/leaderboards');
      const key = { week: 'gifts_week', month: 'gifts_month', lifetime: 'gifts' }[DASH.kickPeriod];
      return dashCard('🎁 Subs regaladas',
        periodPicker([['week', 'Semana'], ['month', 'Mes'], ['lifetime', 'Siempre']], DASH.kickPeriod, (v) => { DASH.kickPeriod = v; refreshDash(); }),
        rankList((j[key] || []).slice(0, 10).map((r) => ({ name: r.username, n: r.quantity })), (r) => nf(r.n)));
    },
    async (t) => {
      const goals = await kickPublic(t.ch, '/goals');
      const list = Array.isArray(goals) ? goals : (goals && goals.data) || [];
      const box = el('div', 'stack');
      for (const g of list) box.append(goalRow(g.title || g.type || 'Meta', g.current_value ?? g.current ?? g.progress ?? 0, g.target_value ?? g.target ?? 0));
      return dashCard('🎯 Metas', list.length ? box : emptyNote('No hay metas activas.'));
    },
    async (t) => {
      const j = await kickPublic(t.ch, '/polls');
      const poll = j && j.data && (j.data.poll || j.data);
      if (!poll || !poll.options) return dashCard('📊 Encuesta de Kick', emptyNote('No hay una encuesta activa. (Kick no permite crearlas por API; solo verlas.)'));
      const total = poll.options.reduce((a, o) => a + (o.votes || 0), 0);
      const box = el('div', 'stack');
      for (const o of poll.options) {
        const pct = total ? Math.round(((o.votes || 0) / total) * 100) : 0;
        const bar = el('div', 'bar');
        bar.style.setProperty('--w', pct + '%');
        bar.append(el('span', 'bar-label', o.label || o.title), el('span', 'bar-val', `${pct}% · ${nf(o.votes)}`));
        box.append(bar);
      }
      return dashCard('📊 ' + (poll.title || 'Encuesta de Kick'), box);
    },
  ],

  starvios: [
    async (t) => {
      const s = await LIVE_SUMMARY.starvios(t);
      const g = el('div', 'stat-grid');
      g.append(statBox('estado', s.live ? '● En vivo' : 'Apagado', s.live ? 'live' : ''));
      if (s.live) g.append(statBox('espectadores', nf(s.viewers), 'live'), statBox('en directo', uptime(s.started)));
      g.append(statBox('seguidores', nf(s.followers)), statBox('miembros', nf(s.subs)));
      const card = dashCard('📡 En vivo', g);
      if (s.title) card.append(el('p', 'sub', s.title));
      if (s.category) card.append(el('p', 'sub', '🎮 ' + s.category));
      return card;
    },
    async (t) => {
      const s = await svTarget(t);
      const goals = (await svAuthed('POST', 'rpc/channel_goal_progress', { _channel: s.channelId })) || [];
      const kinds = { followers: 'Seguidores', subs: 'Suscripciones', starvies: 'Starvies' };
      const periods = { stream: 'en este directo', month: 'este mes', all: 'en total' };
      const box = el('div', 'stack');
      for (const g of goals) {
        const row = goalRow(`${g.title || 'Meta de ' + kinds[g.kind].toLowerCase()} · ${periods[g.period] || ''}`, g.current, g.target);
        if (t.own) {
          const acts = el('div', 'row');
          acts.append(modBtn('✎', '', () => goalEditor(s, g)), modBtn('🗑', 'danger', async () => {
            if (!confirm('¿Borrar esta meta?')) return;
            await svAuthed('POST', 'rpc/delete_channel_goal', { _id: g.id });
            refreshDash();
          }));
          row.append(acts);
        }
        box.append(row);
      }
      if (!goals.length) box.append(emptyNote('No hay metas.'));
      const card = dashCard('🎯 Metas', box);
      if (t.own) card.append(modBtn('＋ Nueva meta', 'accent', () => goalEditor(s, null)));
      return card;
    },
    async (t) => {
      const s = await svTarget(t);
      const lb = (await svAuthed('POST', 'rpc/channel_leaderboard', { _channel: s.channelId, _period: null })) || {};
      const periods = [['daily', 'Diario'], ['weekly', 'Semanal'], ['monthly', 'Mensual'], ['lifetime', 'Siempre']];
      const card = dashCard('🏅 Ranking del chat');
      if (t.own) {
        card.append(el('p', 'sub', 'Periodo que se muestra en tu chat de Starvios (cambiarlo reinicia el ranking):'),
          periodPicker(periods, lb.period, async (v) => {
            if (!confirm('¿Cambiar el periodo? El ranking del chat se reinicia.')) return;
            await svAuthed('POST', 'rpc/set_leaderboard_period', { _period: v });
            refreshDash();
          }));
      } else {
        card.append(el('p', 'sub', 'Periodo: ' + ((periods.find((p) => p[0] === lb.period) || [])[1] || lb.period || '?')));
      }
      card.append(el('h4', null, '⭐ Starvies'), rankList((lb.starvies || []).slice(0, 10).map((r) => ({ name: r.display_name || r.username, n: r.total })), (r) => nf(r.n)));
      if ((lb.subs || []).length) card.append(el('h4', null, '🎁 Subs'), rankList(lb.subs.slice(0, 10).map((r) => ({ name: r.display_name || r.username, n: r.total || r.count })), (r) => nf(r.n)));
      return card;
    },
    async (t) => {
      if (!t.own) return null;
      const rows = (await svAuthed('POST', 'rpc/creator_activity_feed', { _hours: 48 })) || [];
      const icons = { sub: '⭐', gift_sub: '🎁', starfall: '🌠', galaxia: '🌌', follow: '❤️', donation: '💰', raid: '🚀' };
      const list = el('div', 'list scroll');
      for (const r of rows.slice(0, 60)) {
        const li = el('div', 'li');
        li.append(el('span', null, icons[r.type] || '✨'), el('span', 'grow', r.label || r.type), el('span', 'sub', ago(r.at)));
        list.append(li);
      }
      return dashCard('📰 Actividad (48 h)', rows.length ? list : emptyNote('Sin actividad reciente.'));
    },
    async (t) => {
      const s = await svTarget(t);
      const sf = await svAuthed('POST', 'rpc/starfall_status', { _stream: s.id });
      if (!sf || !sf.active) return dashCard('🌠 Lluvia de estrellas', emptyNote('No hay una lluvia de estrellas activa.'));
      const left = (Date.parse(sf.expires_at) - Date.now()) / 1000;
      return dashCard(`🌠 Lluvia de estrellas · nivel ${sf.level}`, el('p', 'sub', `${nf(sf.points)} puntos · termina en ${fmtClock(left)}`),
        rankList((sf.contributors || []).slice(0, 10).map((c) => ({ name: c.display_name || c.username, n: c.points })), (r) => nf(r.n)));
    },
    async (t) => {
      if (!t.own) return null;
      const months = (await svAuthed('POST', 'rpc/creator_months', {})) || [];
      if (!months.length) return dashCard('📈 Estadísticas del mes', emptyNote('Todavía no hay estadísticas.'));
      if (!DASH.month || !months.includes(DASH.month)) DASH.month = months[0];
      const stats = (await svAuthed('POST', 'rpc/creator_month_stats', { _month: DASH.month })) || {};
      const sel = el('select');
      for (const m of months) sel.append(new Option(m, m));
      sel.value = DASH.month;
      sel.addEventListener('change', () => { DASH.month = sel.value; refreshDash(); });
      const g = el('div', 'stat-grid');
      const labels = {
        minutes_streamed: 'minutos en directo', hours_streamed: 'horas en directo', streams: 'directos', avg_viewers: 'espectadores promedio',
        peak_viewers: 'pico de espectadores', new_followers: 'seguidores nuevos', followers: 'seguidores', new_members: 'miembros nuevos',
        starvies: 'starvies', messages: 'mensajes', unique_chatters: 'personas en el chat', watch_minutes: 'minutos vistos',
      };
      for (const [k, v] of Object.entries(stats)) {
        if (typeof v === 'number') g.append(statBox(labels[k] || k.replace(/_/g, ' '), nf(Math.round(v * 10) / 10)));
      }
      return dashCard('📈 Estadísticas del mes', sel, g.childElementCount ? g : emptyNote('Sin datos para este mes.'));
    },
  ],
};

// Barra de progreso con texto
function goalRow(label, current, target) {
  const box = el('div', 'goal');
  const pct = target ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const head = el('div', 'goal-head');
  head.append(el('span', 'grow', label), el('strong', null, `${nf(current)} / ${nf(target)}`));
  const bar = el('div', 'progress');
  const fill = el('i');
  fill.style.setProperty('--w', pct + '%');
  bar.append(fill);
  box.append(head, bar);
  return box;
}

// Crear o editar una meta de Starvios
function goalEditor(s, g) {
  const dlg = $('#user-card');
  const sheet = el('div', 'sheet uc');
  const kind = el('select');
  for (const [v, l] of [['followers', 'Seguidores'], ['subs', 'Suscripciones'], ['starvies', 'Starvies']]) kind.append(new Option(l, v));
  const period = el('select');
  for (const [v, l] of [['stream', 'En este directo'], ['month', 'Este mes'], ['all', 'En total']]) period.append(new Option(l, v));
  const title = textInput(60, 'Ej.: ¡Llegar a 500!');
  const target = el('input');
  target.type = 'number';
  target.min = '1';
  if (g) { kind.value = g.kind; period.value = g.period; title.value = g.title || ''; target.value = g.target; } else { target.value = 100; period.value = 'all'; }
  const save = modBtn('Guardar meta', 'accent', async () => {
    await svAuthed('POST', 'rpc/set_channel_goal', { _id: g ? g.id : null, _kind: kind.value, _title: title.value.trim(), _target: Math.max(1, Number(target.value) || 1), _period: period.value });
    dlg.close();
    toast('Meta guardada');
    refreshDash();
  });
  const cancel = modBtn('Cancelar', '', () => dlg.close());
  const row = el('div', 'row end');
  row.append(cancel, save);
  sheet.append(el('h2', null, g ? '✎ Editar meta' : '＋ Nueva meta'), field('Tipo', kind), field('Periodo', period), field('Título (opcional)', title), field('Objetivo', target), row);
  dlg.replaceChildren(sheet);
  dlg.showModal();
}

// Actualiza el panel si llega un evento relevante de Twitch
onTwitchEvent((type) => {
  if (currentPage === 'panel' && /hype_train|goal|charity|stream\.(on|off)line/.test(type)) refreshDash();
});

PAGE_HOOKS.panel = { open() { renderDash(); startDashTimer(); }, close: stopDashTimer };
