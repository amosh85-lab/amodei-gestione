// Lightweight fetch wrapper for the Amodei API.
//
// The backend base URL is resolved from a <meta name="amodei-api-url"> tag
// in index.html — set it per-deploy. If empty, we fall back to localhost:8000
// so local dev "just works".

const META_TAG = 'amodei-api-url';
const FALLBACK_LOCAL = 'http://localhost:8000';

function resolveBaseUrl() {
  const tag = document.querySelector(`meta[name="${META_TAG}"]`);
  const fromMeta = tag?.getAttribute('content')?.trim();
  if (fromMeta) return fromMeta.replace(/\/+$/, '');
  return FALLBACK_LOCAL;
}

export const baseUrl = resolveBaseUrl();

async function request(method, path, { body, timeoutMs = 8000 } = {}) {
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const init = {
    method,
    headers: { Accept: 'application/json' },
    signal: controller.signal,
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, init);
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const detail = (data && data.detail) || `HTTP ${res.status}`;
      throw new Error(detail);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export const apiGet = (path, opts) => request('GET', path, opts);
export const apiPost = (path, body, opts) => request('POST', path, { ...opts, body });
export const apiPut = (path, body, opts) => request('PUT', path, { ...opts, body });
export const apiDelete = (path, opts) => request('DELETE', path, opts);
