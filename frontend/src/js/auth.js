// Amodei — token + user state.
// Stores JWT in localStorage, decodes payload to check expiry, and lets
// other modules subscribe to logout events.

const TOKEN_KEY = 'amodei.token';
const USER_KEY = 'amodei.user';

let _currentUser = null;
const _logoutHandlers = new Set();

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token, user = null) {
  localStorage.setItem(TOKEN_KEY, token);
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    _currentUser = user;
  }
}

export function setCurrentUser(user) {
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    _currentUser = user;
  }
}

export function getCurrentUser() {
  if (_currentUser) return _currentUser;
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (raw) _currentUser = JSON.parse(raw);
  } catch {
    // Corrupt storage — ignore, will re-fetch on next /auth/me.
  }
  return _currentUser;
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  _currentUser = null;
}

export function logout(reason = null) {
  clearAuth();
  for (const handler of _logoutHandlers) {
    try { handler(reason); } catch (err) { console.warn('logout handler error', err); }
  }
}

export function onLogout(handler) {
  _logoutHandlers.add(handler);
}

export function isTokenValid() {
  const token = getToken();
  if (!token) return false;
  try {
    const payload = decodeJwt(token);
    if (!payload.exp) return false;
    // 30 s skew so we don't accept a token that'll die mid-request.
    return payload.exp * 1000 > Date.now() + 30_000;
  } catch {
    return false;
  }
}

export function userHasRole(...roles) {
  const u = getCurrentUser();
  return !!u && roles.includes(u.role);
}

export function decodeJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT');
  const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return JSON.parse(atob(padded));
}
