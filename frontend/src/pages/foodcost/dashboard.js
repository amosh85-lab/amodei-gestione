// /food-cost — monthly food cost dashboard (manager/admin).

import { apiGet } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { icon } from '../../js/icons.js';
import { skeletonList } from '../../js/components.js';

const CAT_LABEL = { food: '🍖 Food', beverage: '🍷 Beverage', consumo: '🧴 Consumo' };
const CAT_COLOR = { food: 'var(--terracotta-dark)', beverage: 'var(--bottle-green, #4f8e3a)', consumo: 'var(--ink-muted)' };
const STATUS_DOT = { ok: '🟢', warn: '🟠', alert: '🔴' };

export async function mountFoodcostDashboard(container, _params, query) {
  setHeader({ title: 'Food Cost', brand: true, backHref: '/' });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(4)}</div>`;

  const now = new Date();
  const state = {
    year: parseInt(query.year, 10) || now.getFullYear(),
    month: parseInt(query.month, 10) || (now.getMonth() + 1),   // 1-indexed
    data: null,
    trend: null,
  };

  await load();
  return () => {};

  async function load() {
    try {
      const [data, trend] = await Promise.all([
        apiGet(`/foodcost/monthly?year=${state.year}&month=${state.month}`),
        apiGet('/foodcost/trend?months=6'),
      ]);
      state.data = data;
      state.trend = trend;
      render();
    } catch (err) {
      container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
        <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
          <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(err.message || '')}</p></div></div></div>`;
    }
  }

  function render() {
    const d = state.data;
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
        ${renderMonthNav()}
        ${renderWarnings(d)}
        ${renderOperatingCard(d)}
        ${renderCategoryCards(d)}
        ${renderTrend(state.trend, d.threshold_pct)}
      </section>
    `;
    wire();
  }

  function renderMonthNav() {
    return `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-12);">
        <button type="button" data-nav="prev" class="btn btn--ghost btn--icon" aria-label="Mese precedente">${icon('chevron-left', { size: 22 })}</button>
        <p style="margin:0; font-family: var(--font-display); font-size: var(--text-lg); text-transform: capitalize; font-weight: 500;">${escapeHtml(state.data.month_label)}</p>
        <button type="button" data-nav="next" class="btn btn--ghost btn--icon" aria-label="Mese successivo">${icon('chevron-right', { size: 22 })}</button>
      </div>
    `;
  }

  function renderWarnings(d) {
    const warnings = [];
    const today = new Date();
    if (state.year === today.getFullYear() && state.month === today.getMonth() + 1) {
      warnings.push('Il mese è in corso. Il dato si stabilizzerà a fine mese.');
    }
    if (d.revenue.computed_days_count < d.revenue.month_days_count) {
      warnings.push(`Solo ${d.revenue.computed_days_count} su ${d.revenue.month_days_count} giorni hanno l'incasso reale registrato. Il food cost si aggiorna man mano che inserisci i dati di cassa.`);
    }
    if (warnings.length === 0) return '';
    return warnings.map((w) => `
      <div class="alert alert--warn" style="margin-bottom: var(--space-8);">
        <span class="alert__icon">${icon('warning', { size: 20 })}</span>
        <div class="alert__body"><p class="alert__text">${escapeHtml(w)}</p></div>
      </div>`).join('');
  }

  function renderOperatingCard(d) {
    const op = d.operating_total;
    const colorByStatus = { ok: 'var(--bottle-green, #4f8e3a)', warn: 'var(--warning, #c9942a)', alert: 'var(--terracotta-dark)' };
    const color = colorByStatus[op.status] || 'var(--ink)';
    return `
      <div class="card" style="padding: var(--space-20); margin-bottom: var(--space-16); background: var(--ink); color: var(--off-white);">
        <p class="text-xs" style="margin:0; text-transform: uppercase; opacity: 0.7; color: inherit;">Costo operativo totale</p>
        <p style="margin: var(--space-12) 0; font-family: var(--font-display); font-size: 3rem; font-weight: 600; line-height: 1; color: ${color};">
          ${pct(op.pct_computed)} ${STATUS_DOT[op.status] || ''}
        </p>
        <p class="text-sm" style="margin: 0 0 var(--space-4) 0; opacity: 0.8; color: inherit;">
          Su incasso reale di € ${fmt(d.revenue.computed)}
        </p>
        <p class="text-sm" style="margin: 0; opacity: 0.8; color: inherit;">
          Costi totali: € ${fmt(op.total)}
        </p>
        <p class="text-xs" style="margin: var(--space-12) 0 0 0; opacity: 0.6; color: inherit; padding-top: var(--space-8); border-top: 1px solid rgba(255,255,255,0.15);">
          Riferimento fiscale: ${pct(op.pct_fiscal)} (€ ${fmt(d.revenue.fiscal)})
        </p>
      </div>
    `;
  }

  function renderCategoryCards(d) {
    return `
      <div style="display: grid; gap: var(--space-12); margin-bottom: var(--space-16);">
        ${['food', 'beverage', 'consumo'].map((cat) => renderCatCard(cat, d.categories[cat], d.threshold_pct)).join('')}
      </div>
    `;
  }

  function renderCatCard(cat, c, threshold) {
    const dot = STATUS_DOT[c.status] || '';
    return `
      <div class="card" style="padding: var(--space-16); border-left: 4px solid ${CAT_COLOR[cat]};">
        <p class="muted text-xs" style="margin:0; text-transform: uppercase; letter-spacing: var(--letter-spacing-wide);">${CAT_LABEL[cat]}</p>
        <p style="margin: var(--space-4) 0 var(--space-8) 0; font-family: var(--font-display); font-size: 1.8rem; font-weight: 600;">
          ${pct(c.pct_computed)} ${dot}
        </p>
        <p class="muted text-sm" style="margin:0;">€ ${fmt(c.total)} · ${c.invoices_count} fatture</p>
        <p class="muted text-xs" style="margin: var(--space-4) 0 var(--space-12) 0;">Soglia: ${pct(threshold)}</p>
        <button type="button" data-cat-detail="${cat}" class="btn btn--ghost btn--sm">${icon('eye', { size: 14 })} Vedi dettaglio</button>
      </div>
    `;
  }

  function renderTrend(trend, threshold) {
    if (!trend || trend.length === 0) return '';
    const W = 600, H = 220;
    const PAD = { top: 16, right: 16, bottom: 30, left: 50 };
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    // Y-axis max: max of all pct values + 5
    const values = [];
    for (const t of trend) {
      for (const k of ['food_pct', 'beverage_pct', 'consumo_pct', 'operating_pct']) {
        if (t[k] != null) values.push(Number(t[k]));
      }
    }
    const max = Math.max(...values, Number(threshold), 35) + 5;
    const yScale = (v) => PAD.top + innerH - (v / max) * innerH;
    const xScale = (i) => PAD.left + (trend.length === 1 ? innerW / 2 : (i / (trend.length - 1)) * innerW);

    const line = (key, color) => {
      const points = trend.map((t, i) => ({ x: xScale(i), y: t[key] != null ? yScale(Number(t[key])) : null }))
        .filter((p) => p.y !== null);
      if (points.length === 0) return '';
      const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
      return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>` +
             points.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${color}"/>`).join('');
    };

    const thrY = yScale(Number(threshold));

    return `
      <h2 style="margin: var(--space-20) 0 var(--space-8) 0; font-family: var(--font-display); font-size: var(--text-lg);">Andamento ultimi 6 mesi</h2>
      <div class="card" style="padding: var(--space-12);">
        <div style="display: flex; gap: var(--space-12); flex-wrap: wrap; margin-bottom: var(--space-12); font-size: var(--text-xs);">
          <span><span style="display: inline-block; width: 10px; height: 10px; background: var(--terracotta-dark); border-radius: 2px;"></span> Food</span>
          <span><span style="display: inline-block; width: 10px; height: 10px; background: var(--bottle-green, #4f8e3a); border-radius: 2px;"></span> Beverage</span>
          <span><span style="display: inline-block; width: 10px; height: 10px; background: var(--ink-muted); border-radius: 2px;"></span> Consumo</span>
          <span><span style="display: inline-block; width: 10px; height: 10px; background: var(--ink); border-radius: 2px;"></span> Operativo</span>
        </div>
        <svg viewBox="0 0 ${W} ${H}" style="width: 100%; height: auto; display: block;" preserveAspectRatio="none">
          <!-- threshold dashed line -->
          <line x1="${PAD.left}" x2="${W - PAD.right}" y1="${thrY}" y2="${thrY}" stroke="var(--warning, #c9942a)" stroke-width="1.5" stroke-dasharray="4 4"/>
          <text x="${W - PAD.right - 4}" y="${thrY - 4}" text-anchor="end" font-size="10" fill="var(--warning, #c9942a)">soglia ${pct(threshold)}</text>
          <!-- Y ticks -->
          ${[0, max / 2, max].map((v) => `
            <line x1="${PAD.left}" x2="${W - PAD.right}" y1="${yScale(v)}" y2="${yScale(v)}" stroke="var(--border-soft)" stroke-width="1" stroke-dasharray="2 3"/>
            <text x="${PAD.left - 6}" y="${yScale(v) + 4}" text-anchor="end" font-size="10" fill="var(--ink-muted)">${pct(v)}</text>
          `).join('')}
          <!-- X labels (mese abbr) -->
          ${trend.map((t, i) => `<text x="${xScale(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--ink-muted)">${escapeHtml(t.month_label.split(' ')[0].slice(0, 3))}</text>`).join('')}
          <!-- Lines -->
          ${line('food_pct',      'var(--terracotta-dark)')}
          ${line('beverage_pct',  'var(--bottle-green, #4f8e3a)')}
          ${line('consumo_pct',   'var(--ink-muted)')}
          ${line('operating_pct', 'var(--ink)')}
        </svg>
      </div>
    `;
  }

  function wire() {
    container.querySelectorAll('[data-nav]').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.dataset.nav === 'prev') {
          state.month -= 1;
          if (state.month < 1) { state.month = 12; state.year -= 1; }
        } else {
          state.month += 1;
          if (state.month > 12) { state.month = 1; state.year += 1; }
        }
        load();
      });
    });
    container.querySelectorAll('[data-cat-detail]').forEach((b) => {
      b.addEventListener('click', () => navigate(`/food-cost/dettaglio?category=${b.dataset.catDetail}&year=${state.year}&month=${state.month}`));
    });
  }
}

function pct(v) {
  if (v == null) return 'N/D';
  return `${Number(v).toFixed(1).replace('.', ',')}%`;
}
function fmt(v) { const n = Number(v); return Number.isNaN(n) ? '0,00' : n.toFixed(2).replace('.', ','); }
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
