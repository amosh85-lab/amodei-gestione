// /statistiche — report mensile completo (solo admin).
//
// KPI: incasso totale / POS / contanti / spese totali del mese.
// Suddivisione in 5 periodi (1-7, 8-14, 15-21, 22-28, 29-fine mese), con
// la % di differenza rispetto agli STESSI giorni del mese precedente
// (non il mese precedente intero).
// Spese del mese dettagliate per categoria (bonus, extra, materiali, ecc.
// — le categorie sono quelle configurate in Impostazioni → Spese).
// In fondo: riepilogo mensile dell'anno in corso + totale da inizio anno.

import { apiGet } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { icon } from '../../js/icons.js';
import { skeletonList } from '../../js/components.js';

export async function mountStatisticsDashboard(container, _params, query) {
  setHeader({ title: 'Statistiche', brand: true, backHref: '/' });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(4)}</div>`;

  const now = new Date();
  const state = {
    year: parseInt(query.year, 10) || now.getFullYear(),
    month: parseInt(query.month, 10) || (now.getMonth() + 1),
    curSummaries: [], prevSummaries: [], expenses: [], yearSummaries: [],
    error: null,
  };

  await load();
  return () => {};

  async function load() {
    state.error = null;
    try {
      const curRange = monthRange(state.year, state.month);
      const prevYm = prevMonth(state.year, state.month);
      const prevRange = monthRange(prevYm.year, prevYm.month);
      const yearRange = { from: `${state.year}-01-01`, to: `${state.year}-12-31` };
      const [curSummaries, prevSummaries, expenses, yearSummaries] = await Promise.all([
        apiGet(`/daily-summary?from=${curRange.from}&to=${curRange.to}&limit=31`),
        apiGet(`/daily-summary?from=${prevRange.from}&to=${prevRange.to}&limit=31`),
        apiGet(`/expenses?from=${curRange.from}&to=${curRange.to}&limit=1000`),
        apiGet(`/daily-summary?from=${yearRange.from}&to=${yearRange.to}&limit=365`),
      ]);
      state.curSummaries = curSummaries;
      state.prevSummaries = prevSummaries;
      state.expenses = expenses;
      state.yearSummaries = yearSummaries;
      render();
    } catch (err) {
      state.error = err.message || 'Errore di rete';
      container.innerHTML = errorBlock(state.error, load);
    }
  }

  function render() {
    const kpi = computeKpi(state.curSummaries, state.expenses);
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
        ${renderMonthNav()}
        ${renderKpi(kpi)}
        <h2 style="margin: var(--space-20) 0 var(--space-8) 0; font-family: var(--font-display); font-size: var(--text-lg);">Incasso per periodo</h2>
        ${renderPeriods()}
        <h2 style="margin: var(--space-20) 0 var(--space-8) 0; font-family: var(--font-display); font-size: var(--text-lg);">Spese per categoria</h2>
        ${renderExpensesByCategory()}
        <h2 style="margin: var(--space-20) 0 var(--space-8) 0; font-family: var(--font-display); font-size: var(--text-lg);">Riepilogo anno ${state.year}</h2>
        ${renderYearSummary()}
      </section>
    `;
    wire();
  }

  function renderMonthNav() {
    const label = new Date(state.year, state.month - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
    return `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-12);">
        <button type="button" data-nav="prev" class="btn btn--ghost btn--icon" aria-label="Mese precedente">${icon('chevron-left', { size: 22 })}</button>
        <p style="margin:0; font-family: var(--font-display); font-size: var(--text-lg); text-transform: capitalize; font-weight: 500;">${escapeHtml(label)}</p>
        <button type="button" data-nav="next" class="btn btn--ghost btn--icon" aria-label="Mese successivo">${icon('chevron-right', { size: 22 })}</button>
      </div>
    `;
  }

  function computeKpi(summaries, expenses) {
    let totale = 0, pos = 0, contanti = 0;
    for (const s of summaries) {
      if (s.computed_total != null) totale += Number(s.computed_total);
      pos += Number(s.pos_total || 0);
      if (s.cash_incassato != null) contanti += Number(s.cash_incassato);
    }
    const speseTotali = expenses.reduce((acc, e) => acc + Number(e.amount), 0);
    return { totale, pos, contanti, speseTotali };
  }

  function renderKpi(kpi) {
    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-8);">
        ${kpiCard('Incasso totale', kpi.totale, 'var(--ink)')}
        ${kpiCard('Incasso POS', kpi.pos, '#2980b9')}
        ${kpiCard('Incasso contanti', kpi.contanti, 'var(--bottle-green, #4f8e3a)')}
        ${kpiCard('Spese totali', kpi.speseTotali, 'var(--terracotta-dark)')}
      </div>
    `;
  }

  function kpiCard(label, value, color) {
    return `
      <div class="card" style="padding: var(--space-12);">
        <p class="muted text-xs" style="margin:0; text-transform: uppercase; letter-spacing: var(--letter-spacing-wide);">${escapeHtml(label)}</p>
        <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 1.5rem; font-weight: 600; color: ${color};">€ ${fmt(value)}</p>
      </div>
    `;
  }

  // Periodi: 1-7, 8-14, 15-21, 22-28, 29-fine mese (28/29/30/31 secondo il mese).
  function periodRanges() {
    const daysInMonth = new Date(state.year, state.month, 0).getDate();
    const ranges = [[1, 7], [8, 14], [15, 21], [22, 28]];
    if (daysInMonth > 28) ranges.push([29, daysInMonth]);
    return ranges;
  }

  function sumDayRange(summaries, fromDay, toDay) {
    let acc = 0;
    for (const s of summaries) {
      const d = dayOf(s.date);
      if (d >= fromDay && d <= toDay && s.computed_total != null) acc += Number(s.computed_total);
    }
    return acc;
  }

  function renderPeriods() {
    const ranges = periodRanges();
    return `
      <div class="card" style="padding: 0;">
        ${ranges.map(([from, to], i) => {
          const cur = sumDayRange(state.curSummaries, from, to);
          const prev = sumDayRange(state.prevSummaries, from, to);
          const diff = diffPct(cur, prev);
          const label = from === to ? `${from}` : `${from}–${to}`;
          return `
            <div style="padding: var(--space-12) var(--space-16); ${i > 0 ? 'border-top: 1px solid var(--border-soft);' : ''} display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-8);">
              <span class="muted text-sm">Giorni ${label}</span>
              <span style="font-family: var(--font-display); font-size: 1.1rem;">
                € ${fmt(cur)}
                ${diff == null ? '' : `<span class="text-xs" style="color: ${diff >= 0 ? 'var(--bottle-green, #4f8e3a)' : 'var(--terracotta-dark)'};">(${diff >= 0 ? '+' : ''}${diff.toFixed(1).replace('.', ',')}%)</span>`}
              </span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderExpensesByCategory() {
    const byCategory = aggregateByCategory(state.expenses);
    if (byCategory.length === 0) {
      return `<p class="muted" style="margin: 0; padding: var(--space-16); text-align: center; background: var(--cream-soft); border-radius: var(--radius-md);">Nessuna spesa questo mese.</p>`;
    }
    const total = byCategory.reduce((s, c) => s + c.total, 0);
    return `
      <div class="card" style="padding: var(--space-12);">
        ${byCategory.map((c) => `
          <div style="display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-8); padding: var(--space-8) 0; border-top: 1px solid var(--border-soft);">
            <span style="font-weight: 500;">${escapeHtml(c.name)}</span>
            <span style="font-family: var(--font-display);">€ ${fmt(c.total)} <span class="muted text-xs">(${total > 0 ? ((c.total / total) * 100).toFixed(0) : 0}%)</span></span>
          </div>
        `).join('')}
        <div style="display: flex; justify-content: space-between; padding-top: var(--space-12); margin-top: var(--space-8); border-top: 2px solid var(--ink);">
          <span style="font-weight: 600;">Totale</span>
          <span style="font-family: var(--font-display); font-weight: 600;">€ ${fmt(total)}</span>
        </div>
      </div>
    `;
  }

  function renderYearSummary() {
    const byMonth = new Array(12).fill(0);
    for (const s of state.yearSummaries) {
      if (s.computed_total == null) continue;
      const m = Number(s.date.slice(5, 7)) - 1;
      byMonth[m] += Number(s.computed_total);
    }
    const ytdTotal = byMonth.reduce((a, b) => a + b, 0);
    const monthLabels = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
    return `
      <div class="card" style="padding: 0;">
        ${byMonth.map((v, i) => v === 0 ? '' : `
          <div style="padding: var(--space-8) var(--space-16); ${i > 0 ? 'border-top: 1px solid var(--border-soft);' : ''} display: flex; justify-content: space-between;">
            <span class="muted text-sm">${monthLabels[i]}</span>
            <span style="font-family: var(--font-display);">€ ${fmt(v)}</span>
          </div>
        `).join('')}
        <div style="padding: var(--space-12) var(--space-16); margin-top: var(--space-4); border-top: 2px solid var(--ink); display: flex; justify-content: space-between;">
          <span style="font-weight: 600;">Totale da inizio anno</span>
          <span style="font-family: var(--font-display); font-weight: 600; font-size: 1.1rem;">€ ${fmt(ytdTotal)}</span>
        </div>
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
  }
}

// ---------- helpers ----------

function monthRange(year, month) {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: f(first), to: f(last) };
}

function prevMonth(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function dayOf(iso) {
  return Number(iso.slice(8, 10));
}

function diffPct(cur, prev) {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}

function aggregateByCategory(expenses) {
  const map = new Map();
  for (const e of expenses) {
    const name = e.category?.name || `#${e.category_id}`;
    const cur = map.get(name) || { name, total: 0 };
    cur.total += Number(e.amount);
    map.set(name, cur);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function fmt(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return '0,00';
  return n.toFixed(2).replace('.', ',');
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
