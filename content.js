'use strict';

/* =========================================================
   🎞 Contenido y extras
   Twitch: clips (y descarga), VODs (clip desde VOD, borrar),
           marcadores, calendario, canales que sigues en vivo
   Kick: clips y videos
   Starvios: clips, comandos del chat, emotes, mensajes
             privados, notificaciones, alertas de OBS, ajustes
   ========================================================= */
const CT = { sel: null, tab: null, seq: 0 };

const CT_TABS = {
  twitch: [['clips', '🎬 Clips'], ['vods', '📼 VODs'], ['markers', '📍 Marcadores'], ['schedule', '📅 Calendario'], ['following', '👀 Siguiendo en vivo']],
  kick: [['kclips', '🎬 Clips'], ['kvideos', '📼 Videos']],
  starvios: [['sclips', '🎬 Clips'], ['commands', '⌨️ Comandos'], ['emotes', '😀 Emotes'], ['dms', '✉️ Mensajes'], ['notifs', '🔔 Notificaciones'], ['obs', '🎥 Alertas OBS'], ['live', '⚙️ Directo']],
};
// Pestañas que solo tienen sentido en tu propio canal
const CT_OWN_ONLY = new Set(['vods', 'schedule', 'commands', 'emotes', 'dms', 'notifs', 'obs', 'live']);

function renderContent() {
  const page = $('#page-content');
  const body = el('div', 'st-body');
  page.replaceChildren(pageHeader('🎞', 'Contenido', 'Clips, VODs, calendario y herramientas de tu canal'), body);
  const targets = modTargets();
  if (!targets.length) { body.append(el('p', 'empty', 'Inicia sesión en ⚙ Ajustes para ver tu contenido.')); return; }
  if (!targets.some((t) => t.id === CT.sel)) CT.sel = (targets.find((t) => t.own) || targets[0]).id;
  const t = targets.find((x) => x.id === CT.sel);
  const tabs = CT_TABS[t.p];
  if (!tabs.some(([id]) => id === CT.tab)) CT.tab = tabs[0][0];

  const chans = el('div', 'pill-tabs');
  for (const x of targets) {
    const b = el('button');
    b.type = 'button';
    b.setAttribute('aria-selected', String(x.id === CT.sel));
    b.append(el('span', 'plat-dot ' + x.p), ' ' + x.ch);
    b.style.display = 'inline-flex';
    b.style.alignItems = 'center';
    b.style.gap = '6px';
    b.addEventListener('click', () => { CT.sel = x.id; renderContent(); });
    chans.append(b);
  }
  const tabRow = el('div', 'pill-tabs');
  for (const [id, label] of tabs) {
    const b = el('button', null, label);
    b.type = 'button';
    b.setAttribute('aria-selected', String(id === CT.tab));
    b.addEventListener('click', () => { CT.tab = id; renderContent(); });
    tabRow.append(b);
  }
  const box = el('div', 'stack');
  box.id = 'ct-content';
  body.append(chans, tabRow, box);
  if (CT_OWN_ONLY.has(CT.tab) && !t.own) { box.append(el('p', 'empty', 'Esto solo está disponible en tu propio canal.')); return; }
  (async () => {
    const seq = ++CT.seq;
    box.replaceChildren(el('p', 'empty', 'Cargando…'));
    try {
      const nodes = await CT_LOADERS[CT.tab](t);
      if (seq === CT.seq && document.body.contains(box)) box.replaceChildren(...nodes);
    } catch (e) {
      if (seq === CT.seq && document.body.contains(box)) box.replaceChildren(el('p', 'st-card-error', '⚠ ' + e.message));
    }
  })();
}
const refreshContent = () => { if (currentPage === 'content') renderContent(); };

// Tarjeta de un video/clip con miniatura
function mediaItem({ thumb, title, meta, href, actions = [] }) {
  const it = el('div', 'media');
  if (thumb) {
    const img = el('img');
    img.src = thumb;
    img.alt = '';
    img.loading = 'lazy';
    it.append(img);
  }
  const info = el('div', 'media-info');
  const a = el(href ? 'a' : 'strong', 'media-title', title || '(sin título)');
  if (href) { a.href = href; a.target = '_blank'; a.rel = 'noopener'; }
  info.append(a, el('div', 'sub', meta || ''));
  const acts = el('div', 'row');
  acts.append(...actions);
  info.append(acts);
  it.append(info);
  return it;
}
const mediaGrid = (items, empty) => {
  if (!items.length) return el('p', 'empty', empty);
  const g = el('div', 'media-grid');
  g.append(...items);
  return g;
};
const dur = (s) => fmtClock(Number(s) || 0);
// "1h2m3s" (formato de Twitch) → segundos
const twDur = (d) => { const m = /(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/.exec(d || ''); return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0); };

const CT_LOADERS = {
  /* ---------- Twitch ---------- */
  async clips(t) {
    const room = await twRoom(t);
    const since = new Date(Date.now() - 30 * 86400e3).toISOString();
    const j = await helix('GET', 'clips', { broadcaster_id: room, first: 30, started_at: since });
    const items = (j.data || []).map((c) => mediaItem({
      thumb: c.thumbnail_url, title: c.title, href: c.url,
      meta: `👁 ${nf(c.view_count)} · ✂ ${c.creator_name} · ${ago(c.created_at)} · ${dur(c.duration)}`,
      actions: [modBtn('⬇ Descargar', '', async () => {
        const d = await helix('GET', 'clips/downloads', { editor_id: auth.userId, broadcaster_id: room, clip_id: c.id });
        const u = d.data && d.data[0] && (d.data[0].landscape_download_url || d.data[0].portrait_download_url);
        if (!u) throw new Error('Twitch no dio enlace de descarga (solo dueño o editores del canal)');
        window.open(u, '_blank', 'noopener');
      })],
    }));
    return [el('p', 'sub', 'Clips de los últimos 30 días, del más visto al menos visto.'), mediaGrid(items, 'No hay clips en los últimos 30 días.')];
  },

  async vods(t) {
    const room = await twRoom(t);
    const j = await helix('GET', 'videos', { user_id: room, type: 'archive', first: 20 });
    const items = (j.data || []).map((v) => mediaItem({
      thumb: (v.thumbnail_url || '').replace('%{width}', '320').replace('%{height}', '180'), title: v.title, href: v.url,
      meta: `📅 ${new Date(v.created_at).toLocaleDateString('es')} · ⏱ ${v.duration} · 👁 ${nf(v.view_count)}`,
      actions: [
        modBtn('✂ Crear clip', '', async () => {
          const end = prompt(`¿En qué minuto termina el clip? (formato h:mm:ss o mm:ss, máx. ${v.duration})`, '');
          if (!end) return;
          const secs = end.split(':').reverse().reduce((a, n, i) => a + Number(n) * 60 ** i, 0);
          if (!(secs >= 5 && secs <= twDur(v.duration))) throw new Error('Ese momento no está dentro del VOD');
          const title = prompt('Título del clip:', v.title.slice(0, 100)) || v.title.slice(0, 100);
          const len = Math.min(60, Math.max(5, Number(prompt('Duración en segundos (5 a 60):', '30')) || 30));
          const r = await helix('POST', 'videos/clips', { editor_id: auth.userId, broadcaster_id: room, vod_id: v.id, vod_offset: secs, duration: len, title });
          const c = r.data && r.data[0];
          toast('Clip creado; tarda unos segundos en procesarse');
          if (c && c.edit_url) window.open(c.edit_url, '_blank', 'noopener');
        }),
        modBtn('🗑', 'danger', async () => {
          if (!confirm(`¿Borrar el VOD "${v.title}"? No se puede deshacer.`)) return;
          await helix('DELETE', 'videos', { id: v.id });
          toast('VOD borrado');
          refreshContent();
        }),
      ],
    }));
    return [mediaGrid(items, 'No hay VODs guardados.')];
  },

  async markers(t) {
    const room = await twRoom(t);
    const j = await helix('GET', 'streams/markers', { user_id: room, first: 100 });
    const card = el('div', 'card');
    card.append(el('h3', null, '📍 Marcadores del último directo'));
    const videos = ((j.data && j.data[0]) || {}).videos || [];
    let n = 0;
    for (const v of videos) {
      for (const m of v.markers || []) {
        n++;
        const li = el('div', 'li');
        li.append(el('strong', null, fmtClock(m.position_seconds)), el('span', 'grow', m.description || '(sin descripción)'), el('span', 'sub', ago(m.created_at)));
        if (m.url) {
          const a = el('a', 'btn', 'Ver');
          a.href = m.url;
          a.target = '_blank';
          a.rel = 'noopener';
          li.append(a);
        }
        card.append(li);
      }
    }
    if (!n) card.append(el('p', 'empty', 'No hay marcadores. Créalos en 🧰 Herramientas → Marcador durante el directo.'));
    return [card];
  },

  async schedule(t) {
    const room = await twRoom(t);
    let data = { segments: [] };
    try { data = (await helix('GET', 'schedule', { broadcaster_id: room, first: 25 })).data || data; } catch (e) { if (!/404|not found/i.test(e.message)) throw e; }
    const list = el('div', 'card');
    list.append(el('h3', null, '📅 Próximos directos'));
    if (data.vacation) list.append(el('p', 'st-card-warn', `🏖 Vacaciones: del ${new Date(data.vacation.start_time).toLocaleDateString('es')} al ${new Date(data.vacation.end_time).toLocaleDateString('es')}`));
    for (const s of data.segments || []) {
      const li = el('div', 'li');
      const when = new Date(s.start_time);
      li.append(el('div', 'grow'));
      li.firstChild.append(el('strong', null, when.toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })),
        el('div', null, s.title || '(sin título)'), el('div', 'sub', `${s.category ? '🎮 ' + s.category.name + ' · ' : ''}${s.is_recurring ? '🔁 cada semana' : 'una vez'}${s.canceled_until ? ' · ❌ cancelado esta vez' : ''}`));
      li.append(modBtn('🗑', 'danger', async () => {
        if (!confirm('¿Borrar este directo del calendario?' + (s.is_recurring ? ' (se borra la serie semanal)' : ''))) return;
        await helix('DELETE', 'schedule/segment', { broadcaster_id: room, id: s.id });
        refreshContent();
      }));
      list.append(li);
    }
    if (!(data.segments || []).length) list.append(el('p', 'empty', 'No hay directos programados.'));

    // Nuevo directo
    const add = el('div', 'card');
    add.append(el('h3', null, '＋ Programar directo'));
    const when = el('input');
    when.type = 'datetime-local';
    const start = new Date(Date.now() + 86400e3);
    start.setMinutes(0, 0, 0);
    when.value = new Date(start - start.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
    const minutes = el('input');
    minutes.type = 'number';
    minutes.min = '30';
    minutes.max = '1380';
    minutes.value = '120';
    const title = textInput(140, 'Título');
    const recurring = el('label', 'toggle');
    const rec = el('input');
    rec.type = 'checkbox';
    rec.checked = true;
    recurring.append(rec, 'Repetir cada semana');
    add.append(field('Fecha y hora', when), field('Duración (minutos, 30 a 1380)', minutes), field('Título', title), recurring,
      modBtn('Programar', 'accent', async () => {
        await helix('POST', 'schedule/segment', { broadcaster_id: room }, {
          start_time: new Date(when.value).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          duration: String(Math.min(1380, Math.max(30, Number(minutes.value) || 120))), is_recurring: rec.checked, title: title.value.trim() || undefined,
        });
        toast('Directo programado');
        refreshContent();
      }));

    // Vacaciones
    const vac = el('div', 'card');
    vac.append(el('h3', null, '🏖 Vacaciones'));
    const from = el('input');
    from.type = 'date';
    const to = el('input');
    to.type = 'date';
    vac.append(el('div', 'inline-form'));
    vac.lastChild.append(from, to);
    vac.append(el('div', 'row'));
    vac.lastChild.append(
      modBtn('Activar vacaciones', 'accent', async () => {
        if (!from.value || !to.value) throw new Error('Elige las dos fechas');
        await helix('PATCH', 'schedule/settings', { broadcaster_id: room, is_vacation_enabled: true, vacation_start_time: new Date(from.value).toISOString(), vacation_end_time: new Date(to.value + 'T23:59').toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
        toast('Vacaciones activadas');
        refreshContent();
      }),
      modBtn('Quitar vacaciones', '', async () => {
        await helix('PATCH', 'schedule/settings', { broadcaster_id: room, is_vacation_enabled: false });
        toast('Vacaciones desactivadas');
        refreshContent();
      }));
    return [list, add, vac];
  },

  async following() {
    const j = await helix('GET', 'streams/followed', { user_id: auth.userId, first: 100 });
    const have = new Set(channelsOf('twitch'));
    const items = (j.data || []).map((s) => mediaItem({
      thumb: (s.thumbnail_url || '').replace('{width}', '320').replace('{height}', '180'), title: `${s.user_name} — ${s.title}`, href: 'https://twitch.tv/' + s.user_login,
      meta: `🔴 ${nf(s.viewer_count)} espectadores · 🎮 ${s.game_name} · ${uptime(s.started_at)}`,
      actions: have.has(s.user_login) ? [el('span', 'tag on', 'En tu chat')] : [modBtn('＋ Agregar al chat', '', async () => {
        cfg.twitchChannel = [...channelsOf('twitch'), s.user_login].join(', ');
        saveCfg();
        applyView();
        connectTwitch();
        connectEventSub();
        toast(`${s.user_name} agregado al chat`);
        refreshContent();
      })],
    }));
    return [el('p', 'sub', 'Canales que sigues y están en vivo ahora.'), mediaGrid(items, 'Ningún canal que sigues está en vivo.')];
  },

  /* ---------- Kick ---------- */
  async kclips(t) {
    const j = await kickPublic(t.ch, '/clips');
    const items = (j.clips || []).map((c) => mediaItem({
      thumb: c.thumbnail_url, title: c.title, href: `https://kick.com/${t.ch}/clips/${c.id}`,
      meta: `👁 ${nf(c.views || c.view_count)} · ✂ ${(c.creator && c.creator.username) || ''} · ${c.created_at ? ago(c.created_at) : ''} · ${dur(c.duration)}`,
    }));
    return [mediaGrid(items, 'No hay clips.')];
  },
  async kvideos(t) {
    const j = await kickPublic(t.ch, '/videos');
    const items = (Array.isArray(j) ? j : []).map((v) => mediaItem({
      thumb: v.thumbnail && v.thumbnail.src, title: v.session_title || v.slug, href: v.video && v.video.uuid ? `https://kick.com/${t.ch}/videos/${v.video.uuid}` : null,
      meta: `📅 ${new Date(parseTime(v.start_time || v.created_at)).toLocaleDateString('es')} · ⏱ ${fmtClock((v.duration || 0) / 1000)} · 👁 ${nf(v.views || v.viewer_count)}`,
    }));
    return [mediaGrid(items, 'No hay videos guardados.')];
  },

  /* ---------- Starvios ---------- */
  async sclips(t) {
    const s = await svTarget(t);
    const rows = await svGet(`clips?select=id,title,created_at,start_seconds,end_seconds,creator_id,views&channel_id=eq.${s.channelId}&order=created_at.desc&limit=30`);
    const items = rows.map((c) => mediaItem({
      title: c.title, href: `https://starvios.com/clip/${c.id}`,
      meta: `${c.views != null ? '👁 ' + nf(c.views) + ' · ' : ''}${ago(c.created_at)} · ${dur((c.end_seconds || 0) - (c.start_seconds || 0))}`,
      actions: t.own ? [modBtn('🗑', 'danger', async () => {
        if (!confirm(`¿Borrar el clip "${c.title}"?`)) return;
        const r = await svAuthed('DELETE', `clips?id=eq.${c.id}&select=id`, null, { Prefer: 'return=representation' });
        if (!r || !r.length) throw new Error('Starvios no borró el clip');
        refreshContent();
      })] : [],
    }));
    return [el('p', 'sub', 'Los clips se crean desde la web de Starvios (eligiendo el tramo del directo).'), mediaGrid(items, 'No hay clips.')];
  },

  async commands() {
    const me = svAuth.userId;
    const rows = await svGet(`live_chat_commands?select=id,name,aliases,response,permission,global_cooldown,user_cooldown,reply_to_user,enabled,uses&channel_id=eq.${me}&order=name`);
    const PERMS = [['everyone', 'Todos'], ['followers', 'Seguidores'], ['subscribers', 'Suscriptores'], ['vips', 'VIP y superior'], ['mods', 'Solo moderadores'], ['owner', 'Solo el dueño']];
    const save = (c) => svAuthed('POST', 'rpc/upsert_chat_command', {
      _channel: me, _id: c.id || null, _name: c.name, _aliases: c.aliases || [], _response: c.response, _permission: c.permission || 'everyone',
      _global: Number(c.global_cooldown) || 0, _user: Number(c.user_cooldown) || 0, _reply: !!c.reply_to_user, _enabled: c.enabled !== false,
    });
    const list = el('div', 'card');
    list.append(el('h3', null, `⌨️ Comandos del chat (${rows.length})`));
    for (const c of rows) {
      const li = el('div', 'li');
      const info = el('div', 'grow');
      info.append(el('strong', null, '!' + c.name + ((c.aliases || []).length ? '  (' + c.aliases.map((a) => '!' + a).join(', ') + ')' : '')),
        el('div', null, c.response), el('div', 'sub', `${(PERMS.find((p) => p[0] === c.permission) || [])[1] || c.permission} · usado ${nf(c.uses)} veces · espera ${c.global_cooldown || 0}s`));
      const sw = el('label', 'toggle');
      const i = el('input');
      i.type = 'checkbox';
      i.checked = c.enabled;
      i.addEventListener('change', async () => { try { await save({ ...c, enabled: i.checked }); toast(i.checked ? 'Comando activado' : 'Comando desactivado'); } catch (e) { toast(e.message, true); } });
      sw.append(i);
      li.append(info, sw, modBtn('✎', '', () => commandEditor(c, PERMS, save)), modBtn('🗑', 'danger', async () => {
        if (!confirm(`¿Borrar !${c.name}?`)) return;
        await svAuthed('POST', 'rpc/delete_chat_command', { _id: c.id });
        refreshContent();
      }));
      list.append(li);
    }
    if (!rows.length) list.append(el('p', 'empty', 'Todavía no tienes comandos.'));
    return [list, modBtn('＋ Nuevo comando', 'accent', () => commandEditor(null, PERMS, save))];
  },

  async emotes() {
    const me = svAuth.userId;
    const rows = await svGet(`channel_emotes?select=id,code,storage_path,audience,is_animated&channel_id=eq.${me}&order=created_at`);
    const grid = el('div', 'emote-admin');
    for (const e of rows) {
      const it = el('div', 'emote-item');
      const img = el('img');
      img.src = svEmoteImg(e.storage_path);
      img.alt = e.code;
      it.append(img, el('strong', null, ':' + e.code + ':'), el('span', 'sub', e.audience === 'follower' ? 'Seguidores' : 'Suscriptores'),
        modBtn('🗑', 'danger', async () => {
          if (!confirm(`¿Borrar :${e.code}:?`)) return;
          const r = await svAuthed('DELETE', `channel_emotes?id=eq.${e.id}&select=id`, null, { Prefer: 'return=representation' });
          if (!r || !r.length) throw new Error('Starvios no borró el emote');
          refreshContent();
        }));
      grid.append(it);
    }
    const card = el('div', 'card');
    card.append(el('h3', null, `😀 Emotes de tu canal (${rows.length})`), rows.length ? grid : el('p', 'empty', 'Aún no tienes emotes.'));

    // Subir uno nuevo desde la tablet
    const up = el('div', 'card');
    up.append(el('h3', null, '＋ Subir emote'), el('p', 'sub', 'Imagen cuadrada de al menos 56 × 56 px (PNG o GIF). El nombre debe ser único en todo Starvios.'));
    const file = el('input');
    file.type = 'file';
    file.accept = 'image/png,image/gif,image/webp,image/jpeg';
    const code = textInput(30, 'nombre_del_emote');
    const aud = el('select');
    aud.append(new Option('Para suscriptores', 'subscriber'), new Option('Para seguidores', 'follower'));
    up.append(field('Imagen', file), field('Nombre (sin espacios)', code), field('Quién puede usarlo', aud), modBtn('Subir', 'accent', async () => {
      const f = file.files && file.files[0];
      const name = code.value.trim().replace(/^:|:$/g, '');
      if (!f || !/^[A-Za-z0-9_]{2,30}$/.test(name)) throw new Error('Elige una imagen y un nombre de 2 a 30 letras, números o _');
      const bmp = await createImageBitmap(f);
      const ok = bmp.width === bmp.height && bmp.width >= 56;
      bmp.close();
      if (!ok) throw new Error('La imagen debe ser cuadrada y de al menos 56 × 56 px');
      const taken = await svGet(`channel_emotes?select=id&code=ilike.${encodeURIComponent(name.replace(/_/g, '\\_'))}&limit=1`);
      if (taken.length) throw new Error(`:${name}: ya existe en Starvios; elige otro nombre`);
      const ext = (f.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
      const path = `${me}/${crypto.randomUUID()}.${ext}`;
      await svUpload('media', path, f);
      const r = await svAuthed('POST', 'channel_emotes?select=id', { channel_id: me, code: name, storage_path: path, audience: aud.value, is_animated: f.type === 'image/gif' }, { Prefer: 'return=representation' });
      if (!r || !r.length) throw new Error('Starvios no guardó el emote');
      toast(`:${name}: subido`);
      refreshContent();
    }));
    return [card, up];
  },

  async dms() {
    const me = svAuth.userId;
    const sel = 'id,sender_id,recipient_id,body,created_at,read_at,sender:profiles!private_messages_sender_id_fkey(id,username,display_name),recipient:profiles!private_messages_recipient_id_fkey(id,username,display_name)';
    const rows = await svGet(`private_messages?select=${sel}&or=(sender_id.eq.${me},recipient_id.eq.${me})&order=created_at.desc&limit=200`);
    // Agrupa por la otra persona
    const convs = new Map();
    for (const m of rows) {
      const other = m.sender_id === me ? m.recipient : m.sender;
      if (!other) continue;
      if (!convs.has(other.id)) convs.set(other.id, { other, msgs: [] });
      convs.get(other.id).msgs.push(m);
    }
    const card = el('div', 'card');
    card.append(el('h3', null, '✉️ Mensajes privados'));
    for (const { other, msgs } of convs.values()) {
      const unread = msgs.filter((m) => m.recipient_id === me && !m.read_at).length;
      const li = el('div', 'li clickable');
      li.append(el('strong', null, other.display_name || other.username), el('span', 'grow sub', msgs[0].body.slice(0, 80)), el('span', 'sub', ago(msgs[0].created_at)));
      if (unread) li.append(el('span', 'rail-badge static', String(unread)));
      li.addEventListener('click', () => dmThread(other, msgs.slice().reverse()));
      card.append(li);
    }
    if (!convs.size) card.append(el('p', 'empty', 'No tienes mensajes privados.'));
    const nw = el('div', 'inline-form');
    const to = el('input');
    to.placeholder = 'Escribir a… (usuario)';
    nw.append(to, modBtn('Abrir', 'accent', async () => {
      const name = to.value.trim().replace(/^@/, '').toLowerCase();
      const [p] = await svGet('profiles?select=id,username,display_name&username=eq.' + encodeURIComponent(name));
      if (!p) throw new Error('No existe ese usuario en Starvios');
      dmThread(p, (convs.get(p.id) || { msgs: [] }).msgs.slice().reverse());
    }));
    return [nw, card];
  },

  async notifs() {
    const rows = await svAuthed('GET', 'notifications?select=id,kind,coins,body,is_read,created_at,actor:profiles!notifications_actor_id_fkey(username,display_name)&order=created_at.desc&limit=40');
    const icons = { live: '🔴', follow: '❤️', sub: '⭐', member: '⭐', gift: '🎁', starvies: '💫', comment: '💬', mention: '@', like: '👍', raid: '🚀' };
    const card = el('div', 'card');
    const unread = (rows || []).filter((n) => !n.is_read).length;
    card.append(el('h3', null, `🔔 Notificaciones${unread ? ' (' + unread + ' sin leer)' : ''}`));
    if (unread) card.append(modBtn('Marcar todas como leídas', '', async () => { await svAuthed('PATCH', 'notifications?is_read=eq.false', { is_read: true }); refreshContent(); }));
    for (const n of rows || []) {
      const li = el('div', 'li' + (n.is_read ? '' : ' unread'));
      const who = n.actor ? (n.actor.display_name || n.actor.username) + ' ' : '';
      li.append(el('span', null, icons[n.kind] || '🔔'), el('span', 'grow', who + (n.body || n.kind) + (n.coins ? ` (${n.coins} ⭐)` : '')), el('span', 'sub', ago(n.created_at)));
      card.append(li);
    }
    if (!(rows || []).length) card.append(el('p', 'empty', 'No tienes notificaciones.'));
    return [card];
  },

  async obs() {
    const card = el('div', 'card');
    card.append(el('h3', null, '🎥 Probar alertas de OBS'), el('p', 'sub', 'Envía una alerta de prueba a tu fuente de alertas de Starvios en OBS; aparecerá en unos segundos.'));
    const row = el('div', 'row');
    for (const [kind, label] of [['follow', '❤️ Seguidor'], ['sub', '⭐ Suscripción'], ['gift', '🎁 Subs regaladas'], ['starvies', '💫 Starvies'], ['raid', '🚀 Raid']]) {
      row.append(modBtn(label, '', async () => { await svAuthed('POST', 'rpc/send_obs_test_alert', { _kind: kind }); toast(`Prueba de "${label}" enviada a OBS`); }));
    }
    card.append(row);
    return [card];
  },

  async live() {
    const me = svAuth.userId;
    const [r] = await svGet(`live_streams?select=id,title,description,category,is_members_only,slow_mode_seconds,save_recording&order=started_at.desc&limit=1&channel_id=eq.${me}`);
    if (!r) throw new Error('Tu cuenta de Starvios no tiene canal de directos');
    const card = el('div', 'card');
    card.append(el('h3', null, '⚙️ Ajustes del directo'));
    const desc = el('textarea', 'tl-textarea');
    desc.rows = 4;
    desc.value = r.description || '';
    desc.placeholder = 'Descripción del directo';
    const sw = (label, val) => { const l = el('label', 'toggle'); const i = el('input'); i.type = 'checkbox'; i.checked = !!val; l.append(i, label); return l; };
    const members = sw('Solo miembros (suscriptores) pueden ver', r.is_members_only);
    const save = sw('Guardar la grabación como VOD', r.save_recording);
    card.append(field('Descripción', desc), members, save, el('p', 'sub', 'El título y la categoría se cambian en 🎬 Directo.'), modBtn('Guardar', 'accent', async () => {
      await svAuthed('POST', 'rpc/update_live_settings', {
        _title: r.title || 'Mi directo', _description: desc.value, _category: r.category || 'Charla', _thumbnail_url: '',
        _members_only: members.querySelector('input').checked, _slow: r.slow_mode_seconds || 0, _save: save.querySelector('input').checked,
      });
      toast('Ajustes del directo guardados');
    }));
    return [card];
  },
};

/* ---------- Starvios: editor de comandos ---------- */
function commandEditor(c, PERMS, save) {
  const dlg = $('#user-card');
  const sheet = el('div', 'sheet uc');
  const name = textInput(30, 'saludo');
  const aliases = textInput(120, 'hola, hi (opcional)');
  const resp = el('textarea', 'tl-textarea');
  resp.rows = 3;
  resp.maxLength = 500;
  resp.placeholder = 'Lo que responde el bot. Ej.: ¡Hola {user}! Bienvenido al directo';
  const perm = el('select');
  for (const [v, l] of PERMS) perm.append(new Option(l, v));
  const gcd = el('input');
  gcd.type = 'number';
  gcd.min = '0';
  const ucd = el('input');
  ucd.type = 'number';
  ucd.min = '0';
  const replyL = el('label', 'toggle');
  const reply = el('input');
  reply.type = 'checkbox';
  replyL.append(reply, 'Responder mencionando al usuario');
  if (c) {
    name.value = c.name; aliases.value = (c.aliases || []).join(', '); resp.value = c.response; perm.value = c.permission;
    gcd.value = c.global_cooldown || 0; ucd.value = c.user_cooldown || 0; reply.checked = !!c.reply_to_user;
  } else { gcd.value = 5; ucd.value = 0; perm.value = 'everyone'; }
  const row = el('div', 'row end');
  row.append(modBtn('Cancelar', '', () => dlg.close()), modBtn('Guardar', 'accent', async () => {
    const n = name.value.trim().replace(/^!/, '').toLowerCase();
    if (!/^[a-z0-9_áéíóúñ]{1,30}$/.test(n) || !resp.value.trim()) throw new Error('Pon un nombre (sin espacios) y una respuesta');
    await save({ ...(c || {}), name: n, aliases: aliases.value.split(/[\s,]+/).map((a) => a.replace(/^!/, '').toLowerCase()).filter(Boolean),
      response: resp.value.trim(), permission: perm.value, global_cooldown: gcd.value, user_cooldown: ucd.value, reply_to_user: reply.checked,
      enabled: c ? c.enabled : true });
    dlg.close();
    toast('Comando guardado');
    refreshContent();
  }));
  sheet.append(el('h2', null, c ? '✎ Editar comando' : '＋ Nuevo comando'), field('Comando (sin !)', name), field('Alias', aliases), field('Respuesta', resp),
    field('Quién puede usarlo', perm), field('Espera entre usos (segundos)', gcd), field('Espera por usuario (segundos)', ucd), replyL, row);
  dlg.replaceChildren(sheet);
  dlg.showModal();
}

/* ---------- Starvios: conversación privada ---------- */
function dmThread(other, msgs) {
  const dlg = $('#user-card');
  const sheet = el('div', 'sheet uc');
  const me = svAuth.userId;
  const head = el('div', 'sheet-head');
  const x = el('button', 'icon-btn small', '✕');
  x.type = 'button';
  x.addEventListener('click', () => dlg.close());
  head.append(el('strong', 'grow', '✉️ ' + (other.display_name || other.username)), x);
  const list = el('div', 'dm-list');
  for (const m of msgs) {
    const b = el('div', 'dm ' + (m.sender_id === me ? 'mine' : 'theirs'));
    b.append(el('div', null, m.body), el('div', 'sub', fmtTime(new Date(m.created_at))));
    list.append(b);
  }
  const form = el('div', 'inline-form');
  const input = el('input');
  input.placeholder = 'Escribe un mensaje…';
  input.maxLength = 1000;
  form.append(input, modBtn('Enviar', 'accent', async () => {
    const body = input.value.trim();
    if (!body) return;
    await svAuthed('POST', 'rpc/send_private_message', { _recipient: other.id, _body: body });
    const b = el('div', 'dm mine');
    b.append(el('div', null, body), el('div', 'sub', fmtTime(new Date())));
    list.append(b);
    list.scrollTop = list.scrollHeight;
    input.value = '';
  }));
  sheet.append(head, list, form);
  dlg.replaceChildren(sheet);
  dlg.showModal();
  list.scrollTop = list.scrollHeight;
  // Marca como leídos los mensajes recibidos
  svAuthed('PATCH', `private_messages?recipient_id=eq.${me}&sender_id=eq.${other.id}&read_at=is.null`, { read_at: new Date().toISOString() }).catch(() => {});
}

/* ---------- Starvios: subir un archivo a su almacenamiento ---------- */
async function svUpload(bucket, path, file) {
  if (Date.now() > svAuth.expiresAt - 60000) await svAuthed('GET', 'profiles?select=id&limit=1'); // renueva la sesión si hace falta
  const r = await fetch(`https://naiijcvngtkkocligwvk.supabase.co/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { apikey: SV_KEY, Authorization: 'Bearer ' + svAuth.access, 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' },
    body: file,
  });
  if (!r.ok) throw new Error('No se pudo subir la imagen (' + r.status + ')');
}

PAGE_HOOKS.content = { open: renderContent };
