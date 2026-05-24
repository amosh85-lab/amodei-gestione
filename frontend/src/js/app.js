// Amodei PWA — SPA bootstrap.
// Registers every route, then either:
//   - hands off to the router for an authed session, or
//   - sends the user to /login if no/expired token.

import { apiGet, ApiError } from './api.js';
import { getToken, isTokenValid, setCurrentUser, logout } from './auth.js';
import { showToast } from './components.js';
import { renderNav, showHeader, showNav } from './app-shell.js';
import { route, start, onRoute, navigate } from './router.js';

import { mountLogin } from '../pages/login.js';
import { mountHome } from '../pages/home.js';
import { mountInventoryList } from '../pages/inventory/list.js';
import { mountInventoryDetail } from '../pages/inventory/detail.js';
import { mountInventoryLoad } from '../pages/inventory/load.js';
import { mountInventorySuppliers } from '../pages/inventory/suppliers.js';
import { mountInventoryClose } from '../pages/inventory/close.js';
import { mountMenuList } from '../pages/menu/list.js';
import { mountCombinedEdit } from '../pages/menu/combined-edit.js';
import { mountStaffMealsList } from '../pages/staff-meals/list.js';
import { mountStaffMealsNew } from '../pages/staff-meals/new.js';
import { mountStaffMealsDetail } from '../pages/staff-meals/detail.js';
import { mountStaffMealsStats } from '../pages/staff-meals/stats.js';
import { mountQuickSignal } from '../pages/alerts/quick-signal.js';
import { mountReordersList } from '../pages/reorders/list.js';
import { mountReorderEdit } from '../pages/reorders/edit.js';
import { mountCashPage } from '../pages/cash/index.js';
import { mountCashHistory } from '../pages/cash/history.js';
import { mountCashStats } from '../pages/cash/stats.js';
import { mountReportsWaste } from '../pages/reports/waste.js';
import { mountReportsMargins } from '../pages/reports/margins.js';
import { mountReportsForecast } from '../pages/reports/forecast.js';

// ---------- Dev/test helper: ?token=…&user=… on localhost ----------
// Lets tools/screenshot_pages.py (or DevTools) seed an authenticated
// localStorage without bouncing through an intermediate page.
// Gated to local hostnames so it's a no-op in production.
(function seedAuthFromQuery() {
  const local = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(location.hostname);
  if (!local) return;
  const p = new URLSearchParams(location.search);
  const t = p.get('token');
  const u = p.get('user');
  if (!t && !u) return;
  if (t) localStorage.setItem('amodei.token', t);
  if (u) {
    try { localStorage.setItem('amodei.user', atob(u)); } catch (e) { console.warn('bad user b64', e); }
  }
  // Strip the query so the URL bar / next navigations don't keep the token.
  history.replaceState(null, '', location.pathname + location.hash);
})();

// ---------- Routes ----------

route('/login', mountLogin);
route('/', mountHome, { requires: 'auth' });
route('/magazzino', mountInventoryList, { requires: 'auth' });
route('/magazzino/carico', mountInventoryLoad, { requires: 'auth' });
route('/magazzino/:id', mountInventoryDetail, { requires: 'auth' });
route('/chiusura-serale', mountInventoryClose, { requires: 'auth' });
route('/fornitori', mountInventorySuppliers, { requires: ['admin', 'manager'] });
route('/menu', mountMenuList, { requires: 'auth' });
route('/menu/combined/:id', mountCombinedEdit, { requires: ['admin', 'manager'] });
route('/pasti-staff', mountStaffMealsList, { requires: 'auth' });
route('/pasti-staff/nuovo', mountStaffMealsNew, { requires: 'auth' });
route('/pasti-staff/statistiche', mountStaffMealsStats, { requires: ['admin', 'manager'] });
route('/pasti-staff/:id', mountStaffMealsDetail, { requires: 'auth' });
route('/segnala', mountQuickSignal, { requires: 'auth' });
route('/riordini', mountReordersList, { requires: ['admin', 'manager'] });
route('/riordini/nuovo', mountReorderEdit, { requires: ['admin', 'manager'] });
route('/riordini/:id', mountReorderEdit, { requires: ['admin', 'manager'] });
route('/cassa', mountCashPage, { requires: ['admin', 'manager'] });
route('/cassa/storico', mountCashHistory, { requires: ['admin', 'manager'] });
route('/cassa/statistiche', mountCashStats, { requires: ['admin', 'manager'] });
route('/report/sprechi', mountReportsWaste, { requires: ['admin', 'manager'] });
route('/report/margini', mountReportsMargins, { requires: ['admin', 'manager'] });
route('/riordini-previsti', mountReportsForecast, { requires: ['admin', 'manager'] });

// ---------- Chrome toggles per route ----------

onRoute((path) => {
  const pathOnly = path.split('?')[0];
  const isLogin = pathOnly === '/login';
  showHeader(!isLogin);
  showNav(!isLogin);
  if (!isLogin) renderNav();
});

// ---------- Service Worker ----------

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  try {
    const reg = await navigator.serviceWorker.register('/service-worker.js');

    // A new SW has been downloaded and is in "waiting" — show update prompt.
    const promptUpdate = (worker) => {
      // showToast persists indefinitely; the user has to click to apply.
      showToast(
        'Nuova versione disponibile. Tocca per aggiornare.',
        'info',
        0,                                  // 0 = sticky
        () => worker.postMessage({ type: 'SKIP_WAITING' }),
      );
    };

    // Case 1: a SW was already in "waiting" when this page loaded (the user
    // missed the previous prompt, or it's their first visit after a deploy).
    if (reg.waiting) promptUpdate(reg.waiting);

    // Case 2: a SW gets installed while the page is open (mid-session deploy).
    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          promptUpdate(installing);
        }
      });
    });

    // When the SW activates (after we postMessage SKIP_WAITING), reload so
    // the page picks up the new shell/assets.
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  } catch (err) {
    console.warn('SW registration failed:', err);
  }
}

// ---------- Bootstrap ----------

async function bootstrap() {
  // Refresh /me if we already have a valid token, so navigations have an
  // up-to-date currentUser to make role decisions. A 401 here triggers a
  // logout, which navigates to /login.
  if (isTokenValid()) {
    try {
      const me = await apiGet('/auth/me');
      setCurrentUser(me);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401) {
        // Non-auth errors at boot shouldn't block startup, but show a hint.
        showToast(err.message || 'Errore di rete', 'warn', 4000);
      }
    }
  } else if (getToken()) {
    // Token exists but is expired — clear it without firing the standard
    // "Sessione scaduta" toast since the user hasn't even seen the app yet.
    logout(null);
  }

  start({ mount: document.getElementById('app') });
  registerServiceWorker();
}

bootstrap();
