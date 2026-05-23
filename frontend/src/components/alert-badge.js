// Reusable badge component for "N segnalazioni aperte" indicators.
//
// Returns an HTML string. Wire it into existing elements with .innerHTML
// or compose into a larger template. Render is cheap — no internal state.

import { icon } from '../js/icons.js';

/**
 * Build the badge markup.
 * @param {number} count        - total open alerts
 * @param {Object} [opts]
 * @param {number} [opts.urgent=0]  - subset that's urgent (status_signaled='out')
 * @param {string} [opts.label='aperte']
 * @returns {string} HTML
 */
export function alertBadge(count, { urgent = 0, label = 'aperte' } = {}) {
  if (!count) {
    return `<span class="badge badge--success">${icon('check', { size: 12 })}<span>Tutto in regola</span></span>`;
  }
  const variant = urgent > 0 ? 'badge--danger' : 'badge--warn';
  const ico = urgent > 0 ? 'alert' : 'warning';
  const detail = urgent > 0
    ? `${count} ${label} · ${urgent} urgenti`
    : `${count} ${label}`;
  return `<span class="badge ${variant}">${icon(ico, { size: 12 })}<span>${escapeHtml(detail)}</span></span>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
