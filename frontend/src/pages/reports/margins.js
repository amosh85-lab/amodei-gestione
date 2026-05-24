// /report/margini — per-product margin analysis (manager/admin).
//
// Reads from GET /reports/margins?from=&to=&sort=. Renders a totals card
// on top, then a sortable list of products with margin €/%. Tap a row to
// open a modal with the sales detail (qty + revenue + cost).

import { apiGet } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { showModal, skeletonList } from '../../js/components.js';
import { icon } from '../../js/icons.js';

export async function mountReportsMargins(container, _params, _query) {
  setHeader({ title: 'Report margini', brand: true, backHref: '/magazzino' });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(3)}</div>`;

  const state = {
    period: 'this',         // 'this' | 'previous' | 'custom'
    customFrom: '',
    customTo: '',
    sort: 'margin_pct',     // 'margin_pct' | 'margin_eur'
    data: null,
  };

  await load();
  return () => {};

  // -----------------------------------------------------------------

  async function load() {
    const { from, to } = currentRange(state);
    try {
      state.data = await apiGet(`/reports/margins?from=${from}&to=${to}&sort=${state.sort}`);
      render();
    } catch (err) {
      container.innerHTML = errorBlock(err.message || 'Errore di rete');
    }
  }

  function render() {
    const d = state.data;
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
        ${renderPeriodFilter()}

        ${d.totals ? renderTotals(d.totals) : ''}

        ${renderSortToggle()}

        <div style="margin-top: var(--space-12);">${renderList(d.rows)}</div>
      </section>
    `;
    wire();
  }

  function renderPeriodFilter() {
    return `
      <div class="card" style="padding: var(--space-12); margin-bottom: var(--space-12);">
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-4); margin-bottom: ${state.period === 'custom' ? 'var(--space-8)' : '0'};">
          ${periodBtn('this',     'Questo mese')}
          ${periodBtn('previous', 'Mese prec.')}
          ${periodBtn('custom',   'Personalizzato')}
        </div>
        ${state.period === 'custom' ? `
          <div style="display: grid; grid-template-columns: 1fr 1fr auto; gap: var(--space-8); align-items: end;">
            <div><label class="label" style="margin:0;">Da</label><input type="date" id="from" class="input" value="${state.customFrom}"></div>
            <div><label class="label" style="margin:0;">A</label><input type="date" id="to" class="input" value="${state.customTo}"></div>
            <button type="button" id="apply" class="btn btn--primary">Applica</button>
          </div>
        ` : ''}
      </div>
    `;
  }

  function periodBtn(id, label) {
    const active = state.period === id;
    return `<button type="button" data-period="${id}" style="
      padding: var(--space-8); border-radius: var(--radius-md);
      border: 1px solid ${active ? 'var(--terracotta)' : 'var(--border-soft)'};
      background: ${active ? 'var(--terracotta)' : 'var(--off-white)'};
      color: ${active ? 'var(--off-white)' : 'var(--ink)'};
      font-size: var(--text-sm); cursor: pointer;">${label}</button>`;
  }

  function renderTotals(t) {
    const pct = t.margin_pct == null ? '—' : `${Number(t.margin_pct).toFixed(1).replace('.', ',')}%`;
    return `
      <div style="background: var(--ink); color: var(--off-white); border-radius: var(--radius-xl); padding: var(--space-20); margin-bottom: var(--space-12);">
        <p style="margin:0; font-size: var(--text-xs); text-transform: uppercase; letter-spacing: var(--letter-spacing-wide); opacity: 0.7; color: inherit;">Totale del periodo</p>
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: var(--space-8);">
          <span style="font-family: var(--font-display); font-size: 2rem; font-weight: 600; color: inherit;">€ ${formatMoney(t.margin_eur)}</span>
          <span style="font-family: var(--font-display); font-size: var(--text-lg); color: inherit; opacity: 0.85;">${pct}</span>
        </div>
        <div style="margin-top: var(--space-12); padding-top: var(--space-12); border-top: 1px solid rgba(255,255,255,0.15); display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-8); font-size: var(--text-sm); color: inherit;">
          <div><p class="text-xs" style="margin:0; opacity:0.7; color: inherit;">Ricavi</p><p style="margin:2px 0 0 0; font-family: var(--font-display); color: inherit;">€ ${formatMoney(t.sales_revenue)}</p></div>
          <div><p class="text-xs" style="margin:0; opacity:0.7; color: inherit;">Costi</p><p style="margin:2px 0 0 0; font-family: var(--font-display); color: inherit;">€ ${formatMoney(t.cost)}</p></div>
        </div>
      </div>
    `;
  }

  function renderSortToggle() {
    return `
      <div style="display: flex; align-items: center; gap: var(--space-8); margin-bottom: var(--space-8);">
        <span class="muted text-xs" style="text-transform: uppercase; letter-spacing: var(--letter-spacing-wide);">Ordina per</span>
        <button type="button" data-sort="margin_pct" class="btn btn--sm ${state.sort === 'margin_pct' ? 'btn--primary' : 'btn--ghost'}">margine %</button>
        <button type="button" data-sort="margin_eur" class="btn btn--sm ${state.sort === 'margin_eur' ? 'btn--primary' : 'btn--ghost'}">margine €</button>
      </div>
    `;
  }

  function renderList(rows) {
    if (rows.length === 0) {
      return `<p class="muted" style="margin: 0; padding: var(--space-16); text-align: center; background: var(--cream-soft); border-radius: var(--radius-md);">Nessuna vendita nel periodo.</p>`;
    }
    return `
      <div class="card" style="padding: 0;">
        ${rows.map((r, i) => {
          const pct = r.margin_pct == null ? '—' : `${Number(r.margin_pct).toFixed(1).replace('.', ',')}%`;
          const pctColor = r.margin_pct == null ? 'var(--ink-muted)'
                          : Number(r.margin_pct) >= 50 ? 'var(--success, #4f8e3a)'
                          : Number(r.margin_pct) >= 20 ? 'var(--warning, #c9942a)'
                          : 'var(--terracotta-dark)';
          return `
            <button type="button" data-product-idx="${i}" style="
              display: block; width: 100%; padding: var(--space-12) var(--space-16);
              ${i > 0 ? 'border-top: 1px solid var(--border-soft);' : ''}
              background: transparent; border: none; text-align: left; cursor: pointer;">
              <div style="display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-8);">
                <span style="font-weight: 500;">${escapeHtml(r.product.name)}</span>
                <span style="font-family: var(--font-display); color: var(--ink);">€ ${formatMoney(r.margin_eur)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: 2px;">
                <span class="muted text-xs">${formatMoney(r.sales_qty)} ${escapeHtml(r.product.unit)}${r.product.category ? ' · ' + escapeHtml(r.product.category) : ''}</span>
                <span style="font-family: var(--font-display); font-size: var(--text-sm); color: ${pctColor};">${pct}</span>
              </div>
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  function openDetail(row) {
    const pct = row.margin_pct == null ? '—' : `${Number(row.margin_pct).toFixed(1).replace('.', ',')}%`;
    const body = `
      <div style="display: grid; gap: var(--space-12);">
        ${detailLine('Quantità venduta', `${formatMoney(row.sales_qty)} ${escapeHtml(row.product.unit)}`)}
        ${detailLine('Ricavi',           `€ ${formatMoney(row.sales_revenue)}`)}
        ${detailLine('Costi',            `€ ${formatMoney(row.cost)}`)}
        ${detailLine('Margine',          `€ ${formatMoney(row.margin_eur)}`, true)}
        ${detailLine('Margine %',        pct, true)}
        ${row.product.category ? `<p class="muted text-xs" style="margin: var(--space-8) 0 0 0;">Categoria: ${escapeHtml(row.product.category)}</p>` : ''}
        <p class="muted text-xs" style="margin: var(--space-4) 0 0 0;">I ricavi usano il prezzo di vendita corrente del prodotto. I costi sono la somma di qty × prezzo unitario del lotto da cui ogni vendita è stata scaricata.</p>
      </div>
    `;
    showModal(row.product.name, body, [{ label: 'Chiudi', variant: 'ghost' }]);
  }

  function detailLine(label, value, bold = false) {
    return `<div style="display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-8); padding: var(--space-4) 0; border-bottom: 1px solid var(--border-soft); ${bold ? 'font-weight: 600;' : ''}">
      <span>${escapeHtml(label)}</span>
      <span style="font-family: var(--font-display);">${value}</span>
    </div>`;
  }

  function wire() {
    container.querySelectorAll('[data-period]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = btn.dataset.period;
        if (state.period === p && p !== 'custom') return;
        state.period = p;
        if (p === 'custom') {
          const { from, to } = currentRange(state);
          state.customFrom = state.customFrom || from;
          state.customTo = state.customTo || to;
          render();
          return;
        }
        load();
      });
    });
    const apply = container.querySelector('#apply');
    if (apply) {
      apply.addEventListener('click', () => {
        const f = container.querySelector('#from').value;
        const t = container.querySelector('#to').value;
        if (!f || !t) return;
        state.customFrom = f;
        state.customTo = t;
        load();
      });
    }
    container.querySelectorAll('[data-sort]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (state.sort === btn.dataset.sort) return;
        state.sort = btn.dataset.sort;
        load();
      });
    });
    container.querySelectorAll('[data-product-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.productIdx, 10);
        openDetail(state.data.rows[idx]);
      });
    });
  }
}

// ---------- helpers ----------

function currentRange(state) {
  if (state.period === 'custom' && state.customFrom && state.customTo) {
    return { from: state.customFrom, to: state.customTo };
  }
  const now = new Date();
  if (state.period === 'previous') {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return monthRange(d.getFullYear(), d.getMonth());
  }
  return monthRange(now.getFullYear(), now.getMonth());
}

function monthRange(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: fmt(first), to: fmt(last) };
}

function formatMoney(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return '0,00';
  return n.toFixed(2).replace('.', ',');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function errorBlock(msg) {
  return `<div class="container" style="padding-top: var(--space-20);">
    <div class="alert alert--urgent">
      <span class="alert__icon">${icon('alert', { size: 22 })}</span>
      <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(msg)}</p></div>
    </div>
  </div>`;
}
