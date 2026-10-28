/* =========================================================
   ⚙ Ajustes: pestañas y 📝 Novedades (notas de versión)
   Usa funciones de app.js ($, store, toast, sources…).
   ========================================================= */

// Al publicar una versión nueva: agrega su entrada arriba (y sube CACHE en sw.js)
const RELEASES = [
  {
    v: '3.1', date: '2026-10-27', title: 'Moderación más clara entre canales',
    items: [
      'El menú de cada mensaje dice en qué canal se aplican las acciones de moderación (solo en ese).',
      'Chat compartido de Twitch: los bans y timeouts hechos en otro canal ya no aparecen repetidos en cada uno de tus canales; si vienen de un canal que no tienes en Chat M, dice "(en canal · chat compartido)".',
    ],
  },
  {
    v: '3.0', date: '2026-10-27', title: 'Varios directos a la vez',
    items: [
      '📺 Hasta 4 directos al mismo tiempo: toca los canales de arriba para agregarlos o quitarlos; se acomodan solos para verse lo más grande posible.',
      'Solo uno suena: el botón 🔊 de cada video le da el sonido y silencia a los demás. En Twitch y Starvios también funciona si le subes el volumen desde su reproductor.',
      'El que tiene sonido se marca con borde verde.',
      'Nuevo selector de tamaño (chico, mediano, grande) y una barrita debajo para arrastrar y ajustar la altura a tu gusto (doble toque = mediano).',
    ],
  },
  {
    v: '2.9', date: '2026-10-27', title: 'Ver el directo desde el chat',
    items: [
      'Botón 📺 arriba del chat: muestra el directo de cualquiera de tus canales visibles, de Twitch, Kick o Starvios.',
      'También los canales del chat compartido; tocar un canal en la barra 🤝 abre su directo.',
      'Empieza sin sonido para que no se oiga tu propio directo con eco; súbele desde el reproductor.',
      'Tres tamaños, botón para abrirlo en su página y recuerda el último canal que viste.',
    ],
  },
  {
    v: '2.8', date: '2026-10-23', title: 'Chat compartido de Twitch, ahora sí',
    items: [
      'Al detectar un chat compartido, Chat M entra también al chat de los otros canales y muestra sus mensajes en el tuyo (con su color y etiqueta 🤝), sin repetirlos.',
      'Con tu sesión de Twitch también los recibe por EventSub, que dice de qué canal viene cada mensaje.',
      'Revisa cada minuto si alguno de tus canales empezó o terminó un chat compartido, aunque se pierda el aviso.',
      'Los mensajes que Twitch marca como "solo en su canal" no se muestran, igual que en Twitch.',
      'Necesita volver a iniciar sesión en Twitch una vez (⚙ → Cuentas) para el permiso nuevo de leer el chat.',
    ],
  },
  {
    v: '2.7', date: '2026-10-22', title: 'Canjes renovados y arreglos del Panel',
    items: [
      '🏆 Canjes con dos vistas: 📥 Solicitudes y 🏆 Recompensas, de todos tus canales juntos (🌐 Todos) o de uno solo.',
      'Solicitudes filtradas por estado (por revisar, completados, devueltos), con botones para completar o devolver puntos de una o de todas.',
      'Editor completo de recompensas: nombre, costo, descripción, color, pedir texto, pausar, completar automáticamente, límites y tiempos de espera.',
      'Se quitó "Canjear como espectador" de Starvios.',
      'Panel: arreglado el error "started_at" del ranking de bits en tu canal.',
      'Las filas de canales y pestañas ya no regresan al inicio al elegir una opción.',
      'Las tarjetas del Panel se acomodan sin espacios vacíos.',
    ],
  },
  {
    v: '2.6', date: '2026-10-22', title: 'Ajustes ordenados y Novedades',
    items: [
      'Ajustes en pestañas: Canales, Cuentas, Vista, Avanzado y Novedades.',
      'Cada cuenta muestra si está conectada o si le falta algún permiso.',
      'Vista previa del tamaño de letra y guía de colores del chat.',
      'Botón para buscar actualizaciones de la app.',
      'Esta sección de Novedades: el ⚙ avisa cuando hay una versión nueva.',
    ],
  },
  {
    v: '2.5', date: '2026-10-22', title: 'Respuestas, menciones y chat compartido',
    items: [
      'Las respuestas muestran el mensaje original; tócalo para saltar a él.',
      'Fondo amarillo cuando te mencionan y azul cuando te responden.',
      'Chat compartido de Twitch: barra con los canales participantes, avisos al empezar, entrar, salir y terminar, y un color por canal.',
    ],
  },
  {
    v: '2.4', date: '2026-10-18', title: 'Arreglos de diseño',
    items: [
      'Ya no se tapan los canales, selectores ni el panel de emojis.',
      'En el celular la vista ya no se encoge ni deja un espacio negro.',
      'Botones más fáciles de tocar en pantallas táctiles.',
    ],
  },
  {
    v: '2.3', date: '2026-10-18', title: 'Contenido y mejoras del chat',
    items: [
      '🎞 Contenido: clips, VODs, marcadores, calendario y canales en vivo; en Starvios también comandos, emotes, mensajes privados, notificaciones, alertas de OBS y ajustes del directo.',
      'Insignias reales de Twitch e imágenes animadas de bits.',
      'Barra del mensaje fijado, susurros y color de tu nombre.',
    ],
  },
  {
    v: '2.2', date: '2026-10-18', title: 'Moderar y Panel',
    items: [
      '🛡 Moderar: desbaneos, sospechosos, baneados, quién está en el chat, mods y VIPs, términos bloqueados, AutoMod, registro y modo escudo.',
      'Tarjeta de usuario desde cualquier mensaje.',
      '📊 Panel en vivo: espectadores, seguidores, subs, metas, Hype Train y rankings.',
    ],
  },
  {
    v: '2.0', date: '2026-10-18', title: 'Rediseño',
    items: [
      'Menú de secciones a un lado (abajo en el celular).',
      'En pantallas anchas el chat queda visible junto a la sección abierta.',
    ],
  },
  {
    v: '1.6', date: '2026-10-16', title: 'Emojis y emotes',
    items: [
      'Selector de emojis y emotes de cada plataforma.',
      'Canjear recompensas como espectador en Starvios.',
      'El teclado ya no se abre solo al poner emojis.',
    ],
  },
  {
    v: '1.5', date: '2026-10-16', title: 'AutoMod y canjes',
    items: [
      'Los mensajes retenidos por AutoMod aparecen con Permitir / Rechazar.',
      'Canjes pendientes, completar, devolver puntos y gestionar recompensas.',
    ],
  },
  {
    v: '1.4', date: '2026-10-14', title: 'Herramientas',
    items: [
      '🧰 Encuestas, predicciones, anuncios, marcadores, publicidad, modos del chat, raid, shoutout y clips.',
      'Primer soporte del chat compartido de Twitch.',
    ],
  },
  {
    v: '1.3', date: '2026-10-14', title: 'Directo',
    items: [
      '🎬 Cambia título, categoría y tags en una o varias plataformas a la vez.',
      '12 categorías favoritas y 3 recientes.',
      'Tags de Starvios y tarjeta de Kick con su estado actual.',
    ],
  },
  {
    v: '1.2', date: '2026-10-14', title: 'Eventos y enviar a todos',
    items: [
      'Eventos: subs, raids, regalos, bits, follows, canjes y donaciones.',
      'Enviar el mismo mensaje a todos los canales visibles.',
      'Mensajes ordenados por hora y Starvios en rosa.',
    ],
  },
  {
    v: '1.1', date: '2026-10-14', title: 'Varios canales',
    items: [
      'Varios canales por plataforma con una sola cuenta.',
      'Conexión de Kick más estable.',
      'La app busca sola la versión más reciente.',
    ],
  },
  {
    v: '1.0', date: '2026-10-13', title: 'Primera versión',
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
}

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
    // Compara la versión publicada con la que está abierta
    const src = await fetch('settings.js', { cache: 'no-store' }).then((r) => r.text());
    const m = src.match(/v: '([\d.]+)'/);
    if (m && m[1] !== APP_VERSION) {
      note.textContent = `Hay una versión nueva (${m[1]}). Recargando…`;
      setTimeout(() => location.reload(), 800);
    } else note.textContent = `Ya tienes la última versión (${APP_VERSION}).`;
  } catch {
    note.textContent = 'Sin conexión; inténtalo más tarde.';
  } finally { e.target.disabled = false; }
});

/* ---------- 📝 Novedades ---------- */
const SEEN_KEY = 'seenVersion';
const verNum = (v) => v.split('.').map(Number).reduce((a, n) => a * 1000 + n, 0);

function unseenReleases() {
  const seen = store.get(SEEN_KEY, null);
  if (!seen) return 0;
  return RELEASES.filter((r) => verNum(r.v) > verNum(seen)).length;
}

function markNewsSeen() {
  store.set(SEEN_KEY, APP_VERSION);
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
    if (seen && verNum(r.v) > verNum(seen)) {
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
// Instalación nueva: no hay novedades que avisar
if (!store.get(SEEN_KEY, null) && !sources().length) store.set(SEEN_KEY, APP_VERSION);
// Quien ya usaba la app antes de esta sección ve las novedades de esta versión
if (!store.get(SEEN_KEY, null)) store.set(SEEN_KEY, RELEASES[1].v);
renderReleaseNotes();
updateNewsBadge();
if (unseenReleases()) toast(`Chat M se actualizó a la v${APP_VERSION}. Mira las novedades en ⚙ Ajustes.`);
