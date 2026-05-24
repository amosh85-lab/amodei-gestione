// /pagamenti/:id — admin only.

import { apiGet, apiDelete, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { icon } from '../../js/icons.js';
import { showToast, confirmDialog, skeletonList } from '../../js/components.js';

const METHOD_LABEL = { bank_transfer: '🏦 Bonifico', check: '📝 Assegno', cash: '💵 Contanti' };
const CAT_LABEL = { food: '🍖 Food', beverage: '🍷 Beverage', consumo: '🧴 Consumo' };

export async function mountPaymentDetail(container, params, _query) {
  const id = params.id;
  setHeader({ title: 'Pagamento', brand: true, backHref: '/pagamenti' });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(3)}</div>`;

  let p = null;
  try {
    p = await apiGet(`/payments/${id}`);
  } catch (err) {
    container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
      <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
        <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(err.message || '')}</p></div></div></div>`;
    return;
  }

  container.innerHTML = `
    <section class="container" style="padding-block: var(--space-20); padding-bottom: 96px;">
      <div class="card" style="padding: var(--space-16);">
        <p style="margin:0; font-size: 1.4rem; font-weight: 600;">${METHOD_LABEL[p.method]}</p>
        <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 2rem;">€ ${fmt(p.amount_total)}</p>
        <div style="margin-top: var(--space-16); padding-top: var(--space-12); border-top: 1px solid var(--border-soft); display: grid; gap: var(--space-8);">
          <div class="row" style="justify-content: space-between;"><span class="muted">Fornitore</span><span>${escapeHtml(p.supplier?.name || '—')} · ${CAT_LABEL[p.supplier?.category] || ''}</span></div>
          <div class="row" style="justify-content: space-between;"><span class="muted">Data pagamento</span><span>${formatDate(p.payment_date)}</span></div>
          ${p.check_number ? `<div class="row" style="justify-content: space-between;"><span class="muted">Numero assegno</span><span style="font-family: var(--font-display);">${escapeHtml(p.check_number)}</span></div>` : ''}
          <div class="row" style="justify-content: space-between;"><span class="muted">Registrato da</span><span>${escapeHtml(p.registered_by.full_name)}</span></div>
        </div>
        ${p.notes ? `<p class="muted text-sm" style="margin: var(--space-12) 0 0 0;">${escapeHtml(p.notes)}</p>` : ''}
      </div>

      <h2 style="margin: var(--space-20) 0 var(--space-8) 0; font-family: var(--font-display); font-size: var(--text-lg);">Fatture saldate (${p.invoices.length})</h2>
      <div class="card" style="padding: 0;">
        ${p.invoices.map((i, idx) => `
          <button type="button" data-invoice="${i.id}" style="display: block; width: 100%; padding: var(--space-12) var(--space-16); ${idx > 0 ? 'border-top: 1px solid var(--border-soft);' : ''} background: transparent; border: none; text-align: left; cursor: pointer;">
            <div style="display: flex; justify-content: space-between; gap: var(--space-8); align-items: baseline;">
              <div>
                <p style="margin:0; font-weight: 500;">#${escapeHtml(i.invoice_number)}</p>
                <p class="muted text-xs" style="margin: 2px 0 0 0;">${formatDate(i.invoice_date)}</p>
              </div>
              <span style="font-family: var(--font-display);">€ ${fmt(i.amount_total)}</span>
            </div>
          </button>
        `).join('')}
      </div>

      <button type="button" id="cancel-pay" class="btn btn--ghost full-width" style="margin-top: var(--space-20); color: var(--terracotta-dark);">
        ${icon('trash', { size: 16 })}<span>Annulla pagamento</span>
      </button>
    </section>
  `;

  container.querySelectorAll('[data-invoice]').forEach((b) => {
    b.addEventListener('click', () => navigate(`/fatture/${b.dataset.invoice}`));
  });
  document.getElementById('cancel-pay').addEventListener('click', async () => {
    const ok = await confirmDialog(
      'Annullare il pagamento?',
      'Le fatture torneranno nello stato "da pagare". Operazione irreversibile.',
      { confirmLabel: 'Annulla pagamento', danger: true },
    );
    if (!ok) return;
    try {
      await apiDelete(`/payments/${id}`);
      showToast('Pagamento annullato. Le fatture sono ora da pagare.', 'success', 4000);
      navigate('/fatture/da-pagare');
    } catch (err) {
      const msg = err instanceof ApiError && err.message ? err.message : 'Errore';
      showToast(msg, 'danger', 5000);
    }
  });
}

function fmt(v) { const n = Number(v); return Number.isNaN(n) ? '0,00' : n.toFixed(2).replace('.', ','); }
function formatDate(iso) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
