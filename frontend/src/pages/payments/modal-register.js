// Modal "Registra pagamento" — admin only.
// Called from /fatture/da-pagare (preselectedInvoiceIds dello stesso supplier)
// or from /fatture/:id (singola fattura).

import { apiPost, ApiError } from '../../js/api.js';
import { showModal, showToast } from '../../js/components.js';
import { todayLocalIso } from '../../js/dates.js';

const METHOD_LABEL = { bank_transfer: '🏦 Bonifico', check: '📝 Assegno', cash: '💵 Contanti' };

/**
 * @param {Object} opts
 * @param {number[]} opts.preselectedInvoiceIds
 * @param {Object} opts.supplier { id, name, category }
 * @param {Array<{id, invoice_number, invoice_date, amount_total}>} opts.invoices
 * @param {() => Promise<void>} opts.onSaved
 */
export function openRegisterPaymentModal({ preselectedInvoiceIds, supplier, invoices, onSaved }) {
  const total = invoices.reduce((s, i) => s + Number(i.amount_total), 0);
  const today = todayLocalIso();
  let method = 'bank_transfer';

  const body = `
    <div style="display: grid; gap: var(--space-12);">
      <div class="card" style="padding: var(--space-12); background: var(--cream-soft);">
        <p class="muted text-xs" style="margin:0; text-transform: uppercase;">Fornitore</p>
        <p style="margin: 2px 0 var(--space-8) 0; font-weight: 600;">${escapeHtml(supplier.name)}</p>
        ${invoices.map((i) => `
          <div style="display: flex; justify-content: space-between; padding: 2px 0; font-size: var(--text-sm);">
            <span class="muted">#${escapeHtml(i.invoice_number)} · ${formatDate(i.invoice_date)}</span>
            <span style="font-family: var(--font-display);">€ ${fmt(i.amount_total)}</span>
          </div>
        `).join('')}
        <div style="display: flex; justify-content: space-between; padding: var(--space-8) 0 0 0; border-top: 1px solid var(--border-soft); margin-top: var(--space-8); font-weight: 600;">
          <span>Totale</span>
          <span style="font-family: var(--font-display); font-size: 1.2rem;">€ ${fmt(total)}</span>
        </div>
      </div>

      <div>
        <label class="label" style="margin:0;">Metodo di pagamento</label>
        <div id="pay-methods" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-8); margin-top: var(--space-4);">
          ${methodBtn('bank_transfer', '🏦 Bonifico')}
          ${methodBtn('check',         '📝 Assegno')}
          ${methodBtn('cash',          '💵 Contanti')}
        </div>
      </div>

      <div>
        <label class="label" for="pay-date" style="margin:0;">Data pagamento</label>
        <input type="date" id="pay-date" class="input" value="${today}">
      </div>

      <div id="check-field" style="display: none;">
        <label class="label label--required" for="pay-check" style="margin:0;">Numero assegno</label>
        <input type="text" id="pay-check" class="input" maxlength="50" placeholder="Es. 00123456">
      </div>

      <div>
        <label class="label" for="pay-notes" style="margin:0;">Note (opzionale)</label>
        <textarea id="pay-notes" class="textarea" rows="2" maxlength="500"></textarea>
      </div>
    </div>
  `;

  showModal('Registra pagamento', body, [
    { label: 'Annulla', variant: 'ghost' },
    {
      label: 'Conferma pagamento', variant: 'primary', closeOnClick: true,
      onClick: async () => {
        const payment_date = document.getElementById('pay-date').value;
        const notes = document.getElementById('pay-notes').value.trim();
        const checkInput = document.getElementById('pay-check');
        const check_number = method === 'check' ? checkInput.value.trim() : null;
        if (!payment_date) { showToast('Data obbligatoria', 'warn'); return; }
        if (method === 'check' && !check_number) {
          showToast('Numero assegno obbligatorio', 'warn'); return;
        }
        try {
          await apiPost('/payments', {
            invoice_ids: preselectedInvoiceIds,
            payment_date, method, check_number, notes: notes || null,
          });
          showToast(`Pagamento registrato (${METHOD_LABEL[method]})`, 'success');
          await onSaved();
        } catch (err) {
          const msg = err instanceof ApiError && err.message ? err.message : 'Errore registrazione';
          showToast(msg, 'danger', 5000);
        }
      },
    },
  ]);

  function methodBtn(id, label) {
    return `<button type="button" data-method="${id}" style="
      padding: var(--space-12) var(--space-8); border-radius: var(--radius-md);
      border: 1px solid ${method === id ? 'var(--terracotta)' : 'var(--border-soft)'};
      background: ${method === id ? 'var(--terracotta)' : 'var(--off-white)'};
      color: ${method === id ? 'var(--off-white)' : 'var(--ink)'};
      font-size: var(--text-sm); cursor: pointer; text-align: center;">${label}</button>`;
  }

  // Wire method picker
  const updateMethodUI = () => {
    document.querySelectorAll('#pay-methods [data-method]').forEach((b) => {
      const active = b.dataset.method === method;
      b.style.background = active ? 'var(--terracotta)' : 'var(--off-white)';
      b.style.color = active ? 'var(--off-white)' : 'var(--ink)';
      b.style.borderColor = active ? 'var(--terracotta)' : 'var(--border-soft)';
    });
    document.getElementById('check-field').style.display = method === 'check' ? '' : 'none';
  };
  document.querySelectorAll('#pay-methods [data-method]').forEach((b) => {
    b.addEventListener('click', () => { method = b.dataset.method; updateMethodUI(); });
  });
}

function fmt(v) { const n = Number(v); return Number.isNaN(n) ? '0,00' : n.toFixed(2).replace('.', ','); }
function formatDate(iso) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
