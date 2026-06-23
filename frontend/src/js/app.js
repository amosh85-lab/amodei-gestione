// Amodei PWA — SPA bootstrap.
// Registers every route, then either:
//   - hands off to the router for an authed session, or
//   - sends the user to /login if no/expired token.

import { apiGet, ApiError } from './api.js';
import { getToken, isTokenValid, setCurrentUser, logout } from './auth.js';
import { showToast } from './components.js';
import { renderNav, showHeader, showNav } from './app-shell.js';
import { route, start, onRoute, navigate } from './router.js';

// Eager imports: pages hit on every session.
//   - /login: always on the cold path.
//   - /: landing page, also used by nav fallback.
//   - /cassa: most-used screen; we want it instant on first tap.
//   - /segnala: staff's daily flow, also cheap.
// Everything else is lazy-loaded via dynamic import() on first navigation:
// network round-trip ~ 1 small JS file, then cached by the service worker.
import { mountLogin } from '../pages/login.js';
import { mountHome } from '../pages/home.js';
import { mountCashPage } from '../pages/cash/index.js';
import { mountQuickSignal } from '../pages/alerts/quick-signal.js';

// Lazy loader: returns a route handler that imports the page on first use.
const lazy = (path, name) => (container, params, query) =>
  import(/* webpackChunkName: "page" */ path).then((m) => m[name](container, params, query));

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
route('/cassa', mountCashPage, { requires: ['admin', 'manager'] });
route('/segnala', mountQuickSignal, { requires: 'auth' });

route('/magazzino',           lazy('../pages/inventory/list.js',       'mountInventoryList'),      { requires: 'auth' });
route('/magazzino/carico',    lazy('../pages/inventory/load.js',       'mountInventoryLoad'),      { requires: 'auth' });
route('/magazzino/:id',       lazy('../pages/inventory/detail.js',     'mountInventoryDetail'),    { requires: 'auth' });
route('/chiusura-serale',     lazy('../pages/inventory/close.js',      'mountInventoryClose'),     { requires: 'auth' });
route('/fornitori',           lazy('../pages/inventory/suppliers.js',  'mountInventorySuppliers'), { requires: ['admin', 'manager'] });
route('/menu',                lazy('../pages/menu/list.js',            'mountMenuList'),           { requires: 'auth' });
route('/menu/combined/:id',   lazy('../pages/menu/combined-edit.js',   'mountCombinedEdit'),       { requires: ['admin', 'manager'] });
route('/pasti-staff',         lazy('../pages/staff-meals/list.js',     'mountStaffMealsList'),     { requires: 'auth' });
route('/pasti-staff/nuovo',   lazy('../pages/staff-meals/new.js',      'mountStaffMealsNew'),      { requires: 'auth' });
route('/pasti-staff/statistiche', lazy('../pages/staff-meals/stats.js', 'mountStaffMealsStats'),   { requires: ['admin', 'manager'] });
route('/pasti-staff/:id',     lazy('../pages/staff-meals/detail.js',   'mountStaffMealsDetail'),   { requires: 'auth' });
route('/riordini',            lazy('../pages/reorders/list.js',        'mountReordersList'),       { requires: ['admin', 'manager'] });
route('/riordini/nuovo',      lazy('../pages/reorders/edit.js',        'mountReorderEdit'),        { requires: ['admin', 'manager'] });
route('/riordini/:id',        lazy('../pages/reorders/edit.js',        'mountReorderEdit'),        { requires: ['admin', 'manager'] });
route('/cassa/storico',       lazy('../pages/cash/history.js',         'mountCashHistory'),        { requires: ['admin', 'manager'] });
route('/cassa/riepilogo',     lazy('../pages/cash/table.js',           'mountCashTable'),          { requires: ['admin', 'manager'] });
route('/cassa/statistiche',   lazy('../pages/cash/stats.js',           'mountCashStats'),          { requires: ['admin', 'manager'] });
route('/cassaforte',          lazy('../pages/cash-vault/index.js',     'mountCashVault'),          { requires: ['admin'] });
route('/report/sprechi',      lazy('../pages/reports/waste.js',        'mountReportsWaste'),       { requires: ['admin', 'manager'] });
route('/report/margini',      lazy('../pages/reports/margins.js',      'mountReportsMargins'),     { requires: ['admin', 'manager'] });
route('/riordini-previsti',   lazy('../pages/reports/forecast.js',     'mountReportsForecast'),    { requires: ['admin', 'manager'] });
route('/impostazioni',        lazy('../pages/settings/index.js',       'mountSettings'),           { requires: 'auth' });
route('/benvenuto',           lazy('../pages/onboarding/welcome.js',   'mountOnboardingWelcome'),  { requires: ['admin'] });
route('/acconti',             lazy('../pages/advances/list.js',        'mountAdvancesList'),       { requires: ['admin', 'manager'] });
route('/turni',               lazy('../pages/shifts/insert.js',        'mountShiftsInsert'),       { requires: ['admin', 'manager'] });
route('/turni/calendario',    lazy('../pages/shifts/calendar.js',      'mountShiftsCalendar'),     { requires: ['admin', 'manager'] });
route('/turni/settimanale',   lazy('../pages/shifts/weekly.js',        'mountShiftsWeekly'),       { requires: ['admin', 'manager'] });
route('/miei-turni',          lazy('../pages/shifts/my-shifts.js',     'mountMyShifts'),           { requires: 'auth' });
route('/stipendi',             lazy('../pages/payroll/dashboard.js',     'mountPayrollDashboard'),   { requires: ['admin'] });
route('/stipendi/ripartizione', lazy('../pages/payroll/ben-dan.js',      'mountBenDan'),             { requires: ['admin'] });
route('/stipendi/:user_id',    lazy('../pages/payroll/user-detail.js',   'mountPayrollUserDetail'),  { requires: ['admin'] });
route('/guida',               lazy('../pages/guide.js',                'mountGuide'),              { requires: 'auth' });
route('/fatture',             lazy('../pages/invoices/list.js',        'mountInvoicesList'),       { requires: ['admin', 'manager'] });
route('/fatture/nuova',       lazy('../pages/invoices/new.js',         'mountInvoiceNew'),         { requires: ['admin', 'manager'] });
route('/fatture/da-pagare',   lazy('../pages/invoices/unpaid.js',      'mountInvoicesUnpaid'),     { requires: ['admin'] });
route('/fatture/:id',         lazy('../pages/invoices/detail.js',      'mountInvoiceDetail'),      { requires: ['admin', 'manager'] });
route('/ddt',                 lazy('../pages/ddts/list.js',            'mountDdtList'),            { requires: ['admin', 'manager'] });
route('/ddt/nuovo',           lazy('../pages/ddts/new.js',             'mountDdtNew'),             { requires: ['admin', 'manager'] });
route('/ddt/:id',             lazy('../pages/ddts/detail.js',          'mountDdtDetail'),          { requires: ['admin', 'manager'] });
route('/pagamenti',           lazy('../pages/payments/list.js',        'mountPaymentsList'),       { requires: ['admin'] });
route('/pagamenti/:id',       lazy('../pages/payments/detail.js',      'mountPaymentDetail'),      { requires: ['admin'] });
route('/food-cost',           lazy('../pages/foodcost/dashboard.js',   'mountFoodcostDashboard'),  { requires: ['admin', 'manager'] });
route('/food-cost/dettaglio', lazy('../pages/foodcost/breakdown.js',   'mountFoodcostBreakdown'),  { requires: ['admin', 'manager'] });

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
    // updateViaCache: 'none' → il browser NON deve usare la HTTP cache per
    // /service-worker.js. Senza questo, su iOS Safari PWA il vecchio SW
    // può restare attivo per ore/giorni anche dopo un deploy nuovo, perché
    // il browser non rifa la richiesta al server. Serve iOS 16+.
    const reg = await navigator.serviceWorker.register('/service-worker.js', {
      updateViaCache: 'none',
    });
    // Forziamo un check immediato di aggiornamenti ad ogni boot.
    try { reg.update(); } catch (_) { /* best effort */ }

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
