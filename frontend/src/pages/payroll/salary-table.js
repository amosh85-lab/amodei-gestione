// /stipendi/tabella — tabella stipendi Ben/Dan per mese (admin only).
//
// Vista compatta e copiabile della ripartizione: una riga per dipendente
// con colonne Nome / Ben (bonifico) / Dan (contanti), totali in fondo.
// Stessi dati di /stipendi/ripartizione (monthly-payroll + payroll-splits);
// il bottone copia il riepilogo come testo semplice da inviare.

import { apiGet } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { icon } from '../../js/icons.js';
import { showToast, skeletonList } from '../../js/components.js';

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
  };

  await load();
  return () => {};

  async function load() {
    try {
      const refMonth = `${state.year}-${String(state.month).padStart(2, '0')}`;
      const [data, splits] = await Promise.all([
        apiGet(`/work-shifts/monthly-payroll?year=${state.year}&month=${state.month}`),
        apiGet(`/payroll-splits?payroll_month=${refMonth}`).catch(() => []),
      ]);
      state.data = data;
      state.splits = {};
      for (const s of splits) state.splits[s.user_id] = s;
      render();
    } catch (err) {
      container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
        <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
          <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(err.message || '')}</p></div></div></div>`;
    }
  }

  // Righe della tabella: tutti i dipendenti attivi, con Ben/Dan a 0 se la
  // ripartizione del mese non è ancora stata impostata.
  function tableRows() {
    return state.data.by_user.map((r) => {
      const split = state.splits?.[r.user.id];
      return {
        name: r.user.full_name,
        ben: split ? Number(split.ben_amount) : 0,
        dan: split ? Number(split.dan_amount) : 0,
        hasSplit: !!split,
      };
    });
  }

  function render() {
    const d = state.data;
    const rows = tableRows();
    const totBen = rows.reduce((acc, r) => acc + r.ben, 0);
    const totDan = rows.reduce((acc, r) => acc + r.dan, 0);
    const missing = rows.filter((r) => !r.hasSplit).length;
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
        ${renderMonthNav()}
        ${missing > 0 ? `
        <div class="alert alert--warn" style="margin-bottom: var(--space-16);">
          <span class="alert__icon">${icon('warning', { size: 20 })}</span>
          <div class="alert__body"><p class="alert__text">
            ${missing === 1 ? 'Un dipendente non ha' : `${missing} dipendenti non hanno`} ancora la ripartizione Ben/Dan impostata per questo mese (in tabella a € 0,00). Si imposta da Stipendi → Ben / Dan.
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
                <th style="text-align: right; padding: var(--space-8) var(--space-12); font-weight: 600; color: ${BEN_COLOR};">Ben</th>
                <th style="text-align: right; padding: var(--space-8) var(--space-12); font-weight: 600; color: var(--terracotta);">Dan</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((r) => `
              <tr style="border-bottom: 1px solid var(--border-soft);">
                <td style="padding: var(--space-8) var(--space-12);">${escapeHtml(r.name)}</td>
                <td style="text-align: right; padding: var(--space-8) var(--space-12); font-family: var(--font-display); color: ${BEN_COLOR};">€ ${fmt(r.ben)}</td>
                <td style="text-align: right; padding: var(--space-8) var(--space-12); font-family: var(--font-display); color: var(--terracotta);">€ ${fmt(r.dan)}</td>
              </tr>`).join('')}
            </tbody>
            <tfoot>
              <tr style="border-top: 2px solid var(--ink);">
                <td style="padding: var(--space-8) var(--space-12); font-weight: 600;">TOTALE</td>
                <td style="text-align: right; padding: var(--space-8) var(--space-12); font-family: var(--font-display); font-weight: 600; color: ${BEN_COLOR};">€ ${fmt(totBen)}</td>
                <td style="text-align: right; padding: var(--space-8) var(--space-12); font-family: var(--font-display); font-weight: 600; color: var(--terracotta);">€ ${fmt(totDan)}</td>
              </tr>
              <tr>
                <td style="padding: var(--space-4) var(--space-12) var(--space-8) var(--space-12); font-weight: 600;">TOTALE COMPLESSIVO</td>
                <td colspan="2" style="text-align: right; padding: var(--space-4) var(--space-12) var(--space-8) var(--space-12); font-family: var(--font-display); font-weight: 600;">€ ${fmt(totBen + totDan)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <button type="button" data-copy class="btn btn--primary" style="width: 100%;">
          ${icon('copy', { size: 16 })} Copia tabella
        </button>
        <pre id="salary-text" class="muted" style="margin-top: var(--space-16); padding: var(--space-12); background: var(--cream-soft); border-radius: var(--radius-md); font-size: var(--text-xs); white-space: pre-wrap; overflow-x: auto;">${escapeHtml(buildText(rows, totBen, totDan))}</pre>
        `}
      </section>
    `;
    wire();
  }

  function buildText(rows, totBen, totDan) {
    const d = state.data;
    const lines = [
      `Stipendi (Ben / Dan) — ${d.month_label}`,
      'Amodei Wine Bar',
      '',
      ...rows.map((r) => `${r.name}: Ben € ${fmt(r.ben)} — Dan € ${fmt(r.dan)}`),
      '',
      `TOTALE Ben: € ${fmt(totBen)}`,
      `TOTALE Dan: € ${fmt(totDan)}`,
      `TOTALE COMPLESSIVO: € ${fmt(totBen + totDan)}`,
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
        const totBen = rows.reduce((acc, r) => acc + r.ben, 0);
        const totDan = rows.reduce((acc, r) => acc + r.dan, 0);
        try {
          await copyToClipboard(buildText(rows, totBen, totDan));
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
