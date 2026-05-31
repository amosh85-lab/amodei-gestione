// /cassa/riepilogo — tabella mensile bordata (giorno · parziale pranzo
// · parziale cena · totale). Sorella di /cassa/storico (calendario) e
// /cassa/statistiche (grafici).

import { apiGet } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { icon } from '../../js/icons.js';
import { skeletonList } from '../../js/components.js';

export async function mountCashTable(container, _params, query) {
  const now = new Date();
  const state = {
    year:  parseInt(query.y, 10) || now.getFullYear(),
    month: (parseInt(query.m, 10) || (now.getMonth() + 1)) - 1,   // 0-indexed
    summaries: [],
    loading: true,
  };

  setHeader({
    title: 'Riepilogo cassa',
    brand: true,
    backHref: '/cassa',
    actions: [
      { label: 'Storico', iconName: 'calendar', onClick: () => navigate('/cassa/storico') },
      { label: 'Statistiche', iconName: 'bar-chart', onClick: () => navigate('/cassa/statistiche') },
    ],
  });

  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(3)}</div>`;

  await loadMonth();
  return () => {};

  // -----------------------------------------------------------------

  async function loadMonth() {
    const { from, to } = monthRange(state.year, state.month);
    try {
      state.summaries = await apiGet(`/daily-summary?from=${from}&to=${to}`);
      state.loading = false;
      render();
    } catch (err) {
      container.innerHTML = errorBlock(err.message || 'Errore di rete');
    }
  }

  function render() {
    let totalMonth = 0;
    let daysWithIncome = 0;
    for (const s of state.summaries) {
      if (s.computed_total != null) {
        totalMonth += Number(s.computed_total);
        daysWithIncome += 1;
      }
    }

    const { daysInMonth } = monthRange(state.year, state.month);
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
        ${renderSummaryStrip(totalMonth, daysWithIncome)}
        ${renderMonthNav(state.year, state.month)}
        ${renderTable(state.summaries, daysInMonth)}
      </section>
    `;
    wire();
  }

  function renderSummaryStrip(total, days) {
    return `
      <div class="card" style="padding: var(--space-12) var(--space-16); margin-bottom: var(--space-12); display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-12);">
        <div>
          <p class="muted text-xs" style="margin:0; text-transform: uppercase; letter-spacing: var(--letter-spacing-wide);">Totale mese</p>
          <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 1.6rem; font-weight: 600; color: var(--ink);">€ ${formatMoney(total)}</p>
        </div>
        <p class="muted text-sm" style="margin:0;">${days} ${days === 1 ? 'giornata' : 'giornate'} con incassi</p>
      </div>
    `;
  }

  function renderMonthNav(year, month) {
    const label = new Date(year, month, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
    return `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-12);">
        <button type="button" data-nav="prev" class="btn btn--ghost btn--icon" aria-label="Mese precedente">${icon('chevron-left', { size: 22 })}</button>
        <p style="margin:0; font-family: var(--font-display); font-size: var(--text-lg); text-transform: capitalize; font-weight: 500;">${escapeHtml(label)}</p>
        <button type="button" data-nav="next" class="btn btn--ghost btn--icon" aria-label="Mese successivo">${icon('chevron-right', { size: 22 })}</button>
      </div>
    `;
  }

  function renderTable(summaries, daysInMonth) {
    const rows = summaries
      .filter((s) => s.partial_lunch != null || s.partial_dinner != null || s.computed_total != null)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));

    const bodyTdDate = 'padding: 8px 6px; border: 1px solid var(--border-strong); text-transform: capitalize; white-space: nowrap;';
    const bodyTdNum  = 'padding: 8px 6px; border: 1px solid var(--border-strong); text-align: right; font-family: var(--font-display); font-variant-numeric: tabular-nums; white-space: nowrap;';
    const bodyTdNumHi = bodyTdNum + ' font-weight: 600; color: var(--terracotta-dark);';
    const body = rows.length === 0
      ? `<tr><td colspan="4" style="padding: var(--space-16); text-align: center; color: var(--ink-muted);">Nessun dato per questo mese.</td></tr>`
      : rows.map((s) => `
          <tr data-row-day="${s.date}" style="cursor: pointer;">
            <td style="${bodyTdDate}">${escapeHtml(humanDay(s.date))}</td>
            <td style="${bodyTdNum}">${s.partial_lunch != null ? `€${formatMoney(s.partial_lunch)}` : '<span style="color: var(--ink-muted);">—</span>'}</td>
            <td style="${bodyTdNum}">${s.partial_dinner != null ? `€${formatMoney(s.partial_dinner)}` : '<span style="color: var(--ink-muted);">—</span>'}</td>
            <td style="${bodyTdNumHi}">${s.computed_total != null ? `€${formatMoney(s.computed_total)}` : '<span style="color: var(--ink-muted);">—</span>'}</td>
          </tr>
        `).join('');

    // Conteggi e somme per colonna: la media usa il numero di giorni in cui
    // quella SPECIFICA colonna ha un valore (non i giorni totali del mese,
    // così un servizio mai compilato non si "diluisce" sui giorni morti).
    let totLunch = 0, totDinner = 0, totMonth = 0;
    let cntLunch = 0, cntDinner = 0, cntMonth = 0;
    for (const s of rows) {
      if (s.partial_lunch  != null) { totLunch  += Number(s.partial_lunch);  cntLunch  += 1; }
      if (s.partial_dinner != null) { totDinner += Number(s.partial_dinner); cntDinner += 1; }
      if (s.computed_total != null) { totMonth  += Number(s.computed_total); cntMonth  += 1; }
    }
    const avgLunch  = cntLunch  > 0 ? totLunch  / cntLunch  : 0;
    const avgDinner = cntDinner > 0 ? totDinner / cntDinner : 0;
    const avgMonth  = cntMonth  > 0 ? totMonth  / cntMonth  : 0;
    const projLunch  = avgLunch  * daysInMonth;
    const projDinner = avgDinner * daysInMonth;
    const projMonth  = avgMonth  * daysInMonth;

    // Stile celle compatto: padding ridotto + nowrap così tutta la tabella sta
    // in 390px portrait senza scroll orizzontale. Tabular-nums per allineamento.
    const tdHead  = 'padding: 8px 6px; border: 1px solid var(--border-strong); font-family: var(--font-display); white-space: nowrap;';
    const tdNum   = 'padding: 8px 6px; border: 1px solid var(--border-strong); text-align: right; font-family: var(--font-display); font-variant-numeric: tabular-nums; white-space: nowrap;';
    const tdNumHi = tdNum + ' color: var(--terracotta-dark);';
    // Stacco visivo forte sopra la riga "Totali mese" (e quindi sopra tutto il tfoot).
    const tdHeadTotals  = tdHead + ' border-top: 3px solid var(--terracotta);';
    const tdNumTotals   = tdNum + ' border-top: 3px solid var(--terracotta);';
    const tdNumHiTotals = tdNumHi + ' border-top: 3px solid var(--terracotta);';

    const foot = rows.length === 0 ? '' : `
      <tfoot>
        <tr style="background: var(--cream-soft); font-weight: 600;">
          <td style="${tdHeadTotals}">Totali mese</td>
          <td style="${tdNumTotals}">€${formatMoney(totLunch)}</td>
          <td style="${tdNumTotals}">€${formatMoney(totDinner)}</td>
          <td style="${tdNumHiTotals}">€${formatMoney(totMonth)}</td>
        </tr>
        <tr style="background: var(--cream-soft);">
          <td style="${tdHead}">Media <span class="muted text-xs">(${cntMonth}gg)</span></td>
          <td style="${tdNum}">€${formatMoney(avgLunch)}</td>
          <td style="${tdNum}">€${formatMoney(avgDinner)}</td>
          <td style="${tdNumHi}">€${formatMoney(avgMonth)}</td>
        </tr>
        <tr style="background: var(--cream-soft);">
          <td style="${tdHead}">Proiezione <span class="muted text-xs">(×${daysInMonth}gg)</span></td>
          <td style="${tdNum}">€${formatMoney(projLunch)}</td>
          <td style="${tdNum}">€${formatMoney(projDinner)}</td>
          <td style="${tdNumHi}">€${formatMoney(projMonth)}</td>
        </tr>
      </tfoot>
    `;

    const thStyle = 'padding: 8px 6px; border: 1px solid var(--border-strong); font-family: var(--font-display); font-weight: 600; white-space: nowrap;';

    return `
      <table style="width: 100%; border-collapse: collapse; background: var(--off-white); font-size: 12px; table-layout: auto;">
        <thead>
          <tr style="background: var(--cream-soft);">
            <th style="${thStyle} text-align: left;">Giorno</th>
            <th style="${thStyle} text-align: right;">Pranzo</th>
            <th style="${thStyle} text-align: right;">Cena</th>
            <th style="${thStyle} text-align: right;">Totale</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
        ${foot}
      </table>
    `;
  }

  function wire() {
    container.querySelectorAll('[data-row-day]').forEach((tr) => {
      tr.addEventListener('click', () => navigate(`/cassa?date=${tr.dataset.rowDay}`));
    });
    container.querySelectorAll('[data-nav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.nav === 'prev') {
          state.month -= 1;
          if (state.month < 0) { state.month = 11; state.year -= 1; }
        } else {
          state.month += 1;
          if (state.month > 11) { state.month = 0; state.year += 1; }
        }
        loadMonth();
      });
    });
  }
}

// ---------- helpers ----------

function monthRange(year, month /* 0-indexed */) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: fmt(first), to: fmt(last), daysInMonth: last.getDate() };
}

function humanDay(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatMoney(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return '0,00';
  return n.toFixed(2).replace('.', ',');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function errorBlock(msg) {
  return `<div class="container" style="padding-top: var(--space-20);">
    <div class="alert alert--urgent">
      <span class="alert__icon">${icon('alert', { size: 22 })}</span>
      <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(msg)}</p></div>
    </div>
  </div>`;
}
