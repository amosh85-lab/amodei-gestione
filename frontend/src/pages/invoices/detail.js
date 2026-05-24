// /fatture/:id — detail of one invoice.
//
// Admin sees the payment status block (paid/unpaid) and actions:
//   - "Registra pagamento" (if unpaid) → opens payment modal pre-filled
//   - "Vai al pagamento" (if paid) → /pagamenti/:id
//   - "Elimina" (only if unpaid)
// Manager sees only the invoice info — no payment hints.

import { apiGet, apiDelete, absoluteUrl, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { userHasRole } from '../../js/auth.js';
import { icon } from '../../js/icons.js';
import { showModal, showToast, confirmDialog, skeletonList } from '../../js/components.js';
import { openRegisterPaymentModal } from '../payments/modal-register.js';

const CAT_LABEL = { food: '🍖 Food', beverage: '🍷 Beverage', consumo: '🧴 Consumo' };
const METHOD_LABEL = { bank_transfer: '🏦 Bonifico', check: '📝 Assegno', cash: '💵 Contanti' };

export async function mountInvoiceDetail(container, params, _query) {
  const id = params.id;
  setHeader({ title: 'Fattura', brand: true, backHref: '/fatture' });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(3)}</div>`;

  const isAdmin = userHasRole('admin');
  let inv = null;
  try {
    inv = await apiGet(`/invoices/${id}`);
  } catch (err) {
    container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
      <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
        <div class="alert__body"><strong>Errore</strong>
          <p class="alert__text">${escapeHtml(err.message || '')}</p></div></div></div>`;
    return;
  }

  render();
  return () => {};

  function render() {
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-20); padding-bottom: 96px;">
        <div class="card" style="padding: var(--space-16);">
          <div style="display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-8); flex-wrap: wrap;">
            <div>
              <p style="margin:0; font-size: 1.4rem; font-weight: 600;">${escapeHtml(inv.supplier.name)}</p>
              <p class="muted text-xs" style="margin: 2px 0 0 0;">${CAT_LABEL[inv.supplier.category] || inv.supplier.category}</p>
            </div>
            <p style="margin:0; font-family: var(--font-display); font-size: 2rem;">€ ${fmt(inv.amount_total)}</p>
          </div>
          <div style="margin-top: var(--space-16); padding-top: var(--space-12); border-top: 1px solid var(--border-soft); display: grid; gap: var(--space-8);">
            <div class="row" style="justify-content: space-between;"><span class="muted">Numero fattura</span><span style="font-family: var(--font-display);">${escapeHtml(inv.invoice_number)}</span></div>
            <div class="row" style="justify-content: space-between;"><span class="muted">Data fattura</span><span>${formatDate(inv.invoice_date)}</span></div>
            <div class="row" style="justify-content: space-between;"><span class="muted">Registrata da</span><span>${escapeHtml(inv.created_by.full_name)}</span></div>
          </div>
          ${inv.notes ? `<p style="margin: var(--space-12) 0 0 0;" class="muted text-sm">${escapeHtml(inv.notes)}</p>` : ''}
        </div>

        ${inv.photo_url ? `
          <button type="button" id="view-photo" class="card" style="width: 100%; margin-top: var(--space-12); padding: var(--space-12); cursor: pointer; text-align: left; border: 1px solid var(--border-soft);">
            ${icon('image', { size: 18 })} <span style="margin-left: var(--space-8);">Vedi foto fattura</span>
          </button>` : ''}

        ${isAdmin ? renderPaymentSection() : ''}

        ${isAdmin && !inv.is_paid ? `
          <button type="button" id="del" class="btn btn--ghost full-width" style="margin-top: var(--space-20); color: var(--terracotta-dark);">
            ${icon('trash', { size: 16 })}<span>Elimina fattura</span>
          </button>` : ''}
      </section>
    `;
    wire();
  }

  function renderPaymentSection() {
    if (inv.is_paid) {
      const p = inv.payment;
      return `
        <div class="card" style="padding: var(--space-16); margin-top: var(--space-16); background: rgba(79,142,58,0.06); border: 1px solid rgba(79,142,58,0.25);">
          <p style="margin:0; font-weight: 600; color: var(--bottle-green, #4f8e3a);">✓ Pagata il ${formatDate(p.payment_date)}</p>
          <p class="muted text-sm" style="margin: var(--space-4) 0 0 0;">${METHOD_LABEL[p.method]}${p.check_number ? ` · n° ${escapeHtml(p.check_number)}` : ''}</p>
          <button type="button" id="goto-payment" class="btn btn--ghost full-width" style="margin-top: var(--space-12);">${icon('eye', { size: 16 })}<span>Vai al pagamento</span></button>
        </div>
      `;
    }
    return `
      <div class="card" style="padding: var(--space-16); margin-top: var(--space-16); background: rgba(201,148,42,0.08); border: 1px solid rgba(201,148,42,0.3);">
        <p style="margin:0; font-weight: 600; color: var(--warning, #c9942a);">Da pagare</p>
        <button type="button" id="pay-now" class="btn btn--primary full-width" style="margin-top: var(--space-12);">${icon('check', { size: 16 })}<span>Registra pagamento</span></button>
      </div>
    `;
  }

  function wire() {
    const viewPhoto = document.getElementById('view-photo');
    if (viewPhoto) viewPhoto.addEventListener('click', () => {
      showModal('Foto fattura', `<div class="center"><img src="${absoluteUrl(inv.photo_url)}" alt="Fattura" style="max-width: 100%; max-height: 70vh; border-radius: var(--radius-md);"></div>`, []);
    });
    const goto = document.getElementById('goto-payment');
    if (goto) goto.addEventListener('click', () => navigate(`/pagamenti/${inv.payment.id}`));
    const pay = document.getElementById('pay-now');
    if (pay) pay.addEventListener('click', () => {
      openRegisterPaymentModal({
        preselectedInvoiceIds: [inv.id],
        supplier: inv.supplier,
        invoices: [{ id: inv.id, invoice_number: inv.invoice_number,
                     invoice_date: inv.invoice_date, amount_total: inv.amount_total }],
        onSaved: async () => {
          // Refresh invoice
          inv = await apiGet(`/invoices/${id}`);
          render();
        },
      });
    });
    const del = document.getElementById('del');
    if (del) del.addEventListener('click', async () => {
      const ok = await confirmDialog('Eliminare la fattura?', "L'azione è irreversibile.",
                                       { confirmLabel: 'Elimina', danger: true });
      if (!ok) return;
      try {
        await apiDelete(`/invoices/${id}`);
        showToast('Fattura eliminata', 'success');
        navigate('/fatture');
      } catch (err) {
        const msg = err instanceof ApiError && err.message ? err.message : 'Errore';
        showToast(msg, 'danger', 5000);
      }
    });
  }
}

function fmt(v) { const n = Number(v); return Number.isNaN(n) ? '0,00' : n.toFixed(2).replace('.', ','); }
function formatDate(iso) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
