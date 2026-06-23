// /fatture/:id — detail of one invoice.
//
// Admin sees the payment status block (paid/unpaid) and actions:
//   - "Registra pagamento" (if unpaid) → opens payment modal pre-filled
//   - "Vai al pagamento" (if paid) → /pagamenti/:id
//   - "Elimina" (only if unpaid)
// Manager sees only the invoice info — no payment hints.

import { apiGet, apiPatch, apiDelete, absoluteUrl, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { userHasRole } from '../../js/auth.js';
import { icon } from '../../js/icons.js';
import { showModal, showToast, confirmDialog, skeletonList, parseNumberInput } from '../../js/components.js';
import { openRegisterPaymentModal } from '../payments/modal-register.js';
import { todayLocalIso } from '../../js/dates.js';

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

  // Chi può modificare: admin sempre, manager solo fatture del mese corrente
  // (la stessa regola che il backend applica nel PATCH /invoices/{id}).
  // Confronto sul prefisso "YYYY-MM" in ora locale — niente toISOString.
  function canEdit() {
    if (isAdmin) return true;
    return inv.invoice_date.slice(0, 7) === todayLocalIso().slice(0, 7);
  }

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

        ${canEdit() ? `
          <button type="button" id="edit" class="btn btn--secondary full-width" style="margin-top: var(--space-16);">
            ${icon('edit', { size: 16 })}<span>Modifica fattura</span>
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
    const edit = document.getElementById('edit');
    if (edit) edit.addEventListener('click', openEditModal);
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

  function openEditModal() {
    // Modifica i campi che il backend accetta nel PATCH: numero, data, importo, note.
    // Fornitore e foto non sono modificabili da qui. L'importo è bloccato se la
    // fattura è già pagata (il backend lo rifiuterebbe: il totale non tornerebbe
    // più col pagamento registrato).
    const amountDisabled = inv.is_paid;
    const body = `
      <form id="edit-form" class="stack-12" novalidate>
        <div class="form-row">
          <label class="label" for="ed-supplier">Fornitore</label>
          <input id="ed-supplier" class="input" type="text" value="${escapeHtml(inv.supplier.name)}" disabled>
          <p class="muted text-xs" style="margin: var(--space-4) 0 0 0;">Il fornitore non si modifica da qui.</p>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-8);">
          <div class="form-row">
            <label class="label label--required" for="ed-number">Numero fattura</label>
            <input id="ed-number" class="input" type="text" maxlength="50" required value="${escapeHtml(inv.invoice_number)}">
          </div>
          <div class="form-row">
            <label class="label label--required" for="ed-date">Data</label>
            <input id="ed-date" class="input" type="date" required value="${escapeHtml(inv.invoice_date)}">
          </div>
        </div>
        <div class="form-row">
          <label class="label label--required" for="ed-amount">Importo totale (€)</label>
          <input id="ed-amount" class="input" type="number" step="0.01" min="0.01" required value="${escapeHtml(inv.amount_total)}" ${amountDisabled ? 'disabled' : ''}>
          ${amountDisabled ? '<p class="muted text-xs" style="margin: var(--space-4) 0 0 0;">Fattura già pagata: per cambiare l\'importo annulla prima il pagamento.</p>' : ''}
        </div>
        <div class="form-row">
          <label class="label" for="ed-notes">Note (opzionale)</label>
          <textarea id="ed-notes" class="textarea" maxlength="1000">${escapeHtml(inv.notes || '')}</textarea>
        </div>
      </form>
    `;
    showModal('Modifica fattura', body, [
      { label: 'Annulla', variant: 'ghost' },
      {
        label: 'Salva',
        variant: 'primary',
        closeOnClick: false,
        onClick: async (close) => {
          const num = document.getElementById('ed-number').value.trim();
          const dt = document.getElementById('ed-date').value;
          const notes = document.getElementById('ed-notes').value.trim();
          if (!num || !dt) {
            showToast('Numero e data sono obbligatori', 'warn'); return;
          }
          const payload = { invoice_number: num, invoice_date: dt, notes: notes || null };
          if (!amountDisabled) {
            const amount = parseNumberInput(document.getElementById('ed-amount').value);
            if (!Number.isFinite(amount) || amount <= 0) {
              showToast('Importo non valido (es. 12.50)', 'warn'); return;
            }
            payload.amount_total = amount.toFixed(2);
          }
          try {
            await apiPatch(`/invoices/${id}`, payload);
            showToast('Fattura aggiornata', 'success');
            inv = await apiGet(`/invoices/${id}`);
            render();
            close();
          } catch (err) {
            let msg = err instanceof ApiError && err.message ? err.message : 'Errore salvataggio';
            if (err instanceof ApiError && err.status === 409) {
              msg = 'Esiste già una fattura con questo numero per questo fornitore.';
            }
            showToast(msg, 'danger', 5000);
          }
        },
      },
    ]);
  }
}

function fmt(v) { const n = Number(v); return Number.isNaN(n) ? '0,00' : n.toFixed(2).replace('.', ','); }
function formatDate(iso) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
