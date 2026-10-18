'use strict';

/* =========================================================
   🛡 Moderación
   Un canal a la vez; pestañas según lo que permita su plataforma:
   - Pendientes: solicitudes de desbaneo (Twitch) y usuarios sospechosos
   - Baneados: lista y desbanear (Twitch, Starvios) / desbanear por nombre (Kick)
   - En el chat: quién está mirando o chateando (Twitch, Starvios)
   - Equipo: moderadores y VIPs (Twitch, Starvios)
   - Filtros: términos bloqueados y AutoMod (Twitch) / ajustes del chat (Starvios)
   - Registro: acciones de moderación en vivo (Twitch)
   Además: modo escudo (Twitch) y tarjeta de usuario.
   ========================================================= */
const MOD = {
  sel: null,           // id del canal elegido
  tab: 'pending',
  seq: 0,
  log: [],             // registro de acciones (todas las plataformas que lo den)
  suspicious: [],      // mensajes de usuarios sospechosos
  unbanCount: {},      // canal → solicitudes de desbaneo pendientes
  timer: null,
};

const modBtn = (text, cls, onClick) => {
  const b = el('button', 'btn ' + (cls || ''), text);
  b.type = 'button';
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    b.disabled = true;
    try { await onClick(); } catch (err) { toast(err.message, true); } finally { b.disabled = false; }
  });
  return b;
};
const ago = (iso) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
};
const untilText = (iso) => {
  if (!iso) return 'permanente';
  const s = (Date.parse(iso) - Date.now()) / 1000;
  if (s > 86400 * 365) return 'permanente';
  return s <= 0 ? 'terminó' : `termina en ${fmtClock(s)}`;
};

/* ---------- Canales que se pueden moderar ---------- */
function modTargets() {
  const list = [];
  if (auth) {
    const chans = channelsOf('twitch');
    if (!chans.includes(auth.login)) chans.unshift(auth.login);
    for (const ch of chans) list.push({ id: 'twitch:' + ch, p: 'twitch', ch, own: ch === auth.login, room: ch === auth.login ? auth.userId : twitchRooms[ch] });
  }
  if (kickAuth) {
    const chans = channelsOf('kick');
    const mine = (kickAuth.name || '').toLowerCase();
    if (mine && !chans.includes(mine)) chans.unshift(mine);
    for (const ch of chans) list.push({ id: 'kick:' + ch, p: 'kick', ch, own: ch === mine });
  }
  if (svAuth) {
    const sv = [];
    let ownListed = false;
    for (const name of channelsOf('starvios')) {
      const s = svStreams[name];
      const own = !!s && s.channelId === svAuth.userId;
      ownListed = ownListed || own;
      sv.push({ id: 'starvios:' + name, p: 'starvios', ch: name, name, own });
    }
    if (!ownListed) sv.unshift({ id: 'starvios:me', p: 'starvios', ch: 'tu canal', own: true });
    list.push(...sv);
  }
  return list;
}

const MOD_TABS = {
  twitch: [['pending', '📨 Pendientes'], ['bans', '⛔ Baneados'], ['chatters', '👥 En el chat'], ['team', '🛡 Equipo'], ['filters', '🚫 Filtros'], ['log', '📜 Registro']],
  kick: [['bans', '⛔ Desbanear']],
  starvios: [['bans', '⛔ Sancionados'], ['chatters', '👥 Mirando'], ['team', '🛡 Equipo'], ['filters', '⚙️ Ajustes del chat']],
};

/* ---------- Dibujo de la sección ---------- */
function renderMod() {
  const page = $('#page-mod');
  const body = el('div', 'st-body');
  page.replaceChildren(pageHeader('🛡', 'Moderación', 'Revisa y controla lo que pasa en tus canales'), body);
  const targets = modTargets();
  if (!targets.length) {
    body.append(el('p', 'empty', 'Inicia sesión en ⚙ Ajustes con Twitch, Kick o Starvios para moderar.'));
    return;
  }
  if (!targets.some((t) => t.id === MOD.sel)) MOD.sel = targets[0].id;
  const t = targets.find((x) => x.id === MOD.sel);
  const tabs = MOD_TABS[t.p];
  if (!tabs.some(([id]) => id === MOD.tab)) MOD.tab = tabs[0][0];

  // Canal
  const chanRow = el('div', 'pill-tabs');
  for (const x of targets) {
    const b = el('button');
    b.type = 'button';
    b.setAttribute('aria-selected', String(x.id === MOD.sel));
    b.append(el('span', 'plat-dot ' + x.p), ' ' + x.ch);
    b.style.display = 'inline-flex';
    b.style.alignItems = 'center';
    b.style.gap = '6px';
    b.addEventListener('click', () => { MOD.sel = x.id; renderMod(); });
    chanRow.append(b);
  }
  body.append(chanRow);

  // Modo escudo (Twitch)
  if (t.p === 'twitch') body.append(shieldCard(t));

  // Pestañas
  const tabRow = el('div', 'pill-tabs');
  for (const [id, label] of tabs) {
    const b = el('button', null, label);
    b.type = 'button';
    b.setAttribute('aria-selected', String(id === MOD.tab));
    b.addEventListener('click', () => { MOD.tab = id; renderMod(); });
    tabRow.append(b);
  }
  const content = el('div', 'stack');
  content.id = 'mod-content';
  body.append(tabRow, content);
  loadModTab(t, MOD.tab, content);
}

async function loadModTab(t, tab, box) {
  const seq = ++MOD.seq;
  box.replaceChildren(el('p', 'empty', 'Cargando…'));
  try {
    const nodes = await MOD_LOADERS[tab](t);
    if (seq === MOD.seq && document.body.contains(box)) box.replaceChildren(...nodes);
  } catch (e) {
    if (seq === MOD.seq && document.body.contains(box)) box.replaceChildren(el('p', 'st-card-error', '⚠ ' + e.message));
  }
}
const refreshMod = () => { if (currentPage === 'mod') renderMod(); };

/* ---------- Modo escudo ---------- */
function shieldCard(t) {
  const card = el('div', 'card shield-card');
  const head = el('h3');
  head.append('🛡 Modo escudo', el('span', 'grow'));
  const lbl = el('label', 'toggle');
  const sw = el('input');
  sw.type = 'checkbox';
  sw.disabled = true;
  lbl.append(sw);
  head.append(lbl);
  const sub = el('p', 'sub', 'Activa al instante tus ajustes de protección (para raids de odio o ataques).');
  card.append(head, sub);
  (async () => {
    try {
      const room = await twRoom(t);
      const j = await helix('GET', 'moderation/shield_mode', { broadcaster_id: room, moderator_id: auth.userId });
      const s = (j.data && j.data[0]) || {};
      sw.checked = !!s.is_active;
      sw.disabled = false;
      if (s.is_active) sub.textContent = `Activo desde ${ago(s.last_activated_at)} (por ${s.moderator_name || 'un mod'})`;
      card.classList.toggle('on', sw.checked);
      sw.addEventListener('change', async () => {
        sw.disabled = true;
        try {
          await helix('PUT', 'moderation/shield_mode', { broadcaster_id: room, moderator_id: auth.userId }, { is_active: sw.checked });
          toast(sw.checked ? '🛡 Modo escudo activado' : 'Modo escudo desactivado');
          card.classList.toggle('on', sw.checked);
        } catch (e) { sw.checked = !sw.checked; toast(e.message, true); }
        sw.disabled = false;
      });
    } catch (e) { sub.textContent = '⚠ ' + e.message; }
  })();
  return card;
}

/* ---------- Pestañas ---------- */
const MOD_LOADERS = {
  /* 📨 Pendientes: solicitudes de desbaneo + sospechosos */
  async pending(t) {
    const room = await twRoom(t);
    const out = [];
    const reqCard = el('div', 'card');
    reqCard.append(el('h3', null, '📨 Solicitudes de desbaneo'));
    const j = await helix('GET', 'moderation/unban_requests', { broadcaster_id: room, moderator_id: auth.userId, status: 'pending', first: 50 });
    const reqs = j.data || [];
    MOD.unbanCount[t.ch] = reqs.length;
    updateModBadge();
    if (!reqs.length) reqCard.append(el('p', 'empty', 'No hay solicitudes pendientes.'));
    for (const r of reqs) {
      const li = el('div', 'li');
      const info = el('div', 'grow');
      info.append(el('strong', null, r.user_name), el('div', null, r.text || '(sin mensaje)'), el('div', 'sub', ago(r.created_at)));
      const resolve = (status) => async () => {
        const text = prompt(status === 'approved' ? 'Mensaje para el usuario (opcional):' : 'Motivo del rechazo (opcional):', '');
        if (text === null) return;
        await helix('PATCH', 'moderation/unban_requests', { broadcaster_id: room, moderator_id: auth.userId, unban_request_id: r.id, status, resolution_text: text || undefined });
        toast(status === 'approved' ? `${r.user_name} fue desbaneado` : 'Solicitud rechazada');
        refreshMod();
      };
      li.append(info, modBtn('✓ Desbanear', 'ok', resolve('approved')), modBtn('✕ Rechazar', 'danger', resolve('denied')));
      reqCard.append(li);
    }
    out.push(reqCard);

    const susCard = el('div', 'card');
    susCard.append(el('h3', null, '👁 Mensajes de usuarios sospechosos'));
    const sus = MOD.suspicious.filter((s) => s.ch === t.ch).slice(-30).reverse();
    if (!sus.length) susCard.append(el('p', 'empty', 'Nada por ahora. Aparecerán aquí los mensajes de usuarios vigilados o con posible evasión de ban.'));
    for (const s of sus) {
      const li = el('div', 'li');
      const info = el('div', 'grow');
      info.append(el('strong', null, s.user), el('div', null, s.text), el('div', 'sub', `${s.why} · ${ago(s.at)}`));
      li.append(info, modBtn('👤', '', () => openUserCard({ platform: 'twitch', channel: t.ch, userId: s.userId, user: s.user })));
      susCard.append(li);
    }
    out.push(susCard);
    return out;
  },

  /* ⛔ Baneados */
  async bans(t) {
    const card = el('div', 'card');
    if (t.p === 'twitch') {
      const room = await twRoom(t);
      card.append(el('h3', null, '⛔ Baneados y en timeout'));
      const rows = [];
      let after = null;
      for (let i = 0; i < 5; i++) {
        const params = { broadcaster_id: room, first: 100 };
        if (after) params.after = after;
        const j = await helix('GET', 'moderation/banned', params);
        rows.push(...(j.data || []));
        after = j.pagination && j.pagination.cursor;
        if (!after) break;
      }
      card.append(searchBox(card));
      if (!rows.length) card.append(el('p', 'empty', 'No hay nadie baneado.'));
      for (const b of rows) {
        const li = el('div', 'li');
        li.dataset.q = (b.user_login + ' ' + (b.reason || '')).toLowerCase();
        const info = el('div', 'grow');
        info.append(el('strong', null, b.user_name), el('div', 'sub', `${b.expires_at ? '⏱ Timeout · ' + untilText(b.expires_at) : '⛔ Ban permanente'} · por ${b.moderator_name || '?'} · ${ago(b.created_at)}`));
        if (b.reason) info.append(el('div', null, b.reason));
        li.append(info, modBtn('Desbanear', 'ok', async () => {
          await helix('DELETE', 'moderation/bans', { broadcaster_id: room, moderator_id: auth.userId, user_id: b.user_id });
          toast(`${b.user_name} fue desbaneado`);
          li.remove();
        }));
        card.append(li);
      }
      return [card];
    }
    if (t.p === 'kick') {
      card.append(el('h3', null, '⛔ Desbanear en Kick'), el('p', 'sub', 'Kick no permite ver la lista de baneados por API; escribe el nombre de usuario para quitarle el ban o el timeout.'));
      const form = el('div', 'inline-form');
      const input = el('input');
      input.placeholder = 'nombre_de_usuario';
      form.append(input, modBtn('Desbanear', 'ok', async () => {
        const name = input.value.trim().replace(/^@/, '');
        if (!name) return;
        const u = await fetchJson('https://kick.com/api/v2/channels/' + encodeURIComponent(name.toLowerCase().replace(/_/g, '-')));
        const userId = u && (u.user_id || (u.user && u.user.id));
        if (!userId) throw new Error('No encontré ese usuario en Kick');
        await kickApi('DELETE', 'moderation/bans', { broadcaster_user_id: await kickBroadcasterId(t.ch), user_id: Number(userId) });
        toast(`${name} fue desbaneado en Kick`);
        input.value = '';
      }));
      card.append(form);
      return [card];
    }
    // Starvios
    const s = await svTarget(t);
    card.append(el('h3', null, '⛔ Sancionados (ban o timeout)'));
    const rows = await svGet(`live_chat_bans?select=user_id,until,reason,profiles:profiles!live_chat_bans_user_id_fkey(username,display_name)&channel_id=eq.${s.channelId}&until=gt.${encodeURIComponent(new Date().toISOString())}&order=created_at.desc`);
    if (!rows.length) card.append(el('p', 'empty', 'No hay nadie sancionado.'));
    for (const b of rows) {
      const p = b.profiles || {};
      const li = el('div', 'li');
      const info = el('div', 'grow');
      info.append(el('strong', null, p.display_name || p.username || '?'), el('div', 'sub', untilText(b.until)));
      if (b.reason) info.append(el('div', null, b.reason));
      li.append(info, modBtn('Quitar sanción', 'ok', async () => {
        await svAuthed('POST', 'rpc/moderate_chat_user', { _channel: s.channelId, _user: b.user_id, _minutes: 0 });
        toast('Sanción retirada');
        li.remove();
      }));
      card.append(li);
    }
    return [card];
  },

  /* 👥 En el chat */
  async chatters(t) {
    const card = el('div', 'card');
    if (t.p === 'twitch') {
      const room = await twRoom(t);
      const rows = [];
      let after = null;
      let total = 0;
      for (let i = 0; i < 10; i++) {
        const params = { broadcaster_id: room, moderator_id: auth.userId, first: 1000 };
        if (after) params.after = after;
        const j = await helix('GET', 'chat/chatters', params);
        rows.push(...(j.data || []));
        total = j.total || rows.length;
        after = j.pagination && j.pagination.cursor;
        if (!after) break;
      }
      card.append(el('h3', null, `👥 En el chat: ${total.toLocaleString('es')}`), searchBox(card));
      for (const c of rows.sort((a, b) => a.user_login.localeCompare(b.user_login))) {
        const li = el('div', 'li clickable');
        li.dataset.q = c.user_login;
        li.append(el('span', 'grow', c.user_name));
        li.addEventListener('click', () => openUserCard({ platform: 'twitch', channel: t.ch, userId: c.user_id, user: c.user_name, login: c.user_login }));
        card.append(li);
      }
      return [card];
    }
    const s = await svTarget(t);
    const rows = (await svAuthed('POST', 'rpc/live_viewer_list', { _stream: s.id })) || [];
    card.append(el('h3', null, `👥 Mirando ahora: ${rows.length}`), searchBox(card));
    if (!rows.length) card.append(el('p', 'empty', 'No hay espectadores con sesión (o el canal no está en directo).'));
    for (const v of rows) {
      const li = el('div', 'li clickable');
      li.dataset.q = (v.username || '').toLowerCase();
      if (v.avatar_url) {
        const img = el('img', 'av');
        img.src = svEmoteImg(v.avatar_url);
        img.alt = '';
        li.append(img);
      }
      li.append(el('span', 'grow', v.display_name || v.username));
      li.addEventListener('click', () => openUserCard({ platform: 'starvios', channel: t.name || t.ch, userId: v.id, user: v.display_name || v.username, login: v.username, channelId: s.channelId }));
      card.append(li);
    }
    return [card];
  },

  /* 🛡 Equipo: mods y VIPs */
  async team(t) {
    if (t.p === 'twitch') {
      const room = await twRoom(t);
      if (!t.own) {
        return [el('p', 'empty', 'Twitch solo deja ver y cambiar moderadores y VIPs desde la cuenta dueña del canal.')];
      }
      const [mods, vips] = await Promise.all([
        helix('GET', 'moderation/moderators', { broadcaster_id: room, first: 100 }),
        helix('GET', 'channels/vips', { broadcaster_id: room, first: 100 }),
      ]);
      const list = (title, rows, add, remove) => {
        const card = el('div', 'card');
        card.append(el('h3', null, `${title} (${rows.length})`));
        const form = el('div', 'inline-form');
        const input = el('input');
        input.placeholder = 'nombre_de_usuario';
        form.append(input, modBtn('Agregar', 'accent', async () => {
          const name = input.value.trim().replace(/^@/, '');
          if (!name) return;
          await add(await twUserId(name));
          toast(`${name} agregado`);
          refreshMod();
        }));
        card.append(form);
        for (const r of rows) {
          const li = el('div', 'li');
          li.append(el('strong', 'grow', r.user_name), modBtn('Quitar', 'danger', async () => {
            if (!confirm(`¿Quitar a ${r.user_name}?`)) return;
            await remove(r.user_id);
            li.remove();
          }));
          card.append(li);
        }
        return card;
      };
      return [
        list('🛡 Moderadores', mods.data || [],
          (id) => helix('POST', 'moderation/moderators', { broadcaster_id: room, user_id: id }),
          (id) => helix('DELETE', 'moderation/moderators', { broadcaster_id: room, user_id: id })),
        list('💎 VIPs', vips.data || [],
          (id) => helix('POST', 'channels/vips', { broadcaster_id: room, user_id: id }),
          (id) => helix('DELETE', 'channels/vips', { broadcaster_id: room, user_id: id })),
      ];
    }
    // Starvios
    const s = await svTarget(t);
    const rows = await svGet(`live_chat_roles?select=user_id,role,profiles:profiles!live_chat_roles_user_id_fkey(username,display_name)&channel_id=eq.${s.channelId}&order=created_at`);
    const card = el('div', 'card');
    card.append(el('h3', null, `🛡 Moderadores y VIPs (${rows.length})`));
    const form = el('div', 'inline-form');
    const input = el('input');
    input.placeholder = 'nombre_de_usuario';
    const role = el('select');
    role.append(new Option('Moderador', 'moderator'), new Option('VIP', 'vip'));
    form.append(input, role, modBtn('Agregar', 'accent', async () => {
      const name = input.value.trim().replace(/^@/, '').toLowerCase();
      if (!name) return;
      const [p] = await svGet('profiles?select=id&username=eq.' + encodeURIComponent(name));
      if (!p) throw new Error('No existe ese usuario en Starvios');
      await svAuthed('POST', 'rpc/set_chat_role', { _channel: s.channelId, _user: p.id, _role: role.value });
      toast(`${name} ahora es ${role.value === 'vip' ? 'VIP' : 'moderador'}`);
      refreshMod();
    }));
    card.append(form);
    for (const r of rows) {
      const p = r.profiles || {};
      const li = el('div', 'li');
      li.append(el('span', null, r.role === 'vip' ? '💎' : '🛡'), el('strong', 'grow', p.display_name || p.username || '?'),
        modBtn('Quitar', 'danger', async () => {
          await svAuthed('POST', 'rpc/set_chat_role', { _channel: s.channelId, _user: r.user_id, _role: null });
          li.remove();
        }));
      card.append(li);
    }
    return [card];
  },

  /* 🚫 Filtros (Twitch) / ⚙️ Ajustes del chat (Starvios) */
  async filters(t) {
    if (t.p === 'starvios') return [await svChatSettingsCard(t)];
    const room = await twRoom(t);
    const q = { broadcaster_id: room, moderator_id: auth.userId };
    // Términos bloqueados
    const terms = [];
    let after = null;
    for (let i = 0; i < 5; i++) {
      const j = await helix('GET', 'moderation/blocked_terms', { ...q, first: 100, ...(after ? { after } : {}) });
      terms.push(...(j.data || []));
      after = j.pagination && j.pagination.cursor;
      if (!after) break;
    }
    const tCard = el('div', 'card');
    tCard.append(el('h3', null, `🚫 Términos bloqueados (${terms.length})`), el('p', 'sub', 'Los mensajes con estos términos no se publican. Usa * como comodín (ej.: spam*).'));
    const form = el('div', 'inline-form');
    const input = el('input');
    input.placeholder = 'palabra o frase';
    input.maxLength = 500;
    form.append(input, modBtn('Bloquear', 'accent', async () => {
      const text = input.value.trim();
      if (text.length < 2) throw new Error('Escribe al menos 2 caracteres');
      await helix('POST', 'moderation/blocked_terms', q, { text });
      toast(`"${text}" bloqueado`);
      refreshMod();
    }));
    tCard.append(form, searchBox(tCard));
    for (const term of terms) {
      const li = el('div', 'li');
      li.dataset.q = term.text.toLowerCase();
      li.append(el('code', 'grow', term.text), modBtn('Quitar', 'danger', async () => {
        await helix('DELETE', 'moderation/blocked_terms', { ...q, id: term.id });
        li.remove();
      }));
      tCard.append(li);
    }

    // AutoMod
    const aCard = el('div', 'card');
    aCard.append(el('h3', null, '🤖 Nivel de AutoMod'), el('p', 'sub', '0 = apagado, 4 = máximo filtro. Cambia al momento.'));
    const j = await helix('GET', 'moderation/automod/settings', q);
    const s = (j.data && j.data[0]) || {};
    const cats = [
      ['overall_level', 'General (todas las categorías)'], ['aggression', 'Agresividad'], ['bullying', 'Acoso'],
      ['disability', 'Discapacidad'], ['misogyny', 'Misoginia'], ['race_ethnicity_or_religion', 'Raza o religión'],
      ['sex_based_terms', 'Contenido sexual'], ['sexuality_sex_or_gender', 'Sexualidad o género'], ['swearing', 'Groserías'],
    ];
    for (const [key, label] of cats) {
      const row = el('div', 'am-level');
      row.append(el('span', 'grow', label));
      const pick = el('div', 'choice-row');
      for (let lvl = 0; lvl <= 4; lvl++) {
        const b = el('button', 'choice small', String(lvl));
        b.type = 'button';
        b.setAttribute('aria-pressed', String(s[key] === lvl));
        b.addEventListener('click', async () => {
          // overall_level reemplaza todo; si no, se mandan todos los valores individuales
          const body = key === 'overall_level' ? { overall_level: lvl } : Object.fromEntries(cats.slice(1).map(([k]) => [k, k === key ? lvl : (s[k] || 0)]));
          try {
            const r = await helix('PUT', 'moderation/automod/settings', q, body);
            Object.assign(s, (r.data && r.data[0]) || body);
            toast(`AutoMod: ${label} → ${lvl}`);
            refreshMod();
          } catch (e) { toast(e.message, true); }
        });
        pick.append(b);
      }
      row.append(pick);
      aCard.append(row);
    }
    return [tCard, aCard];
  },

  /* 📜 Registro */
  async log(t) {
    const card = el('div', 'card');
    card.append(el('h3', null, '📜 Acciones de moderación'), el('p', 'sub', 'Lo que hacen los moderadores mientras Chat M está abierto (bans, timeouts, mensajes borrados, modos del chat…).'));
    const rows = MOD.log.filter((x) => x.ch === t.ch).slice(-200).reverse();
    if (!rows.length) card.append(el('p', 'empty', 'Todavía no hay acciones registradas.'));
    for (const r of rows) {
      const li = el('div', 'li');
      li.append(el('span', 'sub', fmtTime(new Date(r.at))), el('span', 'grow', r.text));
      card.append(li);
    }
    return [card];
  },
};

// Buscador para filtrar las filas (.li con data-q) de una tarjeta
function searchBox(card) {
  const i = el('input', 'mod-search');
  i.placeholder = '🔍 Buscar…';
  i.addEventListener('input', () => {
    const q = i.value.trim().toLowerCase();
    for (const li of card.querySelectorAll('.li')) li.hidden = !!q && !(li.dataset.q || li.textContent.toLowerCase()).includes(q);
  });
  return i;
}

/* ---------- Starvios: todos los ajustes del chat ---------- */
async function svChatSettingsCard(t) {
  const s = await svTarget(t);
  const [r] = await svGet(`live_streams?select=${SV_MODE_FIELDS}&id=eq.${s.id}`);
  if (!r) throw new Error('No se encontró el directo');
  const card = el('div', 'card');
  card.append(el('h3', null, '⚙️ Ajustes del chat'));
  const f = {
    slow: numberField('Modo lento (segundos, 0 = apagado)', r.slow_mode_seconds || 0),
    followers: numberField('Solo seguidores con al menos (minutos, 0 = apagado)', r.followers_only_minutes || 0),
    age: numberField('Antigüedad mínima de la cuenta (días)', r.min_account_age_days || 0),
  };
  const sw = (label, val) => {
    const l = el('label', 'toggle');
    const i = el('input');
    i.type = 'checkbox';
    i.checked = !!val;
    l.append(i, label);
    return l;
  };
  const toggles = {
    members: sw('Solo miembros (subs)', r.is_members_only),
    emote: sw('Solo emotes', r.emote_only),
    unique: sw('Mensajes únicos', r.unique_chat),
    caps: sw('Bloquear mayúsculas excesivas', r.block_caps),
    automod: sw('AutoMod de Starvios', r.automod),
    adults: sw('Solo mayores de 18', r.adults_only),
  };
  const links = el('select');
  for (const [v, l] of [['everyone', 'Todos pueden enviar enlaces'], ['mods', 'Solo mods pueden enviar enlaces'], ['nobody', 'Nadie puede enviar enlaces']]) links.append(new Option(l, v));
  links.value = r.link_policy || 'mods';
  const blocked = el('textarea', 'tl-textarea');
  blocked.rows = 3;
  blocked.placeholder = 'Palabras bloqueadas, separadas por coma';
  blocked.value = (r.blocked_words || []).join(', ');
  const grid = el('div', 'toggle-grid');
  grid.append(...Object.values(toggles));
  card.append(f.slow.box, f.followers.box, f.age.box, grid, field('Enlaces', links), field('Palabras bloqueadas', blocked),
    modBtn('Guardar ajustes del chat', 'accent', async () => {
      await svAuthed('POST', 'rpc/update_chat_settings', {
        _channel: s.channelId,
        _slow: Math.max(0, Number(f.slow.input.value) || 0),
        _link_policy: links.value,
        _blocked: blocked.value.split(',').map((w) => w.trim()).filter(Boolean),
        _followers: Math.max(0, Number(f.followers.input.value) || 0),
        _caps: toggles.caps.querySelector('input').checked,
        _unique: toggles.unique.querySelector('input').checked,
        _automod: toggles.automod.querySelector('input').checked,
        _emote: toggles.emote.querySelector('input').checked,
        _members: toggles.members.querySelector('input').checked,
        _min_age_days: Math.max(0, Number(f.age.input.value) || 0),
        _adults: toggles.adults.querySelector('input').checked,
      });
      toast('Ajustes del chat guardados');
    }));
  return card;
}

function numberField(label, value) {
  const input = el('input');
  input.type = 'number';
  input.min = '0';
  input.inputMode = 'numeric';
  input.value = value;
  return { input, box: field(label, input) };
}

/* =========================================================
   Tarjeta de usuario
   m = { platform, channel, userId, user, login?, channelId? }
   ========================================================= */
const ucDialog = $('#user-card');

async function openUserCard(m) {
  const sheet = el('div', 'sheet uc');
  const head = el('div', 'sheet-head');
  head.append(el('span', `badge-platform ${m.platform}`, PLATFORM_NAMES[m.platform]), el('strong', 'grow', m.user || m.login || '?'));
  const x = el('button', 'icon-btn small', '✕');
  x.type = 'button';
  x.addEventListener('click', () => ucDialog.close());
  head.append(x);
  const info = el('div', 'stat-grid');
  const recent = el('div', 'list');
  const actionsBox = el('div', 'uc-actions');
  sheet.append(head, el('p', 'sub', `En el canal ${m.channel}`), info, actionsBox, el('h4', null, 'Mensajes recientes en Chat M'), recent);
  ucDialog.replaceChildren(sheet);
  ucDialog.showModal();

  // Mensajes recientes de este usuario en el chat
  const name = (m.user || '').toLowerCase();
  const msgs = [...feed.querySelectorAll(`.msg[data-src="${CSS.escape(srcKey(m.platform, m.channel))}"]`)]
    .filter((e) => e.dataset.user === name).slice(-15).reverse();
  if (!msgs.length) recent.append(el('p', 'empty', 'Sin mensajes en esta sesión.'));
  for (const e of msgs) {
    const li = el('div', 'li');
    li.append(el('span', 'sub', e.querySelector('.time').textContent), el('span', 'grow', e.querySelector('.body') ? e.querySelector('.body').textContent : ''));
    if (e.classList.contains('deleted')) li.style.opacity = '.5';
    recent.append(li);
  }
  const stat = (label, value) => { const s = el('div', 'stat'); s.append(el('b', null, value), el('span', null, label)); info.append(s); };
  stat('mensajes en esta sesión', String(msgs.length));

  const act = (text, cls, fn) => actionsBox.append(modBtn(text, cls, async () => { await fn(); }));
  const mm = { ...m, id: null };

  try {
    if (m.platform === 'twitch') {
      if (!auth) throw new Error('Inicia sesión con Twitch');
      const userId = m.userId || await twUserId(m.login || m.user);
      mm.userId = userId;
      const room = await twRoom({ ch: m.channel, room: m.channel === auth.login ? auth.userId : twitchRooms[m.channel] });
      const [u, fol] = await Promise.all([
        helix('GET', 'users', { id: userId }),
        helix('GET', 'channels/followers', { broadcaster_id: room, user_id: userId }).catch(() => null),
      ]);
      const user = (u.data && u.data[0]) || {};
      if (user.profile_image_url) {
        const img = el('img', 'uc-avatar');
        img.src = user.profile_image_url;
        img.alt = '';
        head.prepend(img);
      }
      stat('cuenta creada', user.created_at ? ago(user.created_at).replace('hace ', '') : '?');
      const f = fol && fol.data && fol.data[0];
      stat('sigue desde', f ? ago(f.followed_at).replace('hace ', '') : 'no sigue');
      if (room === auth.userId) {
        try {
          const sub = await helix('GET', 'subscriptions', { broadcaster_id: room, user_id: userId });
          const s = sub.data && sub.data[0];
          stat('suscripción', s ? { 1000: 'Nivel 1', 2000: 'Nivel 2', 3000: 'Nivel 3' }[s.tier] + (s.is_gift ? ' (regalo)' : '') : 'no');
        } catch { /* sin permiso */ }
      }
      if (user.description) sheet.insertBefore(el('p', 'sub', user.description), info);

      const p = PROVIDERS.twitch;
      act('⏱ 1 min', '', () => p.ban(mm, 1).then(() => toast('Timeout de 1 min')));
      act('⏱ 10 min', '', () => p.ban(mm, 10).then(() => toast('Timeout de 10 min')));
      act('⏱ 1 h', '', () => p.ban(mm, 60).then(() => toast('Timeout de 1 h')));
      act('⛔ Banear', 'danger', async () => { if (confirm(`¿Banear a ${m.user}?`)) { await p.ban(mm, null); toast(`${m.user} baneado`); } });
      act('✓ Desbanear', '', () => helix('DELETE', 'moderation/bans', { broadcaster_id: room, moderator_id: auth.userId, user_id: userId }).then(() => toast('Desbaneado')));
      act('⚠️ Advertir', '', async () => {
        const reason = prompt('Motivo de la advertencia:', 'Respeta las reglas del chat');
        if (reason) { await p.warn(mm, reason); toast('Advertencia enviada'); }
      });
      act('👁 Vigilar', '', () => helix('POST', 'moderation/suspicious_users', { broadcaster_id: room, moderator_id: auth.userId }, { user_id: userId, status: 'ACTIVE_MONITORING' }).then(() => toast('Ahora está vigilado')));
      act('🔇 Restringir', '', () => helix('POST', 'moderation/suspicious_users', { broadcaster_id: room, moderator_id: auth.userId }, { user_id: userId, status: 'RESTRICTED' }).then(() => toast('Restringido: solo los mods ven sus mensajes')));
      act('🙂 Quitar vigilancia', '', () => helix('DELETE', 'moderation/suspicious_users', { broadcaster_id: room, moderator_id: auth.userId, user_id: userId }).then(() => toast('Ya no está vigilado')));
      if (room === auth.userId) {
        act('🛡 Hacer mod', '', () => helix('POST', 'moderation/moderators', { broadcaster_id: room, user_id: userId }).then(() => toast('Ahora es moderador')));
        act('💎 Hacer VIP', '', () => helix('POST', 'channels/vips', { broadcaster_id: room, user_id: userId }).then(() => toast('Ahora es VIP')));
      }
      act('💬 Susurrar', '', async () => {
        const msg = prompt(`Susurro para ${m.user}:`, '');
        if (msg) { await helix('POST', 'whispers', { from_user_id: auth.userId, to_user_id: userId }, { message: msg.slice(0, 500) }); toast('Susurro enviado'); }
      });
      act('🚫 Bloquear', 'danger', async () => {
        if (confirm(`¿Bloquear a ${m.user} en tu cuenta de Twitch?`)) { await helix('PUT', 'users/blocks', { target_user_id: userId }); toast('Usuario bloqueado'); }
      });
    } else if (m.platform === 'starvios') {
      const s = m.channelId ? { channelId: m.channelId } : await svTarget({ name: m.channel === 'tu canal' ? null : m.channel });
      const card = (await svAuthed('POST', 'rpc/chat_user_card', { _channel: s.channelId, _user: m.userId })) || {};
      if (card.messages != null) stat('mensajes en el canal', Number(card.messages).toLocaleString('es'));
      if (card.sanctions != null) stat('sanciones', String(card.sanctions));
      stat('miembro', card.member_until && Date.parse(card.member_until) > Date.now() ? 'sí' : 'no');
      const sanction = (min, label) => act(label, min > 1000 ? 'danger' : '', async () => {
        if (min > 1000 && !confirm(`¿Expulsar a ${m.user} del chat?`)) return;
        await svAuthed('POST', 'rpc/moderate_chat_user', { _channel: s.channelId, _user: m.userId, _minutes: min, _reason: 'Chat M' });
        toast(min ? 'Sanción aplicada' : 'Sanción retirada');
      });
      sanction(1, '⏱ 1 min'); sanction(10, '⏱ 10 min'); sanction(60, '⏱ 1 h'); sanction(SV_BAN_MINUTES, '⛔ Expulsar'); sanction(0, '✓ Quitar sanción');
      act('🛡 Hacer mod', '', () => svAuthed('POST', 'rpc/set_chat_role', { _channel: s.channelId, _user: m.userId, _role: 'moderator' }).then(() => toast('Ahora es moderador')));
      act('💎 Hacer VIP', '', () => svAuthed('POST', 'rpc/set_chat_role', { _channel: s.channelId, _user: m.userId, _role: 'vip' }).then(() => toast('Ahora es VIP')));
      act('Quitar rol', '', () => svAuthed('POST', 'rpc/set_chat_role', { _channel: s.channelId, _user: m.userId, _role: null }).then(() => toast('Rol quitado')));
      act('✉️ Mensaje privado', '', async () => {
        const msg = prompt(`Mensaje privado para ${m.user}:`, '');
        if (msg) { await svAuthed('POST', 'rpc/send_private_message', { _recipient: m.userId, _body: msg }); toast('Mensaje enviado'); }
      });
    } else {
      // Kick: información pública del usuario en el canal
      try {
        const u = await fetchJson(`https://kick.com/api/v2/channels/${encodeURIComponent(m.channel.replace(/_/g, '-'))}/users/${encodeURIComponent((m.login || m.user).toLowerCase())}`);
        if (u.following_since) stat('sigue desde', ago(u.following_since).replace('hace ', ''));
        if (u.subscribed_for) stat('meses de sub', String(u.subscribed_for));
        if (u.banned) stat('estado', 'baneado');
      } catch { /* sin datos públicos */ }
      const p = PROVIDERS.kick;
      mm.userId = m.userId;
      act('⏱ 1 min', '', () => p.ban(mm, 1).then(() => toast('Timeout de 1 min')));
      act('⏱ 10 min', '', () => p.ban(mm, 10).then(() => toast('Timeout de 10 min')));
      act('⛔ Banear', 'danger', async () => { if (confirm(`¿Banear a ${m.user}?`)) { await p.ban(mm, null); toast('Baneado'); } });
      act('✓ Desbanear', '', async () => {
        await kickApi('DELETE', 'moderation/bans', { broadcaster_user_id: await kickBroadcasterId(m.channel), user_id: Number(m.userId) });
        toast('Desbaneado');
      });
    }
  } catch (e) {
    actionsBox.append(el('p', 'st-card-error', '⚠ ' + e.message));
  }
}

/* ---------- Eventos en vivo de Twitch para esta sección ---------- */
onTwitchEvent((type, ev) => {
  const ch = ev.broadcaster_user_login;
  if (type === 'channel.moderate') {
    MOD.log.push({ ch, at: Date.now(), text: modActionText(ev) });
    if (MOD.log.length > 1000) MOD.log.splice(0, 200);
    if (currentPage === 'mod' && MOD.tab === 'log') refreshMod();
  } else if (type === 'channel.suspicious_user.message') {
    MOD.suspicious.push({
      ch, at: new Date().toISOString(), user: ev.user_name, userId: ev.user_id, text: (ev.message && ev.message.text) || '',
      why: (ev.types || []).includes('ban_evader') ? 'posible evasión de ban' : (ev.shared_ban_channel_ids || []).length ? 'baneado en otros canales' : 'vigilado',
    });
    if (MOD.suspicious.length > 300) MOD.suspicious.splice(0, 100);
  } else if (type === 'channel.unban_request.create') {
    MOD.unbanCount[ch] = (MOD.unbanCount[ch] || 0) + 1;
    updateModBadge();
    toast(`📨 ${ev.user_name} pidió desbaneo en ${ch}`);
    if (currentPage === 'mod' && MOD.tab === 'pending') refreshMod();
  } else if (type === 'channel.unban_request.resolve') {
    MOD.unbanCount[ch] = Math.max(0, (MOD.unbanCount[ch] || 1) - 1);
    updateModBadge();
  } else if (type === 'automod.message.hold' || type === 'automod.message.update') {
    setTimeout(updateModBadge);
  }
});

// Número en el botón "Moderar": mensajes de AutoMod sin revisar + solicitudes de desbaneo
function updateModBadge() {
  const held = feed.querySelectorAll('.msg.automod:not(.resolved)').length;
  const unban = Object.values(MOD.unbanCount).reduce((a, b) => a + b, 0);
  setModBadge(held + unban);
}

// Al iniciar, revisa cuántas solicitudes de desbaneo hay pendientes (y cada 2 min)
async function pollUnbanRequests() {
  if (!auth || !(auth.scopes || []).includes('moderator:manage:unban_requests')) return;
  const chans = channelsOf('twitch');
  if (!chans.includes(auth.login)) chans.push(auth.login);
  await Promise.all(chans.map(async (ch) => {
    try {
      const room = ch === auth.login ? auth.userId : twitchRooms[ch];
      if (!room) return;
      const j = await helix('GET', 'moderation/unban_requests', { broadcaster_id: room, moderator_id: auth.userId, status: 'pending', first: 50 });
      MOD.unbanCount[ch] = (j.data || []).length;
    } catch { /* no eres mod ahí */ }
  }));
  updateModBadge();
}
setTimeout(pollUnbanRequests, 8000);
setInterval(pollUnbanRequests, 120000);

PAGE_HOOKS.mod = { open: renderMod };
