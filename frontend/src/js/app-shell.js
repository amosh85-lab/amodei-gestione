// App shell helpers: dynamic header, bottom nav, simple chrome toggles.

import { icon } from './icons.js';
import { navigate, currentPath } from './router.js';
import { showToast, confirmDialog } from './components.js';
import { logout } from './auth.js';

const NAV_TABS = [
  { id: 'home',      label: 'Home',      iconName: 'home',      route: '/' },
  { id: 'cassa',     label: 'Cassa',     iconName: 'cash',      route: '/cassa' },
  { id: 'menu',      label: 'Menu',      iconName: 'edit',      route: '/menu' },
  { id: 'magazzino', label: 'Magazzino', iconName: 'inventory', route: '/magazzino' },
  { id: 'settings',  label: 'Impost.',   iconName: 'settings',  route: '/impostazioni' },
];

/**
 * Render the dynamic header.
 * @param {Object} opts
 * @param {string} opts.title - displayed title
 * @param {boolean} [opts.brand=true] - true = full terracotta header
 * @param {string|null} [opts.backHref=null] - if set, shows a back chevron
 * @param {{label:string, iconName:string, onClick:Function}[]} [opts.actions=[]]
 */
export function setHeader({ title, brand = true, backHref = null, actions = [] }) {
  const headerEl = document.getElementById('app-header');
  if (!headerEl) return;
  const backBtn = backHref
    ? `<button type="button" class="btn btn--ghost btn--icon" id="hdr-back" aria-label="Indietro" style="color:inherit">${icon('chevron-left', { size: 22 })}</button>`
    : '';
  const actionsHtml = (actions || [])
    .map((a, i) => (
      `<button type="button" class="btn btn--ghost btn--icon" data-action-idx="${i}" aria-label="${escapeAttr(a.label)}" style="color:inherit">${icon(a.iconName, { size: 22 })}</button>`
    ))
    .join('');

  headerEl.className = `header${brand ? ' header--brand' : ''}`;
  headerEl.innerHTML = `${backBtn}<h1 class="header__title">${escapeHtml(title)}</h1><div class="header__actions">${actionsHtml}</div>`;
  headerEl.style.display = '';

  if (backHref) {
    headerEl.querySelector('#hdr-back').addEventListener('click', (ev) => {
      ev.preventDefault();
      navigate(backHref);
    });
  }
  headerEl.querySelectorAll('[data-action-idx]').forEach((btn) => {
    const idx = parseInt(btn.dataset.actionIdx, 10);
    const a = actions[idx];
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      a.onClick(ev);
    });
  });
}

export function showHeader(show = true) {
  const headerEl = document.getElementById('app-header');
  if (headerEl) headerEl.style.display = show ? '' : 'none';
}

/** Render the bottom nav and highlight the active tab based on current route. */
export function renderNav() {
  const navEl = document.getElementById('app-nav');
  if (!navEl) return;
  const path = currentPath().split('?')[0];
  navEl.innerHTML = NAV_TABS.map((tab) => {
    const active =
      path === tab.route ||
      (tab.route !== '/' && path.startsWith(`${tab.route}/`));
    return `<a class="nav-item ${active ? 'nav-item--active' : ''}" href="#" data-tab="${tab.id}" aria-label="${escapeAttr(tab.label)}">${icon(tab.iconName, { size: 24 })}<span>${tab.label}</span></a>`;
  }).join('');
  navEl.querySelectorAll('[data-tab]').forEach((el) => {
    const tab = NAV_TABS.find((t) => t.id === el.dataset.tab);
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (tab.wip) {
        showToast(`${tab.label} arriva nei prossimi prompt`, 'info');
        return;
      }
      navigate(tab.route);
    });
  });
}

export function showNav(show = true) {
  const navEl = document.getElementById('app-nav');
  const contentEl = document.getElementById('app');
  if (navEl) navEl.style.display = show ? '' : 'none';
  if (contentEl) contentEl.classList.toggle('app-content--no-nav', !show);
}

/** Confirm + logout (shown from a header action). */
export async function confirmLogout() {
  const ok = await confirmDialog(
    'Vuoi uscire?',
    'Tornerai alla schermata di accesso.',
    { confirmLabel: 'Esci', cancelLabel: 'Annulla', danger: true },
  );
  if (ok) logout();
}

// --- escaping helpers (kept local so this module has no external deps) ---

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}
