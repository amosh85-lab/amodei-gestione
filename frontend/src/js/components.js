// Amodei UI helpers — toasts, modals, confirm, skeletons.
//
// Plain ES modules; no framework. Each helper attaches lightweight DOM
// to the document body and returns either a handle (close fn) or a Promise.

import { icon } from './icons.js';

// ============================================================
// TOAST
// ============================================================

let toastHost = null;

function ensureToastHost() {
  if (toastHost && document.body.contains(toastHost)) return toastHost;
  toastHost = document.createElement('div');
  toastHost.className = 'toast-host';
  toastHost.setAttribute('role', 'status');
  toastHost.setAttribute('aria-live', 'polite');
  document.body.appendChild(toastHost);
  return toastHost;
}

const TOAST_ICON = {
  info:    'info',
  success: 'check',
  warn:    'warning',
  danger:  'alert',
};

const TOAST_VARIANT_CLASS = {
  info:    '',
  success: 'toast--success',
  warn:    'toast--warn',
  danger:  'toast--danger',
};

/**
 * Show a transient toast notification.
 * @param {string} message - text to display
 * @param {'info'|'success'|'warn'|'danger'} [type='info']
 * @param {number} [duration=3000] - ms before auto-dismiss; 0 = sticky
 * @returns {() => void} - function to dismiss the toast manually
 */

/** Parse un input numerico utente che potrebbe usare ',' o '.' come separatore
 *  decimale (iOS in italiano spesso ritorna '12,50' invece di '12.50').
 *  Ritorna il numero parsato, o NaN se invalido. */
export function parseNumberInput(value) {
  if (value == null) return NaN;
  return parseFloat(String(value).trim().replace(',', '.'));
}

export function showToast(message, type = 'info', duration = 3000, onClick = null) {
  const host = ensureToastHost();
  const el = document.createElement('div');
  el.className = `toast ${TOAST_VARIANT_CLASS[type] || ''}`.trim();
  el.innerHTML = `
    <span class="toast__icon">${icon(TOAST_ICON[type] || 'info', { size: 20 })}</span>
    <span class="toast__body"></span>
  `;
  el.querySelector('.toast__body').textContent = message;
  host.appendChild(el);

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    el.classList.add('toast--leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };

  // If onClick is provided, the toast becomes interactive (e.g. "tap to update").
  if (onClick) {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => { onClick(); dismiss(); });
  }

  if (duration > 0) {
    setTimeout(dismiss, duration);
  }
  return dismiss;
}


// ============================================================
// MODAL
// ============================================================

/**
 * @typedef {Object} ModalAction
 * @property {string} label
 * @property {'primary'|'secondary'|'ghost'|'danger'} [variant='secondary']
 * @property {(close: () => void) => void} [onClick]
 * @property {boolean} [closeOnClick=true]  — close the modal after onClick runs
 */

/**
 * Open a modal dialog.
 * @param {string} title
 * @param {string} contentHTML - already-escaped HTML for the body
 * @param {ModalAction[]} [actions=[]]
 * @returns {() => void} - close function
 */
export function showModal(title, contentHTML, actions = []) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');

  const modal = document.createElement('div');
  modal.className = 'modal';

  // Header
  const header = document.createElement('div');
  header.className = 'modal__header';
  const titleEl = document.createElement('h3');
  titleEl.className = 'modal__title';
  titleEl.textContent = title;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal__close';
  closeBtn.setAttribute('aria-label', 'Chiudi');
  closeBtn.innerHTML = icon('x', { size: 20 });
  header.append(titleEl, closeBtn);

  // Body
  const body = document.createElement('div');
  body.className = 'modal__body';
  body.innerHTML = contentHTML;

  modal.append(header, body);

  // Actions
  if (actions && actions.length > 0) {
    const actionsEl = document.createElement('div');
    actionsEl.className = 'modal__actions';
    actions.forEach((a) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn btn--${a.variant || 'secondary'}`;
      btn.textContent = a.label;
      btn.addEventListener('click', () => {
        if (a.onClick) a.onClick(close);
        if (a.closeOnClick !== false) close();
      });
      actionsEl.appendChild(btn);
    });
    modal.appendChild(actionsEl);
  }

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKeydown);
  }

  function onKeydown(ev) {
    if (ev.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKeydown);

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) close();
  });

  // Focus first focusable for accessibility
  requestAnimationFrame(() => {
    const focusable = modal.querySelector(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"]), input, textarea, select'
    );
    (focusable || closeBtn).focus();
  });

  return close;
}


// ============================================================
// CONFIRM
// ============================================================

/**
 * Show a confirmation dialog.
 * @param {string} title
 * @param {string} message
 * @param {{confirmLabel?: string, cancelLabel?: string, danger?: boolean}} [opts]
 * @returns {Promise<boolean>}
 */
export function confirmDialog(title, message, opts = {}) {
  const { confirmLabel = 'Conferma', cancelLabel = 'Annulla', danger = false } = opts;
  return new Promise((resolve) => {
    let resolved = false;
    const resolveOnce = (v) => {
      if (resolved) return;
      resolved = true;
      resolve(v);
    };
    const bodyEl = document.createElement('p');
    bodyEl.textContent = message;
    showModal(title, bodyEl.outerHTML, [
      {
        label: cancelLabel,
        variant: 'ghost',
        onClick: () => resolveOnce(false),
      },
      {
        label: confirmLabel,
        variant: danger ? 'danger' : 'primary',
        onClick: () => resolveOnce(true),
      },
    ]);
    // If user closes via X/Esc/backdrop, treat as cancel.
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') {
        resolveOnce(false);
        document.removeEventListener('keydown', onEsc);
      }
    });
  });
}


// ============================================================
// SKELETON
// ============================================================

/**
 * Render a skeleton list HTML string (e.g. for loading states).
 * Each item is a "skeleton-card" with a title line and 2 body lines.
 * @param {number} [count=3]
 * @returns {string} HTML to inject into an element's innerHTML
 */
export function skeletonList(count = 3) {
  const item = `
    <div class="skeleton-card stack-12">
      <div class="skeleton skeleton--title"></div>
      <div class="skeleton skeleton--line"></div>
      <div class="skeleton skeleton--line" style="width:80%"></div>
    </div>
  `;
  return `<div class="stack-12">${item.repeat(Math.max(1, count))}</div>`;
}
