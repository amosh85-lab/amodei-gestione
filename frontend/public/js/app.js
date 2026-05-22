import { apiGet, baseUrl } from './api.js';
import { initRouter } from './router.js';

const STATUS = {
  pending: { label: 'Connessione al backend…', cls: 'boot__status--pending' },
  ok:      { label: 'Connesso al backend ✓',  cls: 'boot__status--ok' },
  error:   { label: 'Errore connessione',     cls: 'boot__status--error' },
};

function setStatus(kind, detail = '') {
  const node = document.getElementById('status');
  const labelNode = node?.querySelector('.boot__label');
  const detailNode = document.getElementById('status-detail');
  if (!node || !labelNode || !detailNode) return;

  node.classList.remove(STATUS.pending.cls, STATUS.ok.cls, STATUS.error.cls);
  node.classList.add(STATUS[kind].cls);
  labelNode.textContent = STATUS[kind].label;
  detailNode.textContent = detail;
}

async function checkBackend() {
  try {
    const data = await apiGet('/health');
    setStatus('ok', `${baseUrl} — ${JSON.stringify(data)}`);
  } catch (err) {
    setStatus('error', `${baseUrl} — ${err.message}`);
    console.error('Backend check failed:', err);
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Service workers only work on https:// (or http://localhost). Skip otherwise
  // to avoid noisy errors when serving via file:// during dev.
  if (location.protocol === 'file:') return;
  try {
    await navigator.serviceWorker.register('./service-worker.js');
  } catch (err) {
    console.warn('Service worker registration failed:', err);
  }
}

initRouter();
checkBackend();
registerServiceWorker();
