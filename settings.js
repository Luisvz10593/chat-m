/* =========================================================
   ⚙ Ajustes: pestañas y 📝 Novedades (notas de versión)
   Usa funciones de app.js ($, store, toast, sources…).
   ========================================================= */

// Notas de versión: UNA versión por día. Si hay más cambios el mismo día, se
// agregan a la versión de ese día (la de arriba) en vez de crear otra; el ⚙
// vuelve a avisar porque cuenta cuántas novedades has visto de ese día.
// Un día nuevo = versión nueva arriba con el número siguiente (y subir CACHE en sw.js).
const RELEASES = [
  {
    v: '9', date: '2026-11-12', title: 'Kick completo y el chat ya no se borra',
    items: [
      'Antes solo se guardaban los últimos 400 mensajes y en chats rápidos los viejos desaparecían. Ahora por defecto no se borra nada.',
      'Nuevo en ⚙ Vista → 🧹 Borrar mensajes viejos: Nunca, 15 min, 1 hora, 3 horas o Personalizado (los minutos que quieras).',
      'Si estás leyendo mensajes de arriba, el chat ya no brinca cuando se quitan los viejos. Solo si llega a 10 000 mensajes se quitan los más viejos, para que la tablet no se ponga lenta.',
      '🏆 Canjes de Kick: ahora revisa todas las páginas de la lista de Kick (antes podía quedarse viendo solo los viejos).',
      '💚 Donaciones de KICKs: avisa en el chat quién dio KICKs y cuántos (se revisa cada 15 s con tu sesión de Kick).',
      '🎁 Subs regaladas en Kick: avisa quién regaló y cuántas (cada 30 s, en todos tus canales de Kick).',
      'En ⚙ Avanzado → Diagnóstico se ve si cada revisión de Kick está funcionando o qué permiso falta.',
      '📝 Novedades: ahora hay una versión por día; los cambios del mismo día se juntan en una sola.',
    ],
  },
  {
    v: '8', date: '2026-11-09', title: 'YouTube, TikTok y canjes en el chat',
    items: [
      '▶ YouTube: lee el chat de tu canal (y otros, o el enlace de un directo); con tu sesión de Google también escribes, borras, das timeout y baneas. Muestra Super Chats, Super Stickers, miembros nuevos y membresías regaladas.',
      'YouTube gasta cuota de Google (10 000 unidades gratis al día): elige la velocidad de lectura en ⚙ Cuentas y ahí ves cuánto llevas.',
      '🎵 TikTok LIVE (solo lectura, con una clave gratis de Euler Stream): mensajes, regalos, follows, suscripciones y preguntas; "me gusta" y entradas opcionales en ⚙ Vista.',
      'El reproductor 📺 también muestra los directos de YouTube; TikTok no deja verse dentro de otras páginas (botón ↗ para abrirlo).',
      '🏆 Los canjes vuelven a decir quién y qué canjeó: en Starvios con el nombre y costo de la recompensa, en Twitch el mensaje lleva el nombre del canje, y en Kick ahora aparecen (con tu sesión de Kick).',
      'Twitch: los eventos de tu canal (canjes primero) ya no se quedan fuera cuando moderas muchos canales. En ⚙ Avanzado → Diagnóstico ves cuántos hay.',
    ],
  },
  {
    v: '7', date: '2026-10-27', title: 'Ver directos desde el chat y moderación más clara',
    items: [
      '📺 Botón arriba del chat para ver el directo de tus canales (Twitch, Kick y Starvios) y de los del chat compartido; tocar un canal en la barra 🤝 lo abre.',
      'Hasta 4 directos al mismo tiempo: toca los canales de arriba para agregarlos o quitarlos; se acomodan solos para verse lo más grande posible.',
      'Solo uno suena: el botón 🔊 de cada video le da el sonido y silencia a los demás (en Twitch y Starvios también si le subes desde su reproductor). El que suena tiene borde verde.',
      'Empieza sin sonido para que no se oiga tu propio directo con eco.',
      'Selector de tamaño (chico, mediano, grande) y una barrita debajo para arrastrar la altura (doble toque = mediano).',
      'El menú de cada mensaje dice en qué canal se aplican las acciones de moderación (solo en ese).',
      'Chat compartido de Twitch: los bans y timeouts hechos en otro canal ya no aparecen repetidos en cada uno de tus canales.',
    ],
  },
  {
    v: '6', date: '2026-10-23', title: 'Chat compartido de Twitch, ahora sí',
    items: [
      'Al detectar un chat compartido, Chat M entra también al chat de los otros canales y muestra sus mensajes en el tuyo (con su color y etiqueta 🤝), sin repetirlos.',
      'Con tu sesión de Twitch también los recibe por EventSub, que dice de qué canal viene cada mensaje.',
      'Revisa cada minuto si alguno de tus canales empezó o terminó un chat compartido, aunque se pierda el aviso.',
      'Los mensajes que Twitch marca como "solo en su canal" no se muestran, igual que en Twitch.',
      'Necesita volver a iniciar sesión en Twitch una vez (⚙ → Cuentas) para el permiso nuevo de leer el chat.',
    ],
  },
  {
    v: '5', date: '2026-10-22', title: 'Respuestas, Ajustes nuevos y canjes renovados',
    items: [
      'Las respuestas muestran el mensaje original; tócalo para saltar a él.',
      'Fondo amarillo cuando te mencionan y azul cuando te responden.',
      'Chat compartido de Twitch: barra con los canales participantes, avisos al empezar, entrar, salir y terminar, y un color por canal.',
      'Ajustes en pestañas: Canales, Cuentas, Vista, Avanzado y Novedades; cada cuenta muestra si está conectada o le falta algún permiso.',
      'Vista previa del tamaño de letra, guía de colores del chat y botón para buscar actualizaciones.',
      'Esta sección de Novedades: el ⚙ avisa cuando hay una versión nueva.',
      '🏆 Canjes con dos vistas: 📥 Solicitudes y 🏆 Recompensas, de todos tus canales juntos o de uno solo; completar o devolver puntos de una o de todas.',
      'Editor completo de recompensas: nombre, costo, descripción, color, pedir texto, pausar, completar automáticamente, límites y tiempos de espera.',
      'Panel: arreglado el error "started_at" del ranking de bits; las tarjetas se acomodan sin espacios vacíos.',
      'Las filas de canales y pestañas ya no regresan al inicio al elegir una opción.',
    ],
  },
  {
    v: '4', date: '2026-10-18', title: 'Rediseño: Moderar, Panel y Contenido',
    items: [
      'Menú de secciones a un lado (abajo en el celular); en pantallas anchas el chat queda visible junto a la sección abierta.',
      '🛡 Moderar: desbaneos, sospechosos, baneados, quién está en el chat, mods y VIPs, términos bloqueados, AutoMod, registro y modo escudo. Tarjeta de usuario desde cualquier mensaje.',
      '📊 Panel en vivo: espectadores, seguidores, subs, metas, Hype Train y rankings.',
      '🎞 Contenido: clips, VODs, marcadores, calendario y canales en vivo; en Starvios también comandos, emotes, mensajes privados, notificaciones, alertas de OBS y ajustes del directo.',
      'Insignias reales de Twitch, imágenes animadas de bits, barra del mensaje fijado, susurros y color de tu nombre.',
      'Arreglos de diseño: ya no se tapan canales, selectores ni emojis; en el celular la vista ya no se encoge; botones más fáciles de tocar.',
    ],
  },
  {
    v: '3', date: '2026-10-16', title: 'AutoMod, canjes y emojis',
    items: [
      'Los mensajes retenidos por AutoMod aparecen con Permitir / Rechazar.',
      'Canjes pendientes, completar, devolver puntos y gestionar recompensas.',
      'Selector de emojis y emotes de cada plataforma; el teclado ya no se abre solo al poner emojis.',
    ],
  },
  {
    v: '2', date: '2026-10-14', title: 'Varios canales, eventos, Directo y Herramientas',
    items: [
      'Varios canales por plataforma con una sola cuenta; conexión de Kick más estable; la app busca sola la versión más reciente.',
      'Eventos: subs, raids, regalos, bits, follows, canjes y donaciones.',
      'Enviar el mismo mensaje a todos los canales visibles; mensajes ordenados por hora y Starvios en rosa.',
      '🎬 Directo: cambia título, categoría y tags en una o varias plataformas a la vez; 12 categorías favoritas y 3 recientes.',
      '🧰 Herramientas: encuestas, predicciones, anuncios, marcadores, publicidad, modos del chat, raid, shoutout y clips.',
    ],
  },
  {
    v: '1', date: '2026-10-13', title: 'Primera versión',
    items: [
      'Chat de Twitch, Kick y Starvios en una sola lista.',
      'Responder, borrar, timeout y ban en las tres plataformas.',
    ],
  },
];
const APP_VERSION = RELEASES[0].v;

/* ---------- Pestañas ---------- */
const SET_TABS = [...document.querySelectorAll('#settings [data-stab]')];
let settingsTab = 'channels';

function showSettingsTab(name) {
  settingsTab = name;
  for (const b of SET_TABS) b.setAttribute('aria-selected', String(b.dataset.stab === name));
  for (const p of document.querySelectorAll('#settings [data-spanel]')) p.hidden = p.dataset.spanel !== name;
  $('#settings .set-body').scrollTop = 0;
  if (name === 'news') markNewsSeen();
}
for (const b of SET_TABS) b.addEventListener('click', () => showSettingsTab(b.dataset.stab));

// Lo llama openSettings (app.js) al abrir
function onSettingsOpen(tab) {
  showSettingsTab(tab || (!sources().length ? 'channels' : unseenReleases() ? 'news' : settingsTab));
  updateFontPreview();
  if (auth) renderColorRow(); // color de tu nombre (chatplus.js)
  renderClearChoice();
  updateDiag();
}

/* ---------- Diagnóstico (Avanzado) ---------- */
function updateDiag() {
  // Eventos de Twitch: cuántas suscripciones hay y el último error
  const d = $('#diag-twitch');
  if (d) {
    d.textContent = !auth ? 'Eventos de Twitch: inicia sesión con Twitch.'
      : `Eventos de Twitch: ${esSubscribed.size} activos (máx. ~300)`
        + (esStats.skipped ? ` · ${esStats.skipped} no cupieron (los menos importantes de otros canales)` : '')
        + (esStats.lastError ? ` · último error: ${esStats.lastError}` : '');
  }
  // Kick: canjes, KICKs y subs regaladas (revisiones periódicas)
  const k = $('#diag-kick');
  if (k) {
    k.textContent = !kickAuth ? 'Kick: inicia sesión con Kick para ver canjes y KICKs.'
      : `Kick · canjes: ${kickDiag.redeems || 'esperando…'} · KICKs: ${kickDiag.kicks || 'esperando…'}`
        + (kickDiag.gifts ? ` · subs regaladas: ${kickDiag.gifts}` : '');
  }
  // TikTok: si hay clave
  const tt = $('#acct-tiktok');
  if (tt) {
    const has = !!($('#settings-form').elements.tiktokApiKey.value.trim() || cfg.tiktokApiKey);
    tt.dataset.state = has ? 'on' : 'off';
    tt.querySelector('.acct-state').textContent = has ? 'Clave lista' : 'Sin clave';
  }
}
$('#btn-diag-tiktok').addEventListener('click', () => {
  const box = $('#diag-tiktok');
  box.hidden = !box.hidden;
  box.textContent = ttDiag.length ? ttDiag.join('\n') : 'Todavía no ha llegado nada de TikTok. Revisa que el usuario esté en directo y que la clave de Euler sea correcta.';
});

/* ---------- Borrar mensajes viejos (Vista) ---------- */
function renderClearChoice() {
  const form = $('#settings-form');
  const mode = form.elements.chatClearMode.value || 'off';
  for (const b of document.querySelectorAll('#clear-choice button')) b.setAttribute('aria-checked', String(b.dataset.v === mode));
  $('#clear-custom').hidden = mode !== 'custom';
  const mins = mode === 'custom' ? Number(form.elements.chatClearCustom.value) || 0 : Number(mode) || 0;
  $('#clear-note').textContent = mode === 'off'
    ? 'Los mensajes se quedan todo el directo. (Solo si el chat llega a 10 000 se quitan los más viejos, para que la tablet no se ponga lenta.)'
    : `Cada medio minuto se quitan los mensajes con más de ${mins >= 60 && mins % 60 === 0 ? mins / 60 + (mins === 60 ? ' hora' : ' horas') : mins + ' min'}.`;
}
for (const b of document.querySelectorAll('#clear-choice button')) {
  b.setAttribute('role', 'radio');
  b.addEventListener('click', () => { $('#settings-form').elements.chatClearMode.value = b.dataset.v; renderClearChoice(); });
}
$('#settings-form').elements.chatClearCustom.addEventListener('input', renderClearChoice);

/* ---------- Vista ---------- */
function updateFontPreview() {
  const v = $('#settings-form').elements.fontSize.value;
  $('#fs-val').textContent = v + ' px';
  $('#fs-preview').style.fontSize = v + 'px';
}
$('#settings-form').elements.fontSize.addEventListener('input', updateFontPreview);

/* ---------- Cuentas ---------- */
$('#copy-redirect').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(redirectUrl()); toast('URL copiada'); }
  catch { toast('No se pudo copiar; mantenla presionada para copiarla.', true); }
});

/* ---------- Avanzado: buscar actualización ---------- */
$('#btn-update').addEventListener('click', async (e) => {
  const note = $('#update-note');
  e.target.disabled = true;
  note.textContent = 'Buscando…';
  try {
    const reg = 'serviceWorker' in navigator && await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update();
    // Cada publicación cambia el nombre de la caché en sw.js (aunque sea el mismo día):
    // si la publicada no es una de las que ya tiene este dispositivo, hay algo nuevo
    const src = await fetch('sw.js', { cache: 'no-store' }).then((r) => r.text());
    const m = src.match(/CACHE = '([^']+)'/);
    const have = 'caches' in window ? await caches.keys() : [];
    if (m && have.length && !have.includes(m[1])) {
      note.textContent = 'Hay una actualización. Recargando…';
      setTimeout(() => location.reload(), 800);
    } else note.textContent = `Ya tienes la última versión (v${APP_VERSION}).`;
  } catch {
    note.textContent = 'Sin conexión; inténtalo más tarde.';
  } finally { e.target.disabled = false; }
});

/* ---------- 📝 Novedades ---------- */
// Lo visto se guarda como { date: día de la última versión vista, count: cuántas novedades tenía }
const SEEN_KEY = 'newsSeen';
const latestSeen = () => ({ date: RELEASES[0].date, count: RELEASES[0].items.length });
const isUnseen = (r, seen) => !!seen && (r.date > seen.date || (r.date === seen.date && r.items.length > seen.count));

function unseenReleases() {
  const seen = store.get(SEEN_KEY, null);
  return RELEASES.filter((r) => isUnseen(r, seen)).length;
}

function markNewsSeen() {
  store.set(SEEN_KEY, latestSeen());
  updateNewsBadge();
}

function updateNewsBadge() {
  const n = unseenReleases();
  const badge = $('#settings-badge');
  badge.hidden = !n;
  badge.textContent = n;
  badge.title = n ? 'Hay novedades en Chat M' : '';
  $('#news-dot').hidden = !n;
}

function fmtReleaseDate(iso) {
  return new Date(iso + 'T12:00').toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
}

function renderReleaseNotes() {
  const seen = store.get(SEEN_KEY, null);
  const box = $('#release-notes');
  box.replaceChildren(...RELEASES.map((r, i) => {
    const card = document.createElement('article');
    card.className = 'rn-card' + (i === 0 ? ' latest' : '');
    const head = document.createElement('div');
    head.className = 'rn-head';
    const ver = document.createElement('span');
    ver.className = 'rn-ver';
    ver.textContent = 'v' + r.v;
    const title = document.createElement('b');
    title.textContent = r.title;
    head.append(ver, title);
    if (isUnseen(r, seen)) {
      const nw = document.createElement('span');
      nw.className = 'rn-new';
      nw.textContent = 'NUEVO';
      head.append(nw);
    }
    const date = document.createElement('span');
    date.className = 'rn-date';
    date.textContent = fmtReleaseDate(r.date);
    head.append(date);
    const ul = document.createElement('ul');
    for (const it of r.items) {
      const li = document.createElement('li');
      li.textContent = it;
      ul.append(li);
    }
    card.append(head, ul);
    return card;
  }));
}

$('#app-version').textContent = 'v' + APP_VERSION;
$('#app-version').title = fmtReleaseDate(RELEASES[0].date);
if (!store.get(SEEN_KEY, null)) {
  // Antes se guardaba el número de versión viejo (1.0 … 3.4): se pasa a su día
  const old = store.get('seenVersion', null);
  const oldDays = { '3.4': '2026-11-12', '3.3': '2026-11-12', '3.2': '2026-11-09', '3.1': '2026-10-27', '3.0': '2026-10-27', '2.9': '2026-10-27', '2.8': '2026-10-23' };
  if (old === '3.4') store.set(SEEN_KEY, latestSeen());                              // ya había visto todo
  else if (old) store.set(SEEN_KEY, { date: oldDays[old] || '2026-10-22', count: 0 }); // ve lo de ese día en adelante
  else if (!sources().length) store.set(SEEN_KEY, latestSeen());                     // instalación nueva: nada que avisar
  else store.set(SEEN_KEY, { date: RELEASES[1].date, count: 0 });
}
renderReleaseNotes();
updateNewsBadge();
if (unseenReleases()) toast(`Chat M se actualizó a la v${APP_VERSION}. Mira las novedades en ⚙ Ajustes.`);
