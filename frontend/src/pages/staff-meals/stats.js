// /pasti-staff/statistiche — monthly stats (manager/admin).

import { apiGet } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { icon } from '../../js/icons.js';
import { showToast, skeletonList } from '../../js/components.js';
import { initials } from './list.js';

const MONTH_NAMES = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
];

export async function mountStaffMealsStats(container) {
  setHeader({
    title: 'Statistiche pasti',
    brand: true,
    backHref: '/pasti-staff',
  });

  const today = new Date();
  const state = { year: today.getFullYear(), month: today.getMonth() + 1, data: null };

  await load();

  return () => {};

  async function load() {
    container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(3)}</div>`;
    try {
      state.data = await apiGet(`/staff-meals/stats/monthly?year=${state.year}&month=${state.month}`);
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
      <section class="container" style="padding-block: var(--space-20); padding-bottom: 96px;">
        <!-- Month nav -->
        <div class="card row" style="justify-content: space-between; gap: var(--space-12); margin-bottom: var(--space-16);">
          <button type="button" id="prev" class="btn btn--ghost btn--icon" aria-label="Mese precedente">${icon('chevron-left', { size: 20 })}</button>
          <p class="font-display text-xl" style="margin:0; text-transform: capitalize;">${MONTH_NAMES[d.month - 1]} ${d.year}</p>
          <button type="button" id="next" class="btn btn--ghost btn--icon" aria-label="Mese successivo">${icon('chevron-right', { size: 20 })}</button>
        </div>

        <!-- KPIs -->
        <div class="grid-3" style="gap: var(--space-12); margin-bottom: var(--space-24);">
          ${kpi('Pasti totali', d.total_meals)}
          ${kpi('Costo totale', `€ ${Number(d.total_cost).toFixed(2)}`)}
          ${kpi('Costo medio', `€ ${Number(d.avg_cost_per_meal).toFixed(2)}`)}
        </div>

        <!-- Daily bar chart -->
        <h3 class="font-display text-xl" style="margin: 0 0 var(--space-12) 0;">Andamento giornaliero</h3>
        <div class="card">${dailyChart(d.by_day)}</div>

        <!-- By user -->
        <h3 class="font-display text-xl" style="margin: var(--space-24) 0 var(--space-12) 0;">Per persona</h3>
        <div class="stack-8">${byUser(d.by_user)}</div>

        <!-- By product -->
        <h3 class="font-display text-xl" style="margin: var(--space-24) 0 var(--space-12) 0;">Prodotti più consumati</h3>
        <div class="stack-8">${byProduct(d.by_product)}</div>

        <!-- CSV export -->
        <div class="row" style="justify-content: flex-end; margin-top: var(--space-24);">
          <button type="button" id="csv" class="btn btn--secondary">${icon('download', { size: 18 })}<span>Esporta CSV</span></button>
        </div>
      </section>
    `;
    container.querySelector('#prev').addEventListener('click', () => navMonth(-1));
    container.querySelector('#next').addEventListener('click', () => navMonth(1));
    container.querySelector('#csv').addEventListener('click', exportCsv);
  }

  function navMonth(delta) {
    let y = state.year, m = state.month + delta;
    if (m === 0) { m = 12; y -= 1; }
    if (m === 13) { m = 1; y += 1; }
    state.year = y; state.month = m;
    load();
  }

  function kpi(label, value) {
    return `<div class="card">
      <p class="muted text-xs uppercase" style="margin:0; letter-spacing: var(--letter-spacing-wide);">${escapeHtml(label)}</p>
      <p class="font-display text-2xl" style="margin: var(--space-4) 0 0 0;">${value}</p>
    </div>`;
  }

  function byUser(rows) {
    if (rows.length === 0) return `<p class="muted">Nessun dato.</p>`;
    return rows.map((r) => `
      <div class="card row" style="gap: var(--space-12);">
        <span style="width:36px; height:36px; border-radius:50%; background: var(--terracotta); color: var(--off-white); display: inline-flex; align-items: center; justify-content: center; font-weight: 600;">${escapeHtml(initials(r.user.full_name))}</span>
        <div class="flex-1">
          <p style="margin:0;"><strong>${escapeHtml(r.user.full_name)}</strong></p>
          <p class="muted text-xs" style="margin:0;">${r.meal_count} ${r.meal_count === 1 ? 'pasto' : 'pasti'}</p>
        </div>
        <span class="badge">€ ${Number(r.cost_total).toFixed(2)}</span>
      </div>
    `).join('');
  }

  function byProduct(rows) {
    if (rows.length === 0) return `<p class="muted">Nessun dato.</p>`;
    return rows.slice(0, 10).map((r, i) => `
      <div class="card row" style="gap: var(--space-12);">
        <span class="muted text-xs" style="min-width: 24px;">#${i + 1}</span>
        <div class="flex-1">
          <p style="margin:0;"><strong>${escapeHtml(r.product_name)}</strong></p>
          <p class="muted text-xs" style="margin:0;">${formatQty(r.qty_total)} ${escapeHtml(r.product_unit)}</p>
        </div>
        <span class="badge">€ ${Number(r.cost_total).toFixed(2)}</span>
      </div>
    `).join('');
  }

  function dailyChart(rows) {
    if (rows.length === 0) return `<p class="muted text-sm">Nessun pasto registrato in ${MONTH_NAMES[state.month - 1]}.</p>`;
    const maxCost = Math.max(...rows.map((r) => Number(r.cost_total)), 0.01);
    const W = Math.max(rows.length * 28, 280);
    const H = 80;
    const barW = 20;
    const padding = 4;
    return `<svg viewBox="0 0 ${W} ${H + 24}" style="width:100%; max-width: 100%; height: auto; display: block;">
      ${rows.map((r, i) => {
        const h = (Number(r.cost_total) / maxCost) * H;
        const x = padding + i * (barW + 8);
        const y = H - h;
        const day = new Date(r.date).getDate();
        return `
          <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" fill="var(--terracotta)" />
          <text x="${x + barW / 2}" y="${H + 14}" text-anchor="middle" font-size="9" font-family="var(--font-mono)" fill="var(--ink-muted)">${day}</text>
          <title>${r.date}: ${r.meal_count} pasti, € ${Number(r.cost_total).toFixed(2)}</title>
        `;
      }).join('')}
    </svg>`;
  }

  function exportCsv() {
    const d = state.data;
    const lines = [];
    lines.push(['Sezione', 'Riga', 'Etichetta', 'Quantità', 'Costo €']);
    lines.push(['KPI', '', 'Pasti totali', d.total_meals, '']);
    lines.push(['KPI', '', 'Costo totale', '', Number(d.total_cost).toFixed(2)]);
    lines.push(['KPI', '', 'Costo medio', '', Number(d.avg_cost_per_meal).toFixed(2)]);
    d.by_user.forEach((r, i) => lines.push(['Per persona', i + 1, r.user.full_name, r.meal_count, Number(r.cost_total).toFixed(2)]));
    d.by_product.forEach((r, i) => lines.push(['Per prodotto', i + 1, `${r.product_name} (${r.product_unit})`, formatQty(r.qty_total), Number(r.cost_total).toFixed(2)]));
    d.by_day.forEach((r) => lines.push(['Per giorno', r.date, '', r.meal_count, Number(r.cost_total).toFixed(2)]));
    const csv = lines.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pasti-staff-${d.year}-${String(d.month).padStart(2, '0')}.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(a.href); }, 0);
  }
}

function formatQty(qty) {
  const n = Number(qty);
  if (Number.isNaN(n)) return '—';
  return Number.isInteger(n) ? n.toString() : n.toFixed(2);
}
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
