// Amodei PWA — entry point.
// For now this is a placeholder landing that pings the backend and
// renders the connection status with the design system. Real pages
// (login, dashboard, cassa, magazzino…) arrive in later prompts.

import { apiGet, baseUrl } from './api.js';
import { initRouter } from './router.js';
import { icon } from './icons.js';
import { showToast } from './components.js';

const STATUS_CONFIG = {
  pending: { label: 'Verifica connessione…', cls: 'pill',          iconName: 'clock' },
  ok:      { label: 'Backend connesso',     cls: 'pill pill--success', iconName: 'check' },
  error:   { label: 'Backend non raggiungibile', cls: 'pill pill--danger', iconName: 'alert' },
};

function setStatus(kind, detail = '') {
  const node = document.getElementById('status');
  const detailEl = document.getElementById('status-detail');
  if (!node || !detailEl) return;
  const cfg = STATUS_CONFIG[kind];
  node.className = cfg.cls;
  node.innerHTML = `${icon(cfg.iconName, { size: 16 })}<span>${cfg.label}</span>`;
  detailEl.textContent = detail;
}

async function checkBackend() {
  try {
    const data = await apiGet('/health');
    setStatus('ok', `${baseUrl} · v${data.version || '?'}`);
  } catch (err) {
    setStatus('error', `${baseUrl} — ${err.message}`);
    console.error('Backend check failed:', err);
    showToast('Impossibile contattare il backend', 'danger', 4000);
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  try {
    await navigator.serviceWorker.register('/service-worker.js');
  } catch (err) {
    console.warn('Service worker registration failed:', err);
  }
}

initRouter();
checkBackend();
registerServiceWorker();
