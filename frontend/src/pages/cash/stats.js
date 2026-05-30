// /cassa/statistiche — monthly stats: line chart of revenues + MoM + expenses by category.
//
// All charts are inline SVG (no Chart.js). The page loads in parallel:
//   - GET /daily-summary?from=&to= for the current month (for the line chart)
//   - GET /daily-summary?from=&to= for the previous month (for MoM total)
//   - GET /expenses?from=&to= for the current month (grouped by category)

import { apiGet } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { icon } from '../../js/icons.js';
import { skeletonList } from '../../js/components.js';

export async function mountCashStats(container, _params, _query) {
  const state = {
    currentMonth: null,
    prevMonth: null,
    expenses: [],
    loading: true,
  };

  setHeader({
    title: 'Statistiche cassa',
    brand: true,
    backHref: '/cassa',
    actions: [
      { label: 'Storico', iconName: 'calendar', onClick: () => navigate('/cassa/storico') },
      { label: 'Riepilogo', iconName: 'inventory', onClick: () => navigate('/cassa/riepilogo') },
    ],
  });

  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(3)}</div>`;

  const now = new Date();
  const cur = monthRange(now.getFullYear(), now.getMonth());
  const prev = monthRange(now.getFullYear(), now.getMonth() - 1);

  try {
    const [curList, prevList, expList] = await Promise.all([
      apiGet(`/daily-summary?from=${cur.from}&to=${cur.to}`),
      apiGet(`/daily-summary?from=${prev.from}&to=${prev.to}`),
      apiGet(`/expenses?from=${cur.from}&to=${cur.to}`),
    ]);
    state.currentMonth = curList;
    state.prevMonth = prevList;
    state.expenses = expList;
    state.loading = false;
    render();
  } catch (err) {
    container.innerHTML = errorBlock(err.message || 'Errore di rete');
  }

  return () => {};

  // -----------------------------------------------------------------

  function render() {
    const monthLabel = new Date(now.getFullYear(), now.getMonth(), 1)
      .toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

    const totalCurrent = sumComputed(state.currentMonth);
    const totalPrev    = sumComputed(state.prevMonth);
    const mom = momCompare(totalCurrent, totalPrev);

    const byCategory = aggregateExpensesByCategory(state.expenses);
    const expensesTotal = byCategory.reduce((s, x) => s + x.total, 0);

    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
        <p class="muted text-sm" style="margin: 0 0 var(--space-12) 0; text-transform: capitalize;">${escapeHtml(monthLabel)}</p>

        ${renderMomCard(totalCurrent, totalPrev, mom)}

        <h2 style="margin: var(--space-20) 0 var(--space-8) 0; font-family: var(--font-display); font-size: var(--text-lg);">Incassi giornalieri</h2>
        ${renderLineChart(state.currentMonth, cur)}

        <h2 style="margin: var(--space-24) 0 var(--space-8) 0; font-family: var(--font-display); font-size: var(--text-lg);">Spese per categoria</h2>
        ${renderCategoryList(byCategory, expensesTotal)}
      </section>
    `;
  }

  function renderMomCard(curTotal, prevTotal, mom) {
    const arrow = mom.pct == null ? '' : (mom.pct >= 0 ? '↑' : '↓');
    const color = mom.pct == null ? 'var(--ink-muted)'
                 : mom.pct >= 0 ? 'var(--success, #4f8e3a)' : 'var(--terracotta-dark)';
    const pctText = mom.pct == null ? '— vs. mese precedente'
                    : `${arrow} ${Math.abs(mom.pct).toFixed(1).replace('.', ',')}% vs. mese precedente (€ ${formatMoney(prevTotal)})`;
    return `
      <div class="card" style="padding: var(--space-16);">
        <p class="muted text-xs" style="margin:0; text-transform: uppercase; letter-spacing: var(--letter-spacing-wide);">Totale mese</p>
        <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 2.4rem; font-weight: 600; color: var(--ink);">€ ${formatMoney(curTotal)}</p>
        <p style="margin: var(--space-8) 0 0 0; font-size: var(--text-sm); color: ${color};">${pctText}</p>
      </div>
    `;
  }

  function renderLineChart(summaries, range) {
    const byDay = new Map();
    for (const s of summaries) if (s.computed_total != null) byDay.set(s.date, Number(s.computed_total));
    const points = [];
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${range.from.slice(0, 8)}${String(d).padStart(2, '0')}`;
      if (byDay.has(iso)) points.push({ day: d, value: byDay.get(iso) });
    }

    if (points.length === 0) {
      return `<p class="muted" style="margin: 0; padding: var(--space-16); text-align: center; background: var(--cream-soft); border-radius: var(--radius-md);">Nessuna giornata con incassi questo mese.</p>`;
    }

    const W = 600, H = 220;
    const PAD = { top: 20, right: 16, bottom: 30, left: 50 };
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const maxValue = Math.max(...points.map((p) => p.value));
    const yScale = (v) => PAD.top + innerH - (v / maxValue) * innerH;
    const xScale = (day) => PAD.left + ((day - 1) / Math.max(1, daysInMonth - 1)) * innerW;

    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.day).toFixed(1)} ${yScale(p.value).toFixed(1)}`).join(' ');
    const areaD = `${pathD} L ${xScale(points[points.length - 1].day).toFixed(1)} ${PAD.top + innerH} L ${xScale(points[0].day).toFixed(1)} ${PAD.top + innerH} Z`;

    // Y-axis ticks at 0, 50%, 100% of max
    const ticks = [0, maxValue / 2, maxValue].map((v) => ({ v, y: yScale(v) }));
    // X-axis: tick every 5 days
    const xTicks = [];
    for (let d = 1; d <= daysInMonth; d += 5) xTicks.push(d);
    if (xTicks[xTicks.length - 1] !== daysInMonth) xTicks.push(daysInMonth);

    return `
      <div class="card" style="padding: var(--space-12);">
        <svg viewBox="0 0 ${W} ${H}" style="width: 100%; height: auto; display: block;" preserveAspectRatio="none">
          <!-- grid + Y labels -->
          ${ticks.map((t) => `
            <line x1="${PAD.left}" x2="${W - PAD.right}" y1="${t.y}" y2="${t.y}" stroke="var(--border-soft)" stroke-width="1" stroke-dasharray="2 3" />
            <text x="${PAD.left - 6}" y="${t.y + 4}" text-anchor="end" font-size="10" fill="var(--ink-muted)" font-family="var(--font-body)">€ ${shortMoney(t.v)}</text>
          `).join('')}
          <!-- X labels -->
          ${xTicks.map((d) => `<text x="${xScale(d)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--ink-muted)" font-family="var(--font-body)">${d}</text>`).join('')}
          <!-- area + line + dots -->
          <path d="${areaD}" fill="var(--terracotta)" fill-opacity="0.12" />
          <path d="${pathD}" fill="none" stroke="var(--terracotta)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          ${points.map((p) => `<circle cx="${xScale(p.day).toFixed(1)}" cy="${yScale(p.value).toFixed(1)}" r="3" fill="var(--terracotta-dark)" />`).join('')}
        </svg>
      </div>
    `;
  }

  function renderCategoryList(byCategory, total) {
    if (byCategory.length === 0) {
      return `<p class="muted" style="margin: 0; padding: var(--space-16); text-align: center; background: var(--cream-soft); border-radius: var(--radius-md);">Nessuna spesa questo mese.</p>`;
    }
    const max = byCategory[0].total;
    return `
      <div class="card" style="padding: var(--space-12);">
        ${byCategory.map((c) => {
          const pct = max > 0 ? (c.total / max) * 100 : 0;
          const shareOfTotal = total > 0 ? (c.total / total) * 100 : 0;
          return `
            <div style="padding: var(--space-8) 0; border-top: 1px solid var(--border-soft);">
              <div style="display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-8);">
                <span style="font-weight: 500;">${escapeHtml(c.name)}</span>
                <span style="font-family: var(--font-display); color: var(--ink);">€ ${formatMoney(c.total)} <span class="muted text-xs">(${shareOfTotal.toFixed(0)}%)</span></span>
              </div>
              <div style="margin-top: var(--space-4); height: 6px; background: var(--cream-soft); border-radius: 3px; overflow: hidden;">
                <div style="height: 100%; width: ${pct.toFixed(1)}%; background: ${c.color || 'var(--terracotta)'};"></div>
              </div>
            </div>
          `;
        }).join('')}
        <div style="padding: var(--space-12) 0 0 0; margin-top: var(--space-8); border-top: 2px solid var(--ink); display: flex; justify-content: space-between;">
          <span style="font-weight: 600;">Totale</span>
          <span style="font-family: var(--font-display); font-weight: 600;">€ ${formatMoney(total)}</span>
        </div>
      </div>
    `;
  }
}

// ---------- helpers ----------

function monthRange(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: fmt(first), to: fmt(last) };
}

function sumComputed(summaries) {
  return summaries.reduce((s, x) => s + (x.computed_total != null ? Number(x.computed_total) : 0), 0);
}

function momCompare(curTotal, prevTotal) {
  if (prevTotal === 0) return { pct: null };
  return { pct: ((curTotal - prevTotal) / prevTotal) * 100 };
}

function aggregateExpensesByCategory(expenses) {
  const map = new Map();
  for (const e of expenses) {
    const name = e.category?.name || `#${e.category_id}`;
    const color = e.category?.color;
    const cur = map.get(name) || { name, color, total: 0 };
    cur.total += Number(e.amount);
    map.set(name, cur);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
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
