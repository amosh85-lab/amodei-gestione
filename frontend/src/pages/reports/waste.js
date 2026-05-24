// /report/sprechi — waste analytics (manager/admin).
//
// Reads from GET /reports/waste?from=&to=. Renders KPI + donut by reason +
// top wasted products + monthly trend line. Period filter has 3 presets
// (this month / last month / custom date range).

import { apiGet } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { icon } from '../../js/icons.js';
import { skeletonList } from '../../js/components.js';

const REASON_LABEL = {
  waste_expiry: 'Scaduto',
  waste_other:  'Altro',
};
const REASON_COLOR = {
  waste_expiry: 'var(--terracotta-dark)',
  waste_other:  'var(--ink-muted)',
};

export async function mountReportsWaste(container, _params, _query) {
  setHeader({ title: 'Report sprechi', brand: true, backHref: '/magazzino' });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(3)}</div>`;

  const state = {
    period: 'this',           // 'this' | 'previous' | 'custom'
    customFrom: '',
    customTo: '',
    data: null,
  };

  await load();
  return () => {};

  // -----------------------------------------------------------------

  async function load() {
    const { from, to } = currentRange(state);
    try {
      state.data = await apiGet(`/reports/waste?from=${from}&to=${to}`);
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

        ${renderKpi(d.total_value_lost, d.items_count)}

        <h2 style="margin: var(--space-20) 0 var(--space-8) 0; font-family: var(--font-display); font-size: var(--text-lg);">Per causale</h2>
        ${renderDonut(d.breakdown_by_reason)}

        <h2 style="margin: var(--space-20) 0 var(--space-8) 0; font-family: var(--font-display); font-size: var(--text-lg);">Prodotti più sprecati</h2>
        ${renderTopProducts(d.breakdown_by_product)}

        <h2 style="margin: var(--space-20) 0 var(--space-8) 0; font-family: var(--font-display); font-size: var(--text-lg);">Andamento mensile</h2>
        ${renderTrendChart(d.breakdown_by_month)}
      </section>
    `;
    wire();
  }

  function renderPeriodFilter() {
    return `
      <div class="card" style="padding: var(--space-12); margin-bottom: var(--space-12);">
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-4); margin-bottom: var(--space-8);">
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

  function renderKpi(total, count) {
    return `
      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: var(--space-8);">
        <div class="card" style="padding: var(--space-16);">
          <p class="muted text-xs" style="margin:0; text-transform: uppercase; letter-spacing: var(--letter-spacing-wide);">Valore perso</p>
          <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 2.2rem; font-weight: 600; color: var(--terracotta-dark);">€ ${formatMoney(total)}</p>
        </div>
        <div class="card" style="padding: var(--space-16);">
          <p class="muted text-xs" style="margin:0; text-transform: uppercase;">Lotti</p>
          <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 2.2rem; font-weight: 600;">${count}</p>
        </div>
      </div>
    `;
  }

  function renderDonut(rows) {
    if (rows.length === 0) {
      return emptyCard('Nessuno spreco nel periodo.');
    }
    const total = rows.reduce((s, r) => s + Number(r.value), 0);
    if (total === 0) return emptyCard('Nessuno spreco nel periodo.');

    const cx = 80, cy = 80, r = 70, sw = 28;
    const innerR = r - sw / 2;
    let acc = 0;
    const slices = rows.map((row) => {
      const v = Number(row.value);
      const pct = v / total;
      const a0 = acc * 2 * Math.PI - Math.PI / 2;
      acc += pct;
      const a1 = acc * 2 * Math.PI - Math.PI / 2;
      const large = (a1 - a0) > Math.PI ? 1 : 0;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      // For exactly 1 slice (100%), draw a full circle as 2 semicircles
      if (pct >= 0.9999) {
        return `<circle cx="${cx}" cy="${cy}" r="${innerR}" fill="none" stroke="${REASON_COLOR[row.reason]}" stroke-width="${sw}"/>`;
      }
      return `<path d="M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}" fill="none" stroke="${REASON_COLOR[row.reason]}" stroke-width="${sw}" stroke-linecap="butt"/>`;
    });

    const legend = rows.map((row) => {
      const v = Number(row.value);
      const pct = total > 0 ? (v / total) * 100 : 0;
      return `
        <div style="display: flex; align-items: center; gap: var(--space-8); padding: var(--space-4) 0;">
          <span style="width: 12px; height: 12px; background: ${REASON_COLOR[row.reason]}; border-radius: 3px; flex-shrink: 0;"></span>
          <span style="flex:1; font-size: var(--text-sm);">${REASON_LABEL[row.reason] || row.reason}</span>
          <span style="font-family: var(--font-display); color: var(--ink);">€ ${formatMoney(v)}</span>
          <span class="muted text-xs">${pct.toFixed(0)}%</span>
        </div>
      `;
    }).join('');

    return `
      <div class="card" style="padding: var(--space-16); display: flex; gap: var(--space-16); align-items: center; flex-wrap: wrap;">
        <svg viewBox="0 0 160 160" style="width: 140px; height: 140px; flex-shrink: 0;">
          <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="none" stroke="var(--cream-soft)" stroke-width="${sw}"/>
          ${slices.join('')}
        </svg>
        <div style="flex: 1 1 200px; min-width: 0;">${legend}</div>
      </div>
    `;
  }

  function renderTopProducts(rows) {
    if (rows.length === 0) return emptyCard('Nessun prodotto sprecato.');
    const top = rows.slice(0, 10);
    const max = Number(top[0].value_lost);
    return `
      <div class="card" style="padding: var(--space-12);">
        ${top.map((r) => {
          const v = Number(r.value_lost);
          const pct = max > 0 ? (v / max) * 100 : 0;
          return `
            <div style="padding: var(--space-8) 0; border-top: 1px solid var(--border-soft);">
              <div style="display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-8);">
                <span style="font-weight: 500;">${escapeHtml(r.product.name)}</span>
                <span style="font-family: var(--font-display); color: var(--terracotta-dark);">€ ${formatMoney(v)}</span>
              </div>
              <p class="muted text-xs" style="margin: 2px 0 0 0;">${formatMoney(r.qty)} ${escapeHtml(r.product.unit)}${r.product.category ? ' · ' + escapeHtml(r.product.category) : ''}</p>
              <div style="margin-top: var(--space-4); height: 6px; background: var(--cream-soft); border-radius: 3px; overflow: hidden;">
                <div style="height: 100%; width: ${pct.toFixed(1)}%; background: var(--terracotta);"></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderTrendChart(rows) {
    if (rows.length === 0) return emptyCard('Nessun dato mensile.');

    const W = 600, H = 200;
    const PAD = { top: 16, right: 16, bottom: 28, left: 50 };
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const values = rows.map((r) => Number(r.value_lost));
    const max = Math.max(...values, 1);
    const yScale = (v) => PAD.top + innerH - (v / max) * innerH;
    const xScale = (i) => PAD.left + (rows.length === 1 ? innerW / 2 : (i / (rows.length - 1)) * innerW);

    const pathD = rows.map((r, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i).toFixed(1)} ${yScale(Number(r.value_lost)).toFixed(1)}`).join(' ');

    const ticks = [0, max / 2, max].map((v) => ({ v, y: yScale(v) }));

    return `
      <div class="card" style="padding: var(--space-12);">
        <svg viewBox="0 0 ${W} ${H}" style="width: 100%; height: auto; display: block;" preserveAspectRatio="none">
          ${ticks.map((t) => `
            <line x1="${PAD.left}" x2="${W - PAD.right}" y1="${t.y}" y2="${t.y}" stroke="var(--border-soft)" stroke-width="1" stroke-dasharray="2 3"/>
            <text x="${PAD.left - 6}" y="${t.y + 4}" text-anchor="end" font-size="10" fill="var(--ink-muted)">€ ${shortMoney(t.v)}</text>
          `).join('')}
          ${rows.map((r, i) => `<text x="${xScale(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--ink-muted)">${escapeHtml(r.month)}</text>`).join('')}
          <path d="${pathD}" fill="none" stroke="var(--terracotta)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          ${rows.map((r, i) => `<circle cx="${xScale(i).toFixed(1)}" cy="${yScale(Number(r.value_lost)).toFixed(1)}" r="3" fill="var(--terracotta-dark)"/>`).join('')}
        </svg>
      </div>
    `;
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
          render();   // re-render to show date inputs without reload
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

function emptyCard(msg) {
  return `<p class="muted" style="margin: 0; padding: var(--space-16); text-align: center; background: var(--cream-soft); border-radius: var(--radius-md);">${escapeHtml(msg)}</p>`;
}

function formatMoney(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return '0,00';
  return n.toFixed(2).replace('.', ',');
}

function shortMoney(v) {
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace('.', ',')}k`;
  return Math.round(v).toString();
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
