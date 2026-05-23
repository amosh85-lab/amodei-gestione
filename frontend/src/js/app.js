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
route('/fornitori', mountInventorySuppliers, { requires: ['admin', 'manager'] });

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
    await navigator.serviceWorker.register('/service-worker.js');
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
