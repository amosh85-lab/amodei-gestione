// Web Push client: helpers per registrare/cancellare la subscription.
//
// Flusso:
//   1. Notification.permission → richiesto se 'default'
//   2. navigator.serviceWorker.ready → SW registration
//   3. PushManager.subscribe({ applicationServerKey: VAPID_PUBLIC_KEY })
//   4. POST /push/subscribe { endpoint, keys, user_agent }
//
// iOS: funziona solo se l'app è installata come PWA (Aggiungi a schermata
// Home) E iOS >= 16.4. In Safari "normale" PushManager non esiste.

import { apiGet, apiPost, apiDelete } from './api.js';

export function isPushSupported() {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function pushPermission() {
  return ('Notification' in window) ? Notification.permission : 'denied';
}

export async function isSubscribed() {
  if (!isPushSupported()) return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

export async function subscribePush() {
  if (!isPushSupported()) throw new Error('Push non supportate da questo browser');

  // Chiave pubblica VAPID dal server
  let publicKey;
  try {
    const res = await apiGet('/push/vapid-public-key');
    publicKey = res.public_key;
  } catch (err) {
    throw new Error(err.message || 'Push non configurate sul server');
  }

  // Permission (lo deve richiedere il browser su un gesto utente)
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    throw new Error(perm === 'denied'
      ? 'Hai negato i permessi. Riattiva dalle impostazioni del browser.'
      : 'Permesso non concesso');
  }

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const raw = sub.toJSON();
  await apiPost('/push/subscribe', {
    endpoint: raw.endpoint,
    keys: { p256dh: raw.keys.p256dh, auth: raw.keys.auth },
    user_agent: navigator.userAgent.slice(0, 255),
  });
  return true;
}

export async function unsubscribePush() {
  if (!isPushSupported()) return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return true;
  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } catch { /* continua comunque */ }
  try {
    await apiDelete(`/push/subscribe?endpoint=${encodeURIComponent(endpoint)}`);
  } catch { /* il backend è secondario, il browser ha già rimosso */ }
  return true;
}

// Helper standard: la chiave VAPID arriva URL-safe base64; PushManager
// vuole un Uint8Array.
function urlBase64ToUint8Array(b64) {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const normalized = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
