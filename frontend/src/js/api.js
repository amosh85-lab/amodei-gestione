// Authenticated fetch wrapper for the Amodei API.
//
// The backend base URL is resolved from <meta name="amodei-api-url"> in
// index.html. Every request automatically attaches the Bearer token from
// auth.js and dispatches a logout on a 401 so the user lands back at /login.

import { getToken, logout } from './auth.js';

const META_TAG = 'amodei-api-url';
const FALLBACK_LOCAL = 'http://localhost:8000';

function resolveBaseUrl() {
  // Local dev convenience: when the page is served from localhost,
  // always talk to the local backend regardless of what the deploy-time
  // meta tag says. This way `python3 -m http.server 5501` in /frontend
  // automatically pairs with `uvicorn` on :8000 without needing to swap
  // the meta tag back and forth.
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(location.hostname);
  if (isLocalHost) return FALLBACK_LOCAL;

  const tag = document.querySelector(`meta[name="${META_TAG}"]`);
  const fromMeta = tag?.getAttribute('content')?.trim();
  if (fromMeta) return fromMeta.replace(/\/+$/, '');
  return FALLBACK_LOCAL;
}

export const baseUrl = resolveBaseUrl();

export class ApiError extends Error {
  constructor(message, { status, detail, body } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status ?? 0;
    this.detail = detail ?? null;
    this.body = body ?? null;
  }
}

// Cold start di Railway: dopo un periodo di inattività il container si
// sospende e la PRIMA richiesta che lo risveglia può fallire a livello di
// rete (Safari mostra "Load failed") o tornare un errore gateway 502/503/504
// mentre riparte. Ritentiamo in modo trasparente questi casi così un semplice
// risveglio del server non mostra l'errore (es. salvataggio incasso).
//
// Ritentiamo SOLO i metodi idempotenti: ripeterli è sicuro. I POST NO —
// se la richiesta era in realtà arrivata, un secondo invio potrebbe avere
// effetti collaterali (notifiche doppie, record duplicati).
const RETRYABLE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE']);
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const MAX_RETRIES = 2;        // tentativi extra oltre il primo (3 totali)
const RETRY_BASE_MS = 600;    // backoff lineare: ~0,6s poi ~1,2s

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(
  method,
  path,
  { body, timeoutMs = 60000, isFormData = false, auth = true } = {},
) {
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

  const headers = { Accept: 'application/json' };
  let payload = body;
  if (body !== undefined && body !== null && !isFormData) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const canRetry = RETRYABLE_METHODS.has(method);
  const maxAttempts = canRetry ? MAX_RETRIES + 1 : 1;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      // cache: 'no-store' → Safari/iOS PWA non riservono GET cached al posto
      // di una nuova fetch dopo PATCH/POST. Senza questo, il GET successivo a
      // un aggiornamento poteva ritornare la versione vecchia (toast "salvato"
      // ma UI non aggiornata).
      res = await fetch(url, {
        method, headers, body: payload, signal: controller.signal,
        cache: 'no-store',
      });
    } catch (err) {
      clearTimeout(timer);
      const isTimeout = err.name === 'AbortError';
      lastError = new ApiError(
        isTimeout ? `Timeout dopo ${timeoutMs / 1000}s` : err.message || 'Errore di rete',
        { status: 0, detail: err.message },
      );
      // Ritenta solo i fallimenti di rete (non i timeout: hanno già atteso a lungo).
      if (canRetry && !isTimeout && attempt < maxAttempts) {
        await sleep(RETRY_BASE_MS * attempt);
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timer);
    }

    // Errore gateway tipico del cold start: ritenta finché possibile.
    if (canRetry && RETRYABLE_STATUS.has(res.status) && attempt < maxAttempts) {
      await sleep(RETRY_BASE_MS * attempt);
      continue;
    }

    if (res.status === 401 && auth) {
      logout('Sessione scaduta. Effettua di nuovo l’accesso.');
      throw new ApiError('Sessione scaduta', { status: 401 });
    }

    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!res.ok) {
      const detail =
        data && typeof data === 'object' && data.detail !== undefined ? data.detail : data;
      const message = typeof detail === 'string' ? detail : `HTTP ${res.status}`;
      throw new ApiError(message, { status: res.status, detail, body: data });
    }
    return data;
  }

  // Tentativi esauriti (solo i path ritentabili arrivano qui).
  throw lastError ?? new ApiError('Errore di rete', { status: 0 });
}

export const apiGet = (path, opts) => request('GET', path, opts);
export const apiPost = (path, body, opts) => request('POST', path, { ...opts, body });
export const apiPut = (path, body, opts) => request('PUT', path, { ...opts, body });
export const apiPatch = (path, body, opts) => request('PATCH', path, { ...opts, body });
export const apiDelete = (path, opts) => request('DELETE', path, opts);

/** Multipart upload: pass a FormData. Returns parsed JSON. */
export function apiUpload(path, formData, opts = {}) {
  // Upload multipart (foto): timeout più lungo per coprire connessioni lente.
  return request('POST', path, { timeoutMs: 120000, ...opts, body: formData, isFormData: true });
}

/** Absolute URL for a server-relative path (used by <img src> on /uploads/*). */
export function absoluteUrl(serverPath) {
  if (!serverPath) return '';
  if (/^https?:\/\//i.test(serverPath)) return serverPath;
  return `${baseUrl}${serverPath.startsWith('/') ? serverPath : `/${serverPath}`}`;
}
