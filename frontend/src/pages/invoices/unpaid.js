// /fatture/da-pagare — scadenziario admin-only.
//
// Lista fatture non pagate raggruppate per fornitore. Ogni fornitore ha
// checkbox per ciascuna fattura (tutte preselezionate); total selezionato
// aggiornato live; bottone "Registra pagamento" apre il modal.

import { apiGet, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { icon } from '../../js/icons.js';
import { showToast, skeletonList } from '../../js/components.js';
import { openRegisterPaymentModal } from '../payments/modal-register.js';

const CAT_LABEL = { food: '🍖 Food', beverage: '🍷 Beverage', consumo: '🧴 Consumo' };

export async function mountInvoicesUnpaid(container, _params, _query) {
  setHeader({ title: 'Scadenziario', brand: true, backHref: '/fatture' });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(3)}</div>`;

  const state = {
    data: null,
    selected: new Map(),    // supplier_id → Set of invoice_id
  };

  await load();
  return () => {};

  async function load() {
    try {
      state.data = await apiGet('/invoices/unpaid');
      // Preselect all
      state.selected = new Map();
      for (const g of state.data.by_supplier) {
        state.selected.set(g.supplier.id, new Set(g.invoices.map((i) => i.id)));
      }
      render();
    } catch (err) {
      const msg = err instanceof ApiError && err.message ? err.message : 'Errore';
      container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
        <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
          <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(msg)}</p></div></div></div>`;
    }
  }

  function render() {
    const total = state.data.total_unpaid;
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
        <div class="card" style="padding: var(--space-16); margin-bottom: var(--space-16); background: var(--ink); color: var(--off-white);">
          <p class="text-xs" style="margin:0; text-transform: uppercase; letter-spacing: var(--letter-spacing-wide); opacity: 0.7; color: inherit;">Totale da pagare</p>
          <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 2.4rem; font-weight: 600; color: inherit;">€ ${fmt(total)}</p>
          <p class="text-xs" style="margin: 2px 0 0 0; opacity: 0.7; color: inherit;">${state.data.count} fatture · ${state.data.by_supplier.length} fornitori</p>
        </div>
        ${state.data.by_supplier.length === 0
          ? '<p class="muted" style="text-align: center; padding: var(--space-20); background: var(--cream-soft); border-radius: var(--radius-md);">Niente da pagare. 🎉</p>'
          : state.data.by_supplier.map(renderGroup).join('')}
      </section>
    `;
    wire();
  }

  function renderGroup(g) {
    const sel = state.selected.get(g.supplier.id) || new Set();
    const selectedTotal = g.invoices.filter((i) => sel.has(i.id)).reduce((s, i) => s + Number(i.amount_total), 0);
    return `
      <div class="card" style="padding: var(--space-12); margin-bottom: var(--space-12);">
        <div style="display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-8); flex-wrap: wrap;">
          <div>
            <p style="margin:0; font-weight: 600;">${escapeHtml(g.supplier.name)}</p>
            <p class="muted text-xs" style="margin: 2px 0 0 0;">${g.count} fatture · ${CAT_LABEL[g.supplier.category] || g.supplier.category}</p>
          </div>
          <p style="margin:0; font-family: var(--font-display); font-size: 1.4rem; color: var(--terracotta-dark);">€ ${fmt(g.total)}</p>
        </div>
        <div style="border-top: 1px solid var(--border-soft); margin-top: var(--space-8); padding-top: var(--space-8);">
          ${g.invoices.map((i) => `
            <label style="display: flex; align-items: center; gap: var(--space-8); padding: var(--space-4) 0; cursor: pointer;">
              <input type="checkbox" data-supplier="${g.supplier.id}" data-invoice="${i.id}" ${sel.has(i.id) ? 'checked' : ''}>
              <span class="flex-1 text-sm">
                <a href="#/fatture/${i.id}" data-invoice-link class="muted" style="text-decoration: none;">#${escapeHtml(i.invoice_number)} · ${formatDate(i.invoice_date)}</a>
              </span>
              <span style="font-family: var(--font-display);">€ ${fmt(i.amount_total)}</span>
            </label>
          `).join('')}
        </div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: var(--space-12); padding-top: var(--space-12); border-top: 1px solid var(--border-soft);">
          <span class="muted text-sm">Selezionato</span>
          <span style="font-family: var(--font-display); font-size: 1.2rem;">€ ${fmt(selectedTotal)}</span>
        </div>
        <button type="button" data-pay-supplier="${g.supplier.id}" class="btn btn--primary full-width" style="margin-top: var(--space-12);" ${sel.size === 0 ? 'disabled' : ''}>
          ${icon('check', { size: 16 })}<span>Registra pagamento</span>
        </button>
      </div>
    `;
  }

  function wire() {
    container.querySelectorAll('input[type="checkbox"][data-invoice]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const sid = Number(cb.dataset.supplier);
        const iid = Number(cb.dataset.invoice);
        const set = state.selected.get(sid) || new Set();
        if (cb.checked) set.add(iid); else set.delete(iid);
        state.selected.set(sid, set);
        render();
      });
    });
    container.querySelectorAll('[data-pay-supplier]').forEach((b) => {
      b.addEventListener('click', () => {
        const sid = Number(b.dataset.paySupplier);
        const group = state.data.by_supplier.find((g) => g.supplier.id === sid);
        if (!group) return;
        const sel = state.selected.get(sid) || new Set();
        const invoices = group.invoices.filter((i) => sel.has(i.id));
        if (invoices.length === 0) { showToast('Seleziona almeno una fattura', 'warn'); return; }
        openRegisterPaymentModal({
          preselectedInvoiceIds: invoices.map((i) => i.id),
          supplier: group.supplier,
          invoices,
          onSaved: () => load(),
        });
      });
    });
    container.querySelectorAll('[data-invoice-link]').forEach((a) => {
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        const href = a.getAttribute('href') || '';
        navigate(href.replace(/^#/, ''));
      });
    });
  }
}

function fmt(v) { const n = Number(v); return Number.isNaN(n) ? '0,00' : n.toFixed(2).replace('.', ','); }
function formatDate(iso) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
