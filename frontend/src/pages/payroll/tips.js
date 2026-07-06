// /stipendi/mance — riepilogo mensile mance per la consulente del lavoro (admin only).
//
// Mostra la quota mance di ogni dipendente per il mese selezionato (stessi
// dati di /work-shifts/monthly-payroll, campo tips_total) e un bottone che
// copia il riepilogo come testo semplice da incollare in una mail/WhatsApp
// per la busta paga.

import { apiGet } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { icon } from '../../js/icons.js';
import { showToast, skeletonList } from '../../js/components.js';

export async function mountPayrollTips(container, _params, query) {
  setHeader({
    title: 'Mance del mese',
    brand: true,
    backHref: '/stipendi',
  });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(4)}</div>`;

  const now = new Date();
  const state = {
    year: parseInt(query.year, 10) || now.getFullYear(),
    month: parseInt(query.month, 10) || (now.getMonth() + 1),
    data: null,
  };

  await load();
  return () => {};

  async function load() {
    try {
      state.data = await apiGet(`/work-shifts/monthly-payroll?year=${state.year}&month=${state.month}`);
      render();
    } catch (err) {
      container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
        <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
          <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(err.message || '')}</p></div></div></div>`;
    }
  }

  function tipRows() {
    return state.data.by_user
      .filter((r) => Number(r.tips_total) > 0)
      .sort((a, b) => a.user.full_name.localeCompare(b.user.full_name, 'it'));
  }

  function render() {
    const d = state.data;
    const rows = tipRows();
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
        ${renderMonthNav()}
        <div class="alert alert--info" style="margin-bottom: var(--space-16);">
          <span class="alert__icon">${icon('info', { size: 20 })}</span>
          <div class="alert__body"><p class="alert__text">
            Quote mance POS del mese, divise tra i presenti di ogni servizio.
            Copia il testo e invialo alla consulente del lavoro per la busta paga.
          </p></div>
        </div>
        ${rows.length === 0
          ? `<p class="muted" style="text-align: center; padding: var(--space-20); background: var(--cream-soft); border-radius: var(--radius-md);">Nessuna mancia registrata per ${escapeHtml(d.month_label)}.</p>`
          : `
        <div class="card" style="padding: var(--space-16); margin-bottom: var(--space-16);">
          <div style="display: grid; gap: var(--space-8); font-size: var(--text-sm);">
            ${rows.map((r) => `
              <div class="row" style="justify-content: space-between;">
                <span>${escapeHtml(r.user.full_name)}</span>
                <span style="font-family: var(--font-display);">€ ${fmt(r.tips_total)}</span>
              </div>`).join('')}
          </div>
          <div style="border-top: 2px solid var(--ink); margin-top: var(--space-12); padding-top: var(--space-12);">
            <div class="row" style="justify-content: space-between; align-items: baseline;">
              <span style="font-weight: 600;">TOTALE MANCE</span>
              <span style="font-family: var(--font-display); font-size: 1.6rem; color: var(--terracotta);">€ ${fmt(d.totals.total_tips)}</span>
            </div>
          </div>
        </div>
        <button type="button" data-copy class="btn btn--primary" style="width: 100%;">
          ${icon('copy', { size: 16 })} Copia per la consulente
        </button>
        <pre id="tips-text" class="muted" style="margin-top: var(--space-16); padding: var(--space-12); background: var(--cream-soft); border-radius: var(--radius-md); font-size: var(--text-xs); white-space: pre-wrap; overflow-x: auto;">${escapeHtml(buildText(rows))}</pre>
        `}
      </section>
    `;
    wire();
  }

  function buildText(rows) {
    const d = state.data;
    const lines = [
      `Mance da inserire in busta paga — ${d.month_label}`,
      'Amodei Wine Bar',
      '',
      ...rows.map((r) => `${r.user.full_name}: € ${fmt(r.tips_total)}`),
      '',
      `TOTALE: € ${fmt(d.totals.total_tips)}`,
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
        const text = buildText(tipRows());
        try {
          await copyToClipboard(text);
          showToast('Riepilogo mance copiato', 'success');
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
