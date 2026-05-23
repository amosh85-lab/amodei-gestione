// Tiny hash-based SPA router with optional auth / role guards.
//
//   route('/magazzino/:id', mountFn, { requires: 'auth' });
//   route('/fornitori',     mountFn, { requires: ['admin', 'manager'] });
//   start({ mount: document.getElementById('app') });
//
// Each `mountFn(container, params, query)` may return a cleanup function
// (or a Promise resolving to one) that's invoked before the next route is
// mounted — e.g. to detach event listeners or stop intervals.

import { isTokenValid, getCurrentUser, onLogout } from './auth.js';

const routes = [];
let mountEl = null;
let currentCleanup = null;
let onRouteChangeCb = () => {};

export function route(pattern, handler, { requires = null } = {}) {
  routes.push({ pattern, ...compile(pattern), handler, requires });
}

export function start({ mount }) {
  mountEl = mount;
  window.addEventListener('hashchange', dispatch);
  onLogout(() => navigate('/login', { replace: true }));
  dispatch();
}

export function onRoute(cb) {
  onRouteChangeCb = cb;
}

export function navigate(path, { replace = false } = {}) {
  const hash = `#${path}`;
  if (replace) {
    history.replaceState(null, '', hash);
    dispatch();
  } else if (location.hash === hash) {
    dispatch();
  } else {
    location.hash = hash;
  }
}

export function currentPath() {
  const hash = location.hash || '#/';
  return hash.startsWith('#') ? hash.slice(1) : hash;
}

// --- internals ---

function compile(pattern) {
  const keys = [];
  const re = pattern
    .replace(/[/]/g, '\\/')
    .replace(/:([a-zA-Z_]+)/g, (_, k) => {
      keys.push(k);
      return '([^/?#]+)';
    });
  return { re: new RegExp(`^${re}$`), keys };
}

function matchRoute(pathOnly) {
  for (const r of routes) {
    const m = pathOnly.match(r.re);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
  }
  return null;
}

function parseQuery(path) {
  const qIdx = path.indexOf('?');
  if (qIdx === -1) return {};
  const q = path.slice(qIdx + 1);
  const out = {};
  for (const part of q.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const k = decodeURIComponent(eq === -1 ? part : part.slice(0, eq));
    const v = eq === -1 ? '' : decodeURIComponent(part.slice(eq + 1));
    out[k] = v;
  }
  return out;
}

function renderError(container, html) {
  container.innerHTML = `
    <div class="container" style="padding-top:24px">
      <div class="card">${html}</div>
    </div>`;
}

async function dispatch() {
  if (!mountEl) return;
  const fullPath = currentPath();
  const pathOnly = fullPath.split('?')[0] || '/';
  const matched = matchRoute(pathOnly);

  if (!matched) {
    renderError(
      mountEl,
      `<h2 class="card__title">Pagina non trovata</h2>
       <p class="muted">Il percorso <code>#${escape(fullPath)}</code> non esiste.</p>`,
    );
    onRouteChangeCb(fullPath, null);
    return;
  }

  const { route: r, params } = matched;
  const query = parseQuery(fullPath);

  if (r.requires === 'auth' && !isTokenValid()) {
    navigate('/login', { replace: true });
    return;
  }
  if (Array.isArray(r.requires)) {
    if (!isTokenValid()) {
      navigate('/login', { replace: true });
      return;
    }
    const user = getCurrentUser();
    if (!user || !r.requires.includes(user.role)) {
      navigate('/', { replace: true });
      return;
    }
  }

  if (typeof currentCleanup === 'function') {
    try { currentCleanup(); } catch (err) { console.warn('cleanup error', err); }
  }
  currentCleanup = null;

  mountEl.innerHTML = '';
  try {
    const result = r.handler(mountEl, params, query);
    if (typeof result === 'function') {
      currentCleanup = result;
    } else if (result && typeof result.then === 'function') {
      result.then((maybeCleanup) => {
        if (typeof maybeCleanup === 'function') currentCleanup = maybeCleanup;
      }).catch((err) => {
        console.error('Async handler error', err);
        renderError(
          mountEl,
          `<h2 class="card__title">Errore</h2>
           <p class="muted">${escape(err.message || String(err))}</p>`,
        );
      });
    }
  } catch (err) {
    console.error('Route handler error', err);
    renderError(
      mountEl,
      `<h2 class="card__title">Errore</h2>
       <p class="muted">${escape(err.message || String(err))}</p>`,
    );
  }

  mountEl.scrollTop = 0;
  onRouteChangeCb(fullPath, matched);
}

function escape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
