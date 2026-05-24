// /pagamenti — admin only payments dashboard.

import { apiGet } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { icon } from '../../js/icons.js';
import { skeletonList } from '../../js/components.js';

const METHOD_LABEL = { bank_transfer: '🏦 Bonifico', check: '📝 Assegno', cash: '💵 Contanti' };
const METHOD_COLOR = {
  bank_transfer: 'var(--ink)', check: 'var(--terracotta-dark)', cash: 'var(--bottle-green, #4f8e3a)',
};

export async function mountPaymentsList(container, _params, _query) {
  setHeader({ title: 'Pagamenti', brand: true, backHref: '/fatture' });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(3)}</div>`;

  const state = {
    method: '',
    summary: null,
    payments: [],
  };

  await load();
  return () => {};

  async function load() {
    try {
      const [summary, payments] = await Promise.all([
        apiGet('/payments/summary/monthly'),
        apiGet(`/payments${state.method ? `?method=${state.method}` : ''}`),
      ]);
      state.summary = summary;
      state.payments = payments;
      render();
    } catch (err) {
      container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
        <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
          <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(err.message || '')}</p></div></div></div>`;
    }
  }

  function render() {
    const s = state.summary;
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-8); margin-bottom: var(--space-12);">
          <div class="card" style="padding: var(--space-12);">
            <p class="muted text-xs" style="margin:0; text-transform: uppercase;">Totale mese</p>
            <p style="margin: 4px 0 0 0; font-family: var(--font-display); font-size: 1.4rem; font-weight: 600;">€ ${fmt(s.total_paid)}</p>
            <p class="muted text-xs" style="margin: 2px 0 0 0;">${s.count} pagamenti</p>
          </div>
          <div class="card" style="padding: var(--space-12);">
            <p class="muted text-xs" style="margin:0; text-transform: uppercase;">Per metodo</p>
            <p style="margin: 4px 0 0 0; font-size: var(--text-sm);">🏦 € ${fmt(s.by_method.bank_transfer)}</p>
            <p style="margin: 0; font-size: var(--text-sm);">📝 € ${fmt(s.by_method.check)} · 💵 € ${fmt(s.by_method.cash)}</p>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-4); margin-bottom: var(--space-12);">
          ${methodBtn('',              'Tutti')}
          ${methodBtn('bank_transfer', '🏦')}
          ${methodBtn('check',         '📝')}
          ${methodBtn('cash',          '💵')}
        </div>
        ${state.payments.length === 0
          ? '<p class="muted" style="text-align: center; padding: var(--space-16); background: var(--cream-soft); border-radius: var(--radius-md);">Nessun pagamento.</p>'
          : `<div class="card" style="padding: 0;">${state.payments.map(renderRow).join('')}</div>`}
      </section>
    `;
    wire();
  }

  function methodBtn(id, label) {
    const active = state.method === id;
    return `<button type="button" data-method="${id}" style="
      padding: var(--space-8); border-radius: var(--radius-md);
      border: 1px solid ${active ? 'var(--terracotta)' : 'var(--border-soft)'};
      background: ${active ? 'var(--terracotta)' : 'var(--off-white)'};
      color: ${active ? 'var(--off-white)' : 'var(--ink)'};
      font-size: var(--text-sm); cursor: pointer;">${label}</button>`;
  }

  function renderRow(p, i) {
    return `
      <button type="button" data-id="${p.id}" style="display: block; width: 100%; padding: var(--space-12) var(--space-16); ${i > 0 ? 'border-top: 1px solid var(--border-soft);' : ''} background: transparent; border: none; text-align: left; cursor: pointer;">
        <div style="display: flex; justify-content: space-between; gap: var(--space-8); align-items: baseline;">
          <div>
            <p style="margin:0; font-weight: 600; color: ${METHOD_COLOR[p.method]};">${METHOD_LABEL[p.method]}</p>
            <p class="muted text-xs" style="margin: 2px 0 0 0;">${escapeHtml(p.supplier?.name || '—')}${p.check_number ? ` · n° ${escapeHtml(p.check_number)}` : ''}</p>
            <p class="muted text-xs" style="margin: 2px 0 0 0;">${p.invoices.length} fatture · ${formatDate(p.payment_date)}</p>
          </div>
          <span style="font-family: var(--font-display); font-size: 1.2rem;">€ ${fmt(p.amount_total)}</span>
        </div>
      </button>
    `;
  }

  function wire() {
    container.querySelectorAll('[data-method]').forEach((b) => {
      b.addEventListener('click', () => { state.method = b.dataset.method; load(); });
    });
    container.querySelectorAll('[data-id]').forEach((b) => {
      b.addEventListener('click', () => navigate(`/pagamenti/${b.dataset.id}`));
    });
  }
}

function fmt(v) { const n = Number(v); return Number.isNaN(n) ? '0,00' : n.toFixed(2).replace('.', ','); }
function formatDate(iso) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
