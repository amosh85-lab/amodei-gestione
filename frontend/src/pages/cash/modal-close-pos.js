// POS close modal — big "telefono-like" numpad.
//
// Exports a reusable openNumpad() too, so the expense modal can share
// the same UX without duplicating the keypad code.

import { showModal } from '../../js/components.js';
import { icon } from '../../js/icons.js';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'];

/**
 * Open a large modal with a 3×4 numpad bound to an internal value.
 * @param {Object} opts
 * @param {string} opts.title             - modal title
 * @param {string|number} [opts.initial]  - initial value (uses Italian decimal `,`)
 * @param {(value: number) => void} opts.onConfirm  - called with the parsed number
 * @returns {() => void}                  - manual close function
 */
export function openNumpad({ title, initial = '', onConfirm }) {
  // Normalise initial → "12,50"-like string
  let value = String(initial ?? '').replace('.', ',').trim();
  if (value === '0' || value === '0,00') value = '';

  let close = null;

  function fmt() {
    if (!value) return '0,00';
    if (!value.includes(',')) return `${value},00`;
    const [int, dec] = value.split(',');
    return `${int || '0'},${(dec || '').padEnd(2, '0').slice(0, 2)}`;
  }

  function refresh() {
    const d = document.getElementById('np-display');
    if (d) d.textContent = fmt();
  }

  function press(k) {
    if (k === '⌫') {
      value = value.slice(0, -1);
    } else if (k === ',') {
      if (!value.includes(',')) value = (value || '0') + ',';
    } else {
      // digit
      if (value.includes(',')) {
        const dec = value.split(',')[1] || '';
        if (dec.length >= 2) return;
      } else if (value.length >= 7) {
        return; // cap integers
      }
      value += String(k);
    }
    refresh();
  }

  const body = `
    <div style="text-align: center;">
      <div id="np-display" style="
        font-family: var(--font-display); font-size: clamp(2rem, 9vw, 3rem); font-weight: 600;
        color: var(--ink); white-space: nowrap; overflow: hidden;
        padding: var(--space-8) var(--space-12); line-height: 1.1;
        background: var(--cream-soft); border-radius: var(--radius-md);
        margin-bottom: var(--space-12);">
        € ${fmt()}
      </div>
      <div id="np-grid" style="
        display: grid; grid-template-columns: repeat(3, 1fr);
        gap: var(--space-8);">
        ${KEYS.map((k) => `
          <button type="button" data-key="${k}" style="
            font-family: var(--font-display); font-size: 1.5rem; font-weight: 500;
            padding: var(--space-12) 0; border: 1px solid var(--border-soft);
            border-radius: var(--radius-md); background: var(--off-white);
            color: var(--ink); cursor: pointer; touch-action: manipulation;">${k === ',' ? ',' : k}</button>
        `).join('')}
      </div>
    </div>
  `;

  close = showModal(title, body, [
    { label: 'Annulla', variant: 'ghost' },
    {
      label: 'Conferma',
      variant: 'primary',
      closeOnClick: true,
      onClick: () => {
        const num = parseFloat((value || '0').replace(',', '.')) || 0;
        onConfirm(num);
      },
    },
  ]);

  // Wire keys (modal body is in the DOM at this point)
  document.querySelectorAll('#np-grid [data-key]').forEach((btn) => {
    btn.addEventListener('click', () => press(btn.dataset.key));
  });

  // Also accept hardware keyboard for desktop testing
  function onKeydown(e) {
    if (e.key >= '0' && e.key <= '9') press(e.key);
    else if (e.key === ',' || e.key === '.') press(',');
    else if (e.key === 'Backspace') press('⌫');
  }
  document.addEventListener('keydown', onKeydown);
  // Cleanup when modal closes via backdrop/esc/x
  const origClose = close;
  close = () => {
    document.removeEventListener('keydown', onKeydown);
    origClose();
  };

  refresh();
  return close;
}


/**
 * Convenience wrapper for the POS close flow: numpad + Italian copy.
 * @param {Object} opts
 * @param {'lunch'|'dinner'} opts.service
 * @param {number} [opts.currentAmount]  - pre-fill when re-editing
 * @param {(amount: number) => Promise<void>} opts.onSave
 */
export function openClosePosModal({ service, currentAmount = 0, onSave }) {
  const label = service === 'lunch' ? 'pranzo' : 'cena';
  return openNumpad({
    title: `Chiudi POS ${label}`,
    initial: currentAmount > 0 ? currentAmount.toFixed(2) : '',
    onConfirm: async (n) => {
      try { await onSave(n); }
      catch (err) { console.error('close POS save failed', err); }
    },
  });
}
