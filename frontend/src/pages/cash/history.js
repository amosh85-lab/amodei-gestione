// /cassa/storico — monthly calendar + KPI + CSV export (manager/admin).
//
// Reads from GET /daily-summary?from=&to= to compute monthly totals and
// per-day dots; tap on a day navigates to /cassa?date=YYYY-MM-DD.
// CSV export hits /cash-export/csv?from=&to= and triggers a browser download
// (fetch + Blob, since <a href> can't carry the bearer token).

import { apiGet, baseUrl } from '../../js/api.js';
import { getToken } from '../../js/auth.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { icon } from '../../js/icons.js';
import { showToast, showModal, skeletonList } from '../../js/components.js';

const WARN_DELTA = 5;  // |delta| in € → soglia ambra

export async function mountCashHistory(container, _params, query) {
  const now = new Date();
  const state = {
    year:  parseInt(query.y, 10) || now.getFullYear(),
    month: (parseInt(query.m, 10) || (now.getMonth() + 1)) - 1,   // 0-indexed
    summaries: [],   // list of DailySummaryOut
    loading: true,
  };

  setHeader({
    title: 'Storico cassa',
    brand: true,
    backHref: '/cassa',
    actions: [{ label: 'Esporta CSV', iconName: 'download', onClick: openExportModal }],
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
    const { from, to, daysInMonth } = monthRange(state.year, state.month);
    const byDay = indexByDay(state.summaries);

    // KPI: totale mese, media giornaliera (su giorni con incassi), proiezione
    let totalMonth = 0;
    let daysWithIncome = 0;
    for (const s of state.summaries) {
      if (s.computed_total != null) {
        totalMonth += Number(s.computed_total);
        daysWithIncome += 1;
      }
    }
    const avgDaily = daysWithIncome > 0 ? totalMonth / daysWithIncome : 0;
    const projection = avgDaily * daysInMonth;

    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
        ${renderKpiCards(totalMonth, avgDaily, projection, daysWithIncome, daysInMonth)}
        ${renderMonthNav(state.year, state.month)}
        ${renderCalendar(state.year, state.month, byDay)}
        ${renderLegend()}
        ${renderHistoryTable(state.summaries)}
      </section>
    `;
    wire();
  }

  function renderHistoryTable(summaries) {
    const rows = summaries
      .filter((s) => s.partial_lunch != null || s.partial_dinner != null || s.computed_total != null)
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date));

    const body = rows.length === 0
      ? `<tr><td colspan="4" style="padding: var(--space-16); text-align: center; color: var(--ink-muted);">Nessun dato per questo mese.</td></tr>`
      : rows.map((s) => `
          <tr data-row-day="${s.date}" style="cursor: pointer;">
            <td style="padding: var(--space-12); border: 1px solid var(--border-strong); text-transform: capitalize; white-space: nowrap;">${escapeHtml(humanDay(s.date))}</td>
            <td style="padding: var(--space-12); border: 1px solid var(--border-strong); text-align: right; font-family: var(--font-display); font-variant-numeric: tabular-nums;">${s.partial_lunch != null ? `€ ${formatMoney(s.partial_lunch)}` : '<span style="color: var(--ink-muted);">—</span>'}</td>
            <td style="padding: var(--space-12); border: 1px solid var(--border-strong); text-align: right; font-family: var(--font-display); font-variant-numeric: tabular-nums;">${s.partial_dinner != null ? `€ ${formatMoney(s.partial_dinner)}` : '<span style="color: var(--ink-muted);">—</span>'}</td>
            <td style="padding: var(--space-12); border: 1px solid var(--border-strong); text-align: right; font-family: var(--font-display); font-variant-numeric: tabular-nums; font-weight: 600; color: var(--terracotta-dark);">${s.computed_total != null ? `€ ${formatMoney(s.computed_total)}` : '<span style="color: var(--ink-muted);">—</span>'}</td>
          </tr>
        `).join('');

    return `
      <div style="margin-top: var(--space-20);">
        <p class="card__meta" style="margin: 0 0 var(--space-8) 0;">Riepilogo giornaliero</p>
        <div style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
          <table style="width: 100%; border-collapse: collapse; background: var(--off-white); font-size: var(--text-sm);">
            <thead>
              <tr style="background: var(--cream-soft);">
                <th style="padding: var(--space-12); border: 1px solid var(--border-strong); text-align: left; font-family: var(--font-display); font-weight: 600; white-space: nowrap;">Giorno</th>
                <th style="padding: var(--space-12); border: 1px solid var(--border-strong); text-align: right; font-family: var(--font-display); font-weight: 600;">Parziale pranzo</th>
                <th style="padding: var(--space-12); border: 1px solid var(--border-strong); text-align: right; font-family: var(--font-display); font-weight: 600;">Parziale cena</th>
                <th style="padding: var(--space-12); border: 1px solid var(--border-strong); text-align: right; font-family: var(--font-display); font-weight: 600;">Totale</th>
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderKpiCards(total, avg, projection, daysSoFar, daysTotal) {
    return `
      <div style="display: grid; grid-template-columns: 1fr; gap: var(--space-12); margin-bottom: var(--space-16);">
        <div class="card" style="padding: var(--space-16);">
          <p class="muted text-xs" style="margin:0; text-transform: uppercase; letter-spacing: var(--letter-spacing-wide);">Totale del mese</p>
          <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 2.2rem; font-weight: 600; color: var(--ink);">€ ${formatMoney(total)}</p>
          <p class="muted text-xs" style="margin: var(--space-4) 0 0 0;">${daysSoFar} ${daysSoFar === 1 ? 'giornata' : 'giornate'} con incassi</p>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-8);">
          <div class="card" style="padding: var(--space-12);">
            <p class="muted text-xs" style="margin:0; text-transform: uppercase;">Media giornaliera</p>
            <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 1.4rem; color: var(--ink);">€ ${formatMoney(avg)}</p>
          </div>
          <div class="card" style="padding: var(--space-12); border: 1px solid var(--terracotta);">
            <p class="muted text-xs" style="margin:0; text-transform: uppercase;">Proiezione mese</p>
            <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 1.4rem; color: var(--terracotta-dark);">€ ${formatMoney(projection)}</p>
            <p class="muted text-xs" style="margin: var(--space-4) 0 0 0;">media × ${daysTotal} gg</p>
          </div>
        </div>
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

  function renderCalendar(year, month, byDay) {
    const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // 0 = lun
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayIso = new Date().toISOString().slice(0, 10);

    const headers = ['L', 'M', 'M', 'G', 'V', 'S', 'D']
      .map((h) => `<div style="text-align:center; font-size: var(--text-xs); color: var(--ink-muted); padding: var(--space-4) 0;">${h}</div>`)
      .join('');

    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push('<div></div>');
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const s = byDay.get(iso);
      const dot = dotForSummary(s);
      const isToday = iso === todayIso;
      cells.push(`
        <button type="button" data-day="${iso}" style="
          aspect-ratio: 1 / 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
          background: ${isToday ? 'var(--cream-soft)' : 'transparent'};
          border: 1px solid ${isToday ? 'var(--terracotta)' : 'var(--border-soft)'};
          border-radius: var(--radius-md); cursor: pointer; padding: var(--space-4); gap: var(--space-4);">
          <span style="font-size: var(--text-sm); color: var(--ink);">${d}</span>
          ${dot}
        </button>
      `);
    }

    return `
      <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: var(--space-4); margin-bottom: var(--space-12);">
        ${headers}
        ${cells.join('')}
      </div>
    `;
  }

  function dotForSummary(s) {
    if (!s) {
      return '<span style="width: 8px; height: 8px; border-radius: 50%; background: var(--border-soft);"></span>';
    }
    let color = 'var(--ink-muted)';
    if (s.status === 'closed') {
      const df = s.delta_fiscal == null ? 0 : Math.abs(Number(s.delta_fiscal));
      const di = s.delta_ipratico == null ? 0 : Math.abs(Number(s.delta_ipratico));
      color = (df < WARN_DELTA && di < WARN_DELTA) ? 'var(--success, #4f8e3a)' : 'var(--warning, #c9942a)';
    }
    return `<span style="width: 8px; height: 8px; border-radius: 50%; background: ${color};"></span>`;
  }

  function renderLegend() {
    return `
      <div style="display: flex; gap: var(--space-12); flex-wrap: wrap; justify-content: center; font-size: var(--text-xs); color: var(--ink-muted);">
        <span style="display:inline-flex; align-items:center; gap: var(--space-4);"><span style="width:8px;height:8px;border-radius:50%;background:var(--success,#4f8e3a);"></span> chiusa, scostamenti &lt; 5€</span>
        <span style="display:inline-flex; align-items:center; gap: var(--space-4);"><span style="width:8px;height:8px;border-radius:50%;background:var(--warning,#c9942a);"></span> chiusa, scostamenti &ge; 5€</span>
        <span style="display:inline-flex; align-items:center; gap: var(--space-4);"><span style="width:8px;height:8px;border-radius:50%;background:var(--ink-muted);"></span> non chiusa</span>
      </div>
    `;
  }

  function wire() {
    container.querySelectorAll('[data-day]').forEach((btn) => {
      btn.addEventListener('click', () => navigate(`/cassa?date=${btn.dataset.day}`));
    });
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

  // -----------------------------------------------------------------
  // CSV export modal

  function openExportModal() {
    const now = new Date();
    const thisMonth = monthRange(now.getFullYear(), now.getMonth());
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonth = monthRange(prevDate.getFullYear(), prevDate.getMonth());
    const viewedMonth = monthRange(state.year, state.month);
    const isViewedCurrent = viewedMonth.from === thisMonth.from;

    const body = `
      <p class="muted text-sm" style="margin: 0 0 var(--space-12) 0;">Scegli il periodo da esportare in CSV.</p>
      <div style="display: grid; gap: var(--space-8);">
        ${!isViewedCurrent ? `<button type="button" data-range="viewed" class="btn btn--secondary" style="text-align:left;">Mese visualizzato <span class="muted">(${monthLabel(state.year, state.month)})</span></button>` : ''}
        <button type="button" data-range="current" class="btn btn--secondary" style="text-align:left;">Mese corrente <span class="muted">(${monthLabel(now.getFullYear(), now.getMonth())})</span></button>
        <button type="button" data-range="previous" class="btn btn--secondary" style="text-align:left;">Mese precedente <span class="muted">(${monthLabel(prevDate.getFullYear(), prevDate.getMonth())})</span></button>
        <hr style="border:none; border-top: 1px solid var(--border-soft); margin: var(--space-8) 0;">
        <label class="label" style="margin:0;">Intervallo personalizzato</label>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-8);">
          <input type="date" id="csv-from" class="input" value="${viewedMonth.from}">
          <input type="date" id="csv-to" class="input" value="${viewedMonth.to}">
        </div>
        <button type="button" data-range="custom" class="btn btn--primary" style="margin-top: var(--space-4);">Esporta intervallo</button>
      </div>
    `;
    const close = showModal('Esporta CSV', body, [{ label: 'Annulla', variant: 'ghost' }]);

    document.querySelectorAll('[data-range]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const kind = btn.dataset.range;
        let range;
        if (kind === 'viewed')   range = viewedMonth;
        else if (kind === 'current')  range = thisMonth;
        else if (kind === 'previous') range = prevMonth;
        else if (kind === 'custom') {
          const f = document.getElementById('csv-from').value;
          const t = document.getElementById('csv-to').value;
          if (!f || !t) { showToast('Seleziona entrambe le date', 'warn'); return; }
          if (t < f)    { showToast('La data finale è prima della iniziale', 'warn'); return; }
          range = { from: f, to: t };
        }
        try {
          await downloadCsv(range.from, range.to);
          close();
        } catch (err) {
          showToast(err.message || 'Errore', 'danger', 5000);
        }
      });
    });
  }

  async function downloadCsv(from, to) {
    const token = getToken();
    const url = `${baseUrl}/cash-export/csv?from=${from}&to=${to}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Export fallito (HTTP ${res.status})`);
    const blob = await res.blob();
    const filename = `amodei_cassa_${from}_${to}.csv`;
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
    showToast(`Scaricato ${filename}`, 'success');
  }
}

// ---------- helpers ----------

function monthRange(year, month /* 0-indexed */) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: fmt(first), to: fmt(last), daysInMonth: last.getDate() };
}

function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
}

function humanDay(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
}

function indexByDay(summaries) {
  const m = new Map();
  for (const s of summaries) m.set(s.date, s);
  return m;
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
