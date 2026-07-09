// /stipendi/tabella — tabella stipendi Ben/Dan per mese (admin only).
//
// Formula di Amos (09/07): Totale stipendio = ore × tariffa (o fisso
// mensile) + mance del mese + bonus incasso (solo Marco Sanarighi).
// Il Ben (bonifico) si imposta a mano da Stipendi → Ben/Dan; il Dan
// (contanti) NON si scrive: è GENERATO come Totale − Ben.
// Colonne: Nome / Totale / Ben / Dan, totali in fondo, testo copiabile.

import { apiGet } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { icon } from '../../js/icons.js';
import { showToast, skeletonList } from '../../js/components.js';
import { isBonusEligible, managerBonus, summaryRevenue, monthIso } from '../../js/manager-bonus.js';

const BEN_COLOR = '#2980b9';

export async function mountSalaryTable(container, _params, query) {
  setHeader({
    title: 'Tabella stipendi',
    brand: true,
    backHref: '/stipendi',
  });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(4)}</div>`;

  const now = new Date();
  const state = {
    year: parseInt(query.year, 10) || now.getFullYear(),
    month: parseInt(query.month, 10) || (now.getMonth() + 1),
    data: null,
    splits: {},
    bonus: 0,
  };

  await load();
  return () => {};

  async function load() {
    try {
      const refMonth = `${state.year}-${String(state.month).padStart(2, '0')}`;
      const range = monthIso(state.year, state.month);
      const [data, splits, summaries] = await Promise.all([
        apiGet(`/work-shifts/monthly-payroll?year=${state.year}&month=${state.month}`),
        apiGet(`/payroll-splits?payroll_month=${refMonth}`).catch(() => []),
        apiGet(`/daily-summary?from=${range.from}&to=${range.to}&limit=365`).catch(() => []),
      ]);
      state.data = data;
      state.splits = {};
      for (const s of splits) state.splits[s.user_id] = s;
      const monthlyRevenue = summaries.reduce((acc, s) => acc + (summaryRevenue(s) ?? 0), 0);
      state.bonus = managerBonus(monthlyRevenue);
      render();
    } catch (err) {
      container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
        <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
          <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(err.message || '')}</p></div></div></div>`;
    }
  }

  // Una riga per dipendente. total = lordo + mance + bonus; dan = total − ben.
  // Senza tariffa configurata il totale non è calcolabile → riga segnalata
  // ed esclusa dai totali di colonna.
  function tableRows() {
    return state.data.by_user.map((r) => {
      const split = state.splits?.[r.user.id];
      const ben = split ? Number(split.ben_amount) : 0;
      const tips = Number(r.tips_total) || 0;
      const bonus = isBonusEligible(r.user) && !r.needs_configuration ? state.bonus : 0;
      const computable = !r.needs_configuration && r.gross_amount != null;
      const total = computable ? Number(r.gross_amount) + tips + bonus : null;
      return {
        name: r.user.full_name,
        ben,
        tips,
        bonus,
        total,
        dan: total != null ? total - ben : null,
        hasBen: !!split && Number(split.ben_amount) > 0,
        computable,
      };
    });
  }

  function render() {
    const d = state.data;
    const rows = tableRows();
    const usable = rows.filter((r) => r.computable);
    const totTot = usable.reduce((acc, r) => acc + r.total, 0);
    const totBen = usable.reduce((acc, r) => acc + r.ben, 0);
    const totDan = usable.reduce((acc, r) => acc + r.dan, 0);
    const missingBen = usable.filter((r) => !r.hasBen).length;
    const notComputable = rows.length - usable.length;
    const negatives = usable.filter((r) => r.dan < 0).length;
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
        ${renderMonthNav()}
        ${missingBen > 0 ? `
        <div class="alert alert--warn" style="margin-bottom: var(--space-12);">
          <span class="alert__icon">${icon('warning', { size: 20 })}</span>
          <div class="alert__body"><p class="alert__text">
            ${missingBen === 1 ? 'Un dipendente è senza Ben impostato' : `${missingBen} dipendenti sono senza Ben impostato`} per questo mese: il totale finisce tutto nel Dan. Il Ben si imposta da Stipendi → Ben / Dan.
          </p></div>
        </div>` : ''}
        ${negatives > 0 ? `
        <div class="alert alert--warn" style="margin-bottom: var(--space-12);">
          <span class="alert__icon">${icon('warning', { size: 20 })}</span>
          <div class="alert__body"><p class="alert__text">
            C'è un Dan <strong>negativo</strong>: il Ben inserito supera il totale del mese. Controlla la ripartizione.
          </p></div>
        </div>` : ''}
        ${notComputable > 0 ? `
        <div class="alert alert--warn" style="margin-bottom: var(--space-12);">
          <span class="alert__icon">${icon('warning', { size: 20 })}</span>
          <div class="alert__body"><p class="alert__text">
            ${notComputable === 1 ? 'Un dipendente non ha' : `${notComputable} dipendenti non hanno`} la tariffa configurata: totale non calcolabile, riga esclusa dai totali. Si configura da Impostazioni → Utenti.
          </p></div>
        </div>` : ''}
        ${rows.length === 0
          ? `<p class="muted" style="text-align: center; padding: var(--space-20); background: var(--cream-soft); border-radius: var(--radius-md);">Nessun dipendente attivo.</p>`
          : `
        <div class="card" style="padding: var(--space-8) 0; margin-bottom: var(--space-16); overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; font-size: var(--text-sm);">
            <thead>
              <tr style="border-bottom: 2px solid var(--ink);">
                <th style="text-align: left; padding: var(--space-8) var(--space-12); font-weight: 600;">Nome</th>
                <th style="text-align: right; padding: var(--space-8) var(--space-12); font-weight: 600;">Totale</th>
                <th style="text-align: right; padding: var(--space-8) var(--space-12); font-weight: 600; color: ${BEN_COLOR};">Ben</th>
                <th style="text-align: right; padding: var(--space-8) var(--space-12); font-weight: 600; color: var(--terracotta);">Dan</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(renderRow).join('')}
            </tbody>
            <tfoot>
              <tr style="border-top: 2px solid var(--ink);">
                <td style="padding: var(--space-8) var(--space-12); font-weight: 600;">TOTALE</td>
                <td style="text-align: right; padding: var(--space-8) var(--space-12); font-family: var(--font-display); font-weight: 600;">€ ${fmt(totTot)}</td>
                <td style="text-align: right; padding: var(--space-8) var(--space-12); font-family: var(--font-display); font-weight: 600; color: ${BEN_COLOR};">€ ${fmt(totBen)}</td>
                <td style="text-align: right; padding: var(--space-8) var(--space-12); font-family: var(--font-display); font-weight: 600; color: var(--terracotta);">€ ${fmt(totDan)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <button type="button" data-copy class="btn btn--primary" style="width: 100%;">
          ${icon('copy', { size: 16 })} Copia tabella
        </button>
        <pre id="salary-text" class="muted" style="margin-top: var(--space-16); padding: var(--space-12); background: var(--cream-soft); border-radius: var(--radius-md); font-size: var(--text-xs); white-space: pre-wrap; overflow-x: auto;">${escapeHtml(buildText(rows, totTot, totBen, totDan))}</pre>
        `}
      </section>
    `;
    wire();
  }

  function renderRow(r) {
    if (!r.computable) {
      return `
      <tr style="border-bottom: 1px solid var(--border-soft);">
        <td style="padding: var(--space-8) var(--space-12);">${escapeHtml(r.name)}</td>
        <td colspan="3" class="muted" style="text-align: right; padding: var(--space-8) var(--space-12);">⚠ tariffa non configurata</td>
      </tr>`;
    }
    const parts = [];
    if (r.tips > 0) parts.push(`mance € ${fmt(r.tips)}`);
    if (r.bonus > 0) parts.push(`bonus € ${fmt(r.bonus)}`);
    const breakdown = parts.length
      ? `<div class="muted text-xs">incl. ${parts.join(' · ')}</div>`
      : '';
    const danStyle = r.dan < 0 ? 'color: var(--warning, #c9942a);' : 'color: var(--terracotta);';
    return `
      <tr style="border-bottom: 1px solid var(--border-soft);">
        <td style="padding: var(--space-8) var(--space-12);">${escapeHtml(r.name)}</td>
        <td style="text-align: right; padding: var(--space-8) var(--space-12); font-family: var(--font-display);">€ ${fmt(r.total)}${breakdown}</td>
        <td style="text-align: right; padding: var(--space-8) var(--space-12); font-family: var(--font-display); color: ${BEN_COLOR};">€ ${fmt(r.ben)}</td>
        <td style="text-align: right; padding: var(--space-8) var(--space-12); font-family: var(--font-display); ${danStyle}">${r.dan < 0 ? '⚠ ' : ''}€ ${fmt(r.dan)}</td>
      </tr>`;
  }

  function buildText(rows, totTot, totBen, totDan) {
    const d = state.data;
    const lines = [
      `Stipendi (Ben / Dan) — ${d.month_label}`,
      'Amodei Wine Bar',
      '',
      ...rows.map((r) => {
        if (!r.computable) return `${r.name}: tariffa non configurata`;
        const parts = [];
        if (r.tips > 0) parts.push(`mance € ${fmt(r.tips)}`);
        if (r.bonus > 0) parts.push(`bonus € ${fmt(r.bonus)}`);
        const inc = parts.length ? ` (incl. ${parts.join(', ')})` : '';
        return `${r.name}: Totale € ${fmt(r.total)}${inc} — Ben € ${fmt(r.ben)} — Dan € ${fmt(r.dan)}`;
      }),
      '',
      `TOTALE: € ${fmt(totTot)}`,
      `TOTALE Ben (bonifico): € ${fmt(totBen)}`,
      `TOTALE Dan (contanti): € ${fmt(totDan)}`,
    ];
    return lines.join('\n');
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
    const copyBtn = container.querySelector('[data-copy]');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const rows = tableRows();
        const usable = rows.filter((r) => r.computable);
        const totTot = usable.reduce((acc, r) => acc + r.total, 0);
        const totBen = usable.reduce((acc, r) => acc + r.ben, 0);
        const totDan = usable.reduce((acc, r) => acc + r.dan, 0);
        try {
          await copyToClipboard(buildText(rows, totTot, totBen, totDan));
          showToast('Tabella stipendi copiata', 'success');
        } catch {
          showToast('Copia non riuscita: seleziona e copia il testo qui sotto', 'warn', 5000);
        }
      });
    }
  }
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback per contesti senza Clipboard API
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('execCommand copy failed');
}

function fmt(v) { const n = Number(v); return Number.isNaN(n) ? '0,00' : n.toFixed(2).replace('.', ','); }
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
