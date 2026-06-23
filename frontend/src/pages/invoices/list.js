// /fatture — supplier invoice list (manager/admin).
//
// Filtri: periodo (mese/trimestre/anno/custom), categoria (food/beverage/consumo),
// stato pagamento (solo admin: tutte/pagate/da pagare), fornitore.
// KPI in alto: totale mese corrente, totale da pagare, totale anno.
// Tap card → /fatture/{id}.

import { apiGet } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { userHasRole } from '../../js/auth.js';
import { icon } from '../../js/icons.js';
import { skeletonList, docTabs } from '../../js/components.js';

const CAT_LABEL = { food: '🍖 Food', beverage: '🍷 Beverage', consumo: '🧴 Consumo' };
const CAT_COLOR = {
  food:     'background: rgba(181,57,31,0.12); color: var(--terracotta-dark);',
  beverage: 'background: rgba(79,142,58,0.12); color: var(--bottle-green, #4f8e3a);',
  consumo:  'background: rgba(120,120,120,0.12); color: var(--ink-muted);',
};

export async function mountInvoicesList(container, _params, query) {
  const isAdmin = userHasRole('admin');
  setHeader({
    title: 'Fatture',
    brand: true,
    backHref: '/',
    actions: [
      ...(isAdmin ? [
        { label: 'Scadenziario', iconName: 'clock', onClick: () => navigate('/fatture/da-pagare') },
        { label: 'Pagamenti', iconName: 'check', onClick: () => navigate('/pagamenti') },
      ] : []),
      { label: 'Nuova', iconName: 'plus', onClick: () => navigate('/fatture/nuova') },
    ],
  });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(3)}</div>`;

  const state = {
    period: query.period || 'month',           // month | quarter | year | custom
    customFrom: query.from || '',
    customTo: query.to || '',
    category: query.category || '',
    paid: query.paid || '',                    // '' | 'true' | 'false'  (admin only)
    supplierId: query.supplier || '',
    invoices: [],
    suppliers: [],
    unpaidTotal: 0,
    yearTotal: 0,
    error: null,
  };

  await load();
  return () => {};

  async function load() {
    state.error = null;
    const { from, to } = currentRange(state);
    const params = new URLSearchParams({ from_date: from, to_date: to });
    if (state.category) params.set('category', state.category);
    if (state.supplierId) params.set('supplier_id', state.supplierId);
    if (isAdmin && state.paid) params.set('paid', state.paid);
    try {
      const [invs, sups, unpaid] = await Promise.all([
        apiGet(`/invoices?${params.toString()}`),
        apiGet('/suppliers?active=true').catch(() => []),
        isAdmin ? apiGet('/invoices/unpaid').catch(() => ({ total_unpaid: 0 })) : Promise.resolve({ total_unpaid: 0 }),
      ]);
      state.invoices = invs;
      state.suppliers = sups;
      state.unpaidTotal = Number(unpaid.total_unpaid || 0);
      // Year total (always fetched, separate light call)
      const yearRange = yearRangeIso();
      const yearInvs = await apiGet(`/invoices?from_date=${yearRange.from}&to_date=${yearRange.to}&limit=1000`)
        .catch(() => []);
      state.yearTotal = yearInvs.reduce((s, i) => s + Number(i.amount_total), 0);
      render();
    } catch (err) {
      state.error = err.message || 'Errore di rete';
      container.innerHTML = errorBlock(state.error, load);
    }
  }

  function render() {
    const monthTotal = state.invoices.reduce((s, i) => s + Number(i.amount_total), 0);
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
        ${docTabs('fatture')}
        ${renderKpi(monthTotal)}
        ${renderFilters()}
        <div id="inv-body" style="margin-top: var(--space-12);">${renderList()}</div>
      </section>
    `;
    wire();
  }

  function renderKpi(monthTotal) {
    return `
      <div style="display: grid; grid-template-columns: ${isAdmin ? '1fr 1fr 1fr' : '1fr 1fr'}; gap: var(--space-8); margin-bottom: var(--space-16);">
        <div class="card" style="padding: var(--space-12);">
          <p class="muted text-xs" style="margin:0; text-transform: uppercase;">Periodo</p>
          <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 1.4rem; font-weight: 600;">€ ${fmt(monthTotal)}</p>
          <p class="muted text-xs" style="margin: 2px 0 0 0;">${state.invoices.length} fatture</p>
        </div>
        ${isAdmin ? `
          <div class="card" style="padding: var(--space-12);">
            <p class="muted text-xs" style="margin:0; text-transform: uppercase;">Da pagare</p>
            <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 1.4rem; font-weight: 600; color: var(--terracotta-dark);">€ ${fmt(state.unpaidTotal)}</p>
          </div>
        ` : ''}
        <div class="card" style="padding: var(--space-12);">
          <p class="muted text-xs" style="margin:0; text-transform: uppercase;">Anno ${new Date().getFullYear()}</p>
          <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 1.4rem; font-weight: 600;">€ ${fmt(state.yearTotal)}</p>
        </div>
      </div>
    `;
  }

  function renderFilters() {
    return `
      <div class="card" style="padding: var(--space-12); margin-bottom: var(--space-12);">
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-4); margin-bottom: var(--space-8);">
          ${periodBtn('month',    'Mese')}
          ${periodBtn('quarter',  'Trim.')}
          ${periodBtn('year',     'Anno')}
          ${periodBtn('custom',   'Pers.')}
        </div>
        ${state.period === 'custom' ? `
          <div style="display: grid; grid-template-columns: 1fr 1fr auto; gap: var(--space-8); align-items: end; margin-bottom: var(--space-8);">
            <div><label class="label" style="margin:0;">Da</label><input type="date" id="from" class="input" value="${state.customFrom}"></div>
            <div><label class="label" style="margin:0;">A</label><input type="date" id="to" class="input" value="${state.customTo}"></div>
            <button type="button" id="apply" class="btn btn--primary">Applica</button>
          </div>
        ` : ''}
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-4); margin-bottom: ${isAdmin ? 'var(--space-8)' : '0'};">
          ${catBtn('',         'Tutte')}
          ${catBtn('food',     'Food')}
          ${catBtn('beverage', 'Bevande')}
          ${catBtn('consumo',  'Consumo')}
        </div>
        ${isAdmin ? `
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-4);">
            ${paidBtn('',      'Tutte')}
            ${paidBtn('true',  'Pagate')}
            ${paidBtn('false', 'Da pagare')}
          </div>
        ` : ''}
      </div>
    `;
  }

  function periodBtn(id, label) {
    const active = state.period === id;
    return chipBtn(`data-period="${id}"`, label, active);
  }
  function catBtn(id, label) {
    const active = state.category === id;
    return chipBtn(`data-cat="${id}"`, label, active);
  }
  function paidBtn(id, label) {
    const active = state.paid === id;
    return chipBtn(`data-paid="${id}"`, label, active);
  }
  function chipBtn(attrs, label, active) {
    return `<button type="button" ${attrs} style="
      padding: var(--space-8); border-radius: var(--radius-md);
      border: 1px solid ${active ? 'var(--terracotta)' : 'var(--border-soft)'};
      background: ${active ? 'var(--terracotta)' : 'var(--off-white)'};
      color: ${active ? 'var(--off-white)' : 'var(--ink)'};
      font-size: var(--text-sm); cursor: pointer;">${label}</button>`;
  }

  function renderList() {
    if (state.invoices.length === 0) {
      return `<p class="muted" style="margin: 0; padding: var(--space-16); text-align: center; background: var(--cream-soft); border-radius: var(--radius-md);">Nessuna fattura per questo periodo.</p>`;
    }
    return `<div class="card" style="padding: 0;">
      ${state.invoices.map((inv, i) => row(inv, i)).join('')}
    </div>`;
  }

  function row(inv, i) {
    const catBadge = `<span class="badge" style="${CAT_COLOR[inv.supplier.category]} white-space: nowrap; font-size: var(--text-xs);">${CAT_LABEL[inv.supplier.category] || inv.supplier.category}</span>`;
    const paidBadge = isAdmin && 'is_paid' in inv
      ? (inv.is_paid
        ? `<span class="badge" style="background: rgba(79,142,58,0.15); color: var(--bottle-green, #4f8e3a); white-space: nowrap;">✓ Pagata</span>`
        : `<span class="badge" style="background: rgba(201,148,42,0.15); color: var(--warning, #c9942a); white-space: nowrap;">Da pagare</span>`)
      : '';
    return `
      <button type="button" data-id="${inv.id}" style="
        display: block; width: 100%; padding: var(--space-12) var(--space-16);
        ${i > 0 ? 'border-top: 1px solid var(--border-soft);' : ''}
        background: transparent; border: none; text-align: left; cursor: pointer;">
        <div style="display: flex; justify-content: space-between; gap: var(--space-8); align-items: baseline;">
          <div style="min-width: 0; flex: 1;">
            <div style="display: flex; gap: var(--space-8); align-items: center; flex-wrap: wrap;">
              <span style="font-weight: 600;">${escapeHtml(inv.supplier.name)}</span>
              ${catBadge}
              ${paidBadge}
            </div>
            <p class="muted text-xs" style="margin: 2px 0 0 0;">#${escapeHtml(inv.invoice_number)} · ${formatDate(inv.invoice_date)}</p>
          </div>
          <span style="font-family: var(--font-display); font-size: 1.2rem;">€ ${fmt(inv.amount_total)}</span>
        </div>
      </button>
    `;
  }

  function wire() {
    container.querySelectorAll('[data-doctab]').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.dataset.doctab !== '/fatture') navigate(b.dataset.doctab);
      });
    });
    container.querySelectorAll('[data-period]').forEach((b) => {
      b.addEventListener('click', () => {
        if (state.period === b.dataset.period && b.dataset.period !== 'custom') return;
        state.period = b.dataset.period;
        if (b.dataset.period === 'custom') {
          const r = currentRange(state);
          state.customFrom = state.customFrom || r.from;
          state.customTo = state.customTo || r.to;
          render(); return;
        }
        load();
      });
    });
    const apply = container.querySelector('#apply');
    if (apply) apply.addEventListener('click', () => {
      state.customFrom = container.querySelector('#from').value;
      state.customTo = container.querySelector('#to').value;
      load();
    });
    container.querySelectorAll('[data-cat]').forEach((b) => {
      b.addEventListener('click', () => { state.category = b.dataset.cat; load(); });
    });
    container.querySelectorAll('[data-paid]').forEach((b) => {
      b.addEventListener('click', () => { state.paid = b.dataset.paid; load(); });
    });
    container.querySelectorAll('[data-id]').forEach((b) => {
      b.addEventListener('click', () => navigate(`/fatture/${b.dataset.id}`));
    });
  }
}

// ---------- helpers ----------

function currentRange(state) {
  const now = new Date();
  if (state.period === 'custom' && state.customFrom && state.customTo) {
    return { from: state.customFrom, to: state.customTo };
  }
  if (state.period === 'year') {
    return yearRangeIso();
  }
  if (state.period === 'quarter') {
    const q = Math.floor(now.getMonth() / 3);
    return monthRangeAround(now.getFullYear(), q * 3, 3);
  }
  return monthRangeAround(now.getFullYear(), now.getMonth(), 1);
}

function monthRangeAround(year, startMonth, monthsCount) {
  const first = new Date(year, startMonth, 1);
  const last = new Date(year, startMonth + monthsCount, 0);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: fmt(first), to: fmt(last) };
}

function yearRangeIso() {
  const y = new Date().getFullYear();
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

function fmt(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return '0,00';
  return n.toFixed(2).replace('.', ',');
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function errorBlock(msg, onRetry) {
  setTimeout(() => {
    const btn = document.getElementById('retry-load');
    if (btn) btn.addEventListener('click', onRetry);
  }, 0);
  return `<div class="container" style="padding-top: var(--space-20);">
    <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
      <div class="alert__body"><strong>Errore</strong>
        <p class="alert__text">${escapeHtml(msg)}</p>
        <button type="button" id="retry-load" class="btn btn--secondary btn--sm" style="margin-top: var(--space-8);">Riprova</button>
      </div></div></div>`;
}
