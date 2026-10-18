'use strict';

/* =========================================================
   Navegación entre secciones
   - Pantalla ancha: el chat queda a la izquierda y la sección
     elegida se abre a su lado (para moderar sin perder el chat).
   - Pantalla angosta (tablet vertical, celular): una sección a la
     vez y el menú pasa abajo.
   Cada módulo registra open()/close() en PAGE_HOOKS.
   ========================================================= */
const PAGES = { chat: 'view-chat', mod: 'page-mod', panel: 'page-panel', tools: 'tools', stream: 'stream', content: 'page-content' };
const PAGE_HOOKS = {};
let currentPage = 'chat';

function showPage(id) {
  if (!PAGES[id]) return;
  const prev = currentPage;
  if (prev !== id) {
    if (PAGE_HOOKS[prev] && PAGE_HOOKS[prev].close) PAGE_HOOKS[prev].close();
    // Directo y Herramientas escuchan "close" (antes eran ventanas flotantes)
    if (prev !== 'chat') $('#' + PAGES[prev]).dispatchEvent(new Event('close'));
  }
  for (const [key, secId] of Object.entries(PAGES)) {
    if (key !== 'chat') $('#' + secId).hidden = key !== id;
  }
  currentPage = id;
  $('#workspace').dataset.page = id;
  for (const b of document.querySelectorAll('#rail [data-page]')) {
    if (b.dataset.page === id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  if (prev !== id && PAGE_HOOKS[id] && PAGE_HOOKS[id].open) PAGE_HOOKS[id].open();
}

// Directo y Herramientas siguen llamando showModal()/close() como cuando eran ventanas
for (const id of ['stream', 'tools']) {
  const sec = $('#' + id);
  sec.showModal = () => showPage(id);
  sec.close = () => showPage('chat');
}

// Botones del menú (Directo y Herramientas tienen su propio botón que los prepara y abre)
for (const b of document.querySelectorAll('#rail [data-page]')) {
  if (b.id === 'btn-stream' || b.id === 'btn-tools') continue;
  b.addEventListener('click', () => showPage(b.dataset.page));
}

// Botón ✕ de cada sección: vuelve al chat
document.addEventListener('click', (e) => {
  const close = e.target.closest('.page-close');
  if (close && !close.id) showPage('chat');
});

// Contador de pendientes en "Moderar" (AutoMod, solicitudes de desbaneo…)
function setModBadge(n) {
  const b = $('#badge-mod');
  b.hidden = !n;
  b.textContent = n > 99 ? '99+' : String(n);
}

// Encabezado común de las secciones nuevas
function pageHeader(icon, title, subtitle) {
  const h = el('header', 'st-head');
  const t = el('div');
  t.append(el('h2', null, `${icon} ${title}`));
  if (subtitle) t.append(el('p', 'note', subtitle));
  const x = el('button', 'icon-btn page-close', '✕');
  x.type = 'button';
  x.setAttribute('aria-label', 'Cerrar');
  h.append(t, x);
  return h;
}
