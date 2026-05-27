// / (Home) — landing page once authenticated.
// Light dashboard with shortcuts. For admin/manager the Riordini card
// shows a live alert-badge counting open StockAlerts.

import { getCurrentUser, logout, userHasRole } from '../js/auth.js';
import { setHeader } from '../js/app-shell.js';
import { navigate } from '../js/router.js';
import { icon } from '../js/icons.js';
import { confirmDialog } from '../js/components.js';
import { apiGet } from '../js/api.js';
import { alertBadge } from '../components/alert-badge.js';
import { isOnboardingSkipped } from './onboarding/welcome.js';

export function mountHome(container) {
  const user = getCurrentUser();
  const isAdminOrManager = userHasRole('admin', 'manager');

  // First-run onboarding: admin sees the wizard when the DB looks empty.
  // Heuristic: 0 products AND 0 suppliers. Skippable; skip is sticky in
  // localStorage so we don't pester the admin if they postpone.
  if (userHasRole('admin') && !isOnboardingSkipped()) {
    Promise.all([
      apiGet('/products?limit=1').catch(() => []),
      apiGet('/suppliers?limit=1').catch(() => []),
    ]).then(([p, s]) => {
      const empty = Array.isArray(p) && p.length === 0
                 && Array.isArray(s) && s.length === 0;
      if (empty) navigate('/benvenuto');
    });
  }

  setHeader({
    title: 'Amodei',
    brand: true,
    actions: [
      {
        label: 'Esci',
        iconName: 'logout',
        onClick: async () => {
          const ok = await confirmDialog(
            'Vuoi uscire?',
            'Tornerai alla schermata di accesso.',
            { confirmLabel: 'Esci', cancelLabel: 'Annulla', danger: true },
          );
          if (ok) logout();
        },
      },
    ],
  });

  const greeting = user ? `Ciao ${escapeHtml(user.full_name || user.email)}` : 'Ciao';
  const roleBadge = user ? `<span class="badge badge--success" style="margin-left: var(--space-8); vertical-align: middle;">${user.role}</span>` : '';

  container.innerHTML = `
    <section class="container container--narrow" style="padding-block: var(--space-32); padding-bottom: 100px;">
      <div class="card card--elevated stack-16">
        <h2 class="font-display text-2xl" style="margin:0">${greeting} ${roleBadge}</h2>
        <p class="muted">Cosa vuoi fare oggi?</p>

        ${userHasRole('admin') ? '<div id="home-revenue-kpi" style="margin-top: var(--space-8);"></div>' : ''}

        <div class="stack-12" style="margin-top: var(--space-8);">
          <button type="button" data-go="/guida" class="btn btn--ghost full-width" style="border: 1px dashed var(--border-strong); justify-content: flex-start; padding: var(--space-12);">
            ${icon('info', { size: 18 })}<span style="margin-left: var(--space-8);">Guida rapida per il tuo ruolo</span>
          </button>
          <button type="button" data-go="/segnala" class="btn btn--secondary btn--lg full-width">
            ${icon('alert', { size: 20 })}<span>Segnala scorte</span>
          </button>
          <button type="button" data-go="/magazzino" class="btn btn--primary btn--lg full-width">
            ${icon('inventory', { size: 20 })}<span>Apri Magazzino</span>
          </button>
          <button type="button" data-go="/magazzino/carico" class="btn btn--secondary btn--lg full-width">
            ${icon('plus', { size: 20 })}<span>Carica un lotto</span>
          </button>
          <button type="button" data-go="/chiusura-serale" class="btn btn--secondary btn--lg full-width">
            ${icon('clock', { size: 20 })}<span>Chiusura serale</span>
          </button>
          <button type="button" data-go="/pasti-staff" class="btn btn--ghost btn--lg full-width">
            ${icon('cash', { size: 20 })}<span>Pasti staff</span>
          </button>
          ${isAdminOrManager ? `
            <button type="button" data-go="/riordini" class="btn btn--ghost btn--lg full-width" style="justify-content: space-between;">
              <span style="display: inline-flex; align-items: center; gap: var(--space-8);">${icon('whatsapp', { size: 20 })}<span>Riordini</span></span>
              <span id="home-alert-badge"></span>
            </button>
            <button type="button" data-go="/fornitori" class="btn btn--ghost btn--lg full-width">
              ${icon('phone', { size: 20 })}<span>Fornitori</span>
            </button>
            <button type="button" data-go="/fatture" class="btn btn--ghost btn--lg full-width">
              ${icon('cash', { size: 20 })}<span>Fatture</span>
            </button>
            <button type="button" data-go="/food-cost" class="btn btn--ghost btn--lg full-width" style="justify-content: space-between;">
              <span style="display: inline-flex; align-items: center; gap: var(--space-8);">${icon('bar-chart', { size: 20 })}<span>Food Cost</span></span>
              <span id="home-foodcost-pct" class="muted text-sm"></span>
            </button>
            <button type="button" data-go="/turni" class="btn btn--ghost btn--lg full-width" style="justify-content: space-between;">
              <span style="display: inline-flex; align-items: center; gap: var(--space-8);">${icon('clock', { size: 20 })}<span>Turni</span></span>
              <span id="home-turni-today" class="muted text-sm"></span>
            </button>
            ${userHasRole('admin') ? `
              <button type="button" data-go="/stipendi" class="btn btn--ghost btn--lg full-width" style="justify-content: space-between;">
                <span style="display: inline-flex; align-items: center; gap: var(--space-8);">${icon('cash', { size: 20 })}<span>Stipendi</span></span>
                <span id="home-stipendi-net" class="muted text-sm"></span>
              </button>
            ` : ''}
          ` : ''}
          ${user && user.role === 'staff' ? `
            <button type="button" data-go="/miei-turni" class="btn btn--ghost btn--lg full-width">
              ${icon('clock', { size: 20 })}<span>I miei turni</span>
            </button>
          ` : ''}
        </div>
      </div>

      <p class="muted text-xs center-text" style="margin-top: var(--space-24);">
        <a href="./src/style-guide.html" target="_blank" rel="noopener">Style guide</a> · v0.5.0
      </p>
    </section>
  `;

  container.querySelectorAll('[data-go]').forEach((b) => {
    b.addEventListener('click', () => navigate(b.dataset.go));
  });

  // Async fetch alert count (admin/manager only)
  if (isAdminOrManager) {
    apiGet('/alerts?status=open&limit=500').then((alerts) => {
      const slot = container.querySelector('#home-alert-badge');
      if (!slot) return;
      const urgent = alerts.filter((a) => a.status_signaled === 'out').length;
      slot.innerHTML = alertBadge(alerts.length, { urgent });
    }).catch(() => {});
    // Async fetch food cost % for the home button (silent on error).
    apiGet('/foodcost/monthly').then((d) => {
      const slot = container.querySelector('#home-foodcost-pct');
      if (!slot) return;
      const op = d.operating_total;
      const dotByStatus = { ok: '🟢', warn: '🟠', alert: '🔴' };
      const dot = dotByStatus[op.status] || '';
      const pctStr = op.pct_fiscal == null ? 'N/D' : `${Number(op.pct_fiscal).toFixed(1).replace('.', ',')}%`;
      slot.textContent = `${pctStr} ${dot}`.trim();
    }).catch(() => {});
    // Total hours del giorno (turni di oggi)
    const today = new Date().toISOString().slice(0, 10);
    apiGet(`/work-shifts/by-date/${today}`).then((d) => {
      const slot = container.querySelector('#home-turni-today');
      if (!slot) return;
      const total = Number(d.total_hours);
      slot.textContent = total > 0 ? `${total % 1 === 0 ? total : total.toFixed(1)}h oggi` : 'Inserisci';
    }).catch(() => {});
    // Stipendio mese (admin only)
    if (userHasRole('admin')) {
      const now = new Date();
      apiGet(`/work-shifts/monthly-payroll?year=${now.getFullYear()}&month=${now.getMonth() + 1}`).then((d) => {
        const slot = container.querySelector('#home-stipendi-net');
        if (!slot) return;
        slot.textContent = `€ ${Number(d.totals.total_net).toFixed(2).replace('.', ',')} da consegnare`;
      }).catch(() => {});

      // Revenue KPI card
      loadRevenueKpi(container);
    }
  }
}

async function loadRevenueKpi(container) {
  const slot = container.querySelector('#home-revenue-kpi');
  if (!slot) return;

  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 40);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = today.toISOString().slice(0, 10);

  let summaries;
  try {
    summaries = await apiGet(`/daily-summary?from=${fromStr}&to=${toStr}&limit=60`);
  } catch {
    slot.innerHTML = '';
    return;
  }

  const byDate = new Map();
  for (const s of summaries) {
    const val = s.computed_total ?? s.fiscal_total ?? (Number(s.pos_total) > 0 ? s.pos_total : null);
    if (val != null) byDate.set(s.date, Number(val));
  }

  if (byDate.size === 0) {
    slot.innerHTML = `<div class="card" style="padding: var(--space-16); margin-bottom: var(--space-12); background: var(--ink); color: var(--off-white); border-radius: var(--radius-xl);">
      <p class="text-xs" style="margin:0; text-transform: uppercase; letter-spacing: var(--letter-spacing-wide); opacity: 0.7; color: inherit;">Incassi</p>
      <p class="muted text-sm" style="margin: var(--space-8) 0 0 0; color: rgba(255,255,255,0.6);">Nessun dato disponibile. Chiudi almeno una sessione POS o inserisci i totali in cassa per vedere le statistiche.</p>
    </div>`;
    return;
  }

  // --- Ultimo incasso ---
  const sortedDates = [...byDate.keys()].sort().reverse();
  const lastDate = sortedDates[0];
  const lastAmount = byDate.get(lastDate);

  // --- Stesso giorno settimana scorsa ---
  const lastDateObj = new Date(lastDate);
  const sameWeekdayObj = new Date(lastDateObj);
  sameWeekdayObj.setDate(sameWeekdayObj.getDate() - 7);
  const sameWeekdayStr = sameWeekdayObj.toISOString().slice(0, 10);
  const sameWeekdayAmount = byDate.get(sameWeekdayStr);

  // --- Media settimanale corrente vs scorsa ---
  const mondayOf = (d) => { const m = new Date(d); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; };
  const thisMonday = mondayOf(today);
  const lastMonday = new Date(thisMonday); lastMonday.setDate(lastMonday.getDate() - 7);
  const lastSunday = new Date(thisMonday); lastSunday.setDate(lastSunday.getDate() - 1);

  const weekValues = (start, end) => {
    const vals = [];
    const d = new Date(start);
    while (d <= end) {
      const k = d.toISOString().slice(0, 10);
      if (byDate.has(k)) vals.push(byDate.get(k));
      d.setDate(d.getDate() + 1);
    }
    return vals;
  };

  const thisWeekVals = weekValues(thisMonday, today);
  const lastWeekVals = weekValues(lastMonday, lastSunday);
  const thisWeekAvg = thisWeekVals.length > 0 ? thisWeekVals.reduce((a, b) => a + b, 0) / thisWeekVals.length : null;
  const lastWeekAvg = lastWeekVals.length > 0 ? lastWeekVals.reduce((a, b) => a + b, 0) / lastWeekVals.length : null;

  // --- Proiezione mensile vs mese scorso ---
  const thisYear = today.getFullYear();
  const thisMonth = today.getMonth();
  const daysInThisMonth = new Date(thisYear, thisMonth + 1, 0).getDate();

  const monthValues = (year, month) => {
    const vals = [];
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    for (const [k, v] of byDate) {
      if (k.startsWith(prefix)) vals.push(v);
    }
    return vals;
  };

  const thisMonthVals = monthValues(thisYear, thisMonth);
  const thisMonthTotal = thisMonthVals.reduce((a, b) => a + b, 0);
  const thisMonthDays = thisMonthVals.length;
  const projectedMonth = thisMonthDays > 0 ? (thisMonthTotal / thisMonthDays) * daysInThisMonth : null;

  const lastMonthDate = new Date(thisYear, thisMonth - 1, 1);
  const lastMonthVals = monthValues(lastMonthDate.getFullYear(), lastMonthDate.getMonth());
  const lastMonthTotal = lastMonthVals.reduce((a, b) => a + b, 0);

  // --- Render ---
  const fmt = (v) => v == null ? '—' : `€ ${v.toFixed(2).replace('.', ',')}`;
  const diffHtml = (current, previous, label) => {
    if (current == null || previous == null || previous === 0) return `<p class="muted text-xs" style="margin: var(--space-4) 0 0 0;">${label}: dati insufficienti</p>`;
    const diff = current - previous;
    const pct = (diff / previous) * 100;
    const sign = diff >= 0 ? '+' : '';
    const color = diff >= 0 ? 'var(--bottle-green, #4f8e3a)' : 'var(--terracotta-dark)';
    const arrow = diff >= 0 ? '▲' : '▼';
    return `<p style="margin: var(--space-4) 0 0 0; font-size: var(--text-xs); color: ${color};">
      ${arrow} ${sign}${fmt(diff)} (${sign}${pct.toFixed(1).replace('.', ',')}%) <span class="muted" style="color: var(--ink-muted);">vs ${label}</span>
    </p>`;
  };

  const lastDateLabel = new Date(lastDate).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });

  slot.innerHTML = `
    <div class="card" style="padding: var(--space-16); margin-bottom: var(--space-12); background: var(--ink); color: var(--off-white); border-radius: var(--radius-xl);">
      <p class="text-xs" style="margin:0; text-transform: uppercase; letter-spacing: var(--letter-spacing-wide); opacity: 0.7; color: inherit;">Ultimo incasso · ${escapeHtml(lastDateLabel)}</p>
      <p class="font-display" style="margin: var(--space-4) 0 0 0; font-size: 2.5rem; line-height: 1; color: inherit;">${fmt(lastAmount)}</p>
      ${diffHtml(lastAmount, sameWeekdayAmount, 'stesso giorno sett. scorsa')}

      <div style="margin-top: var(--space-16); padding-top: var(--space-12); border-top: 1px solid rgba(255,255,255,0.15);">
        <div style="display: flex; justify-content: space-between; align-items: baseline; color: inherit;">
          <span class="text-sm" style="color: inherit; opacity: 0.85;">Media giornaliera sett.</span>
          <span class="font-display text-lg" style="color: inherit;">${fmt(thisWeekAvg)}</span>
        </div>
        ${diffHtml(thisWeekAvg, lastWeekAvg, 'sett. precedente')}
      </div>

      <div style="margin-top: var(--space-12); padding-top: var(--space-12); border-top: 1px solid rgba(255,255,255,0.15);">
        <div style="display: flex; justify-content: space-between; align-items: baseline; color: inherit;">
          <span class="text-sm" style="color: inherit; opacity: 0.85;">Proiezione mese</span>
          <span class="font-display text-lg" style="color: inherit;">${fmt(projectedMonth)}</span>
        </div>
        ${diffHtml(projectedMonth, lastMonthTotal > 0 ? lastMonthTotal : null, 'mese scorso (€ ' + fmt(lastMonthTotal).replace('€ ', '') + ')')}
      </div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
