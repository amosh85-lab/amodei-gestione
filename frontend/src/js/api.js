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

async function request(
  method,
  path,
  { body, timeoutMs = 60000, isFormData = false, auth = true } = {},
) {
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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

  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    throw new ApiError(
      err.name === 'AbortError'
        ? `Timeout dopo ${timeoutMs / 1000}s`
        : err.message || 'Errore di rete',
      { status: 0, detail: err.message },
    );
  } finally {
    clearTimeout(timer);
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
