// /stipendi/ripartizione — tabella Ripartizione Ben/Dan (admin only).
//
// Acconti separati per metodo:
//  - Acconti B = somma EmployeeAdvance.payment_method='bonifico' ref_month
//  - Acconti C = somma EmployeeAdvance.payment_method='cash'     ref_month

import { apiGet, apiPut, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { icon } from '../../js/icons.js';
import { showModal, showToast, skeletonList } from '../../js/components.js';

export async function mountBenDan(container, _params, query) {
  setHeader({ title: 'Ripartizione Ben / Dan', brand: true, backHref: '/stipendi' });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(3)}</div>`;

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

  function render() {
    const rows = state.data.by_user;
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
        ${renderMonthNav()}
        <p class="muted text-sm" style="margin: 0 0 var(--space-12) 0;">
          <strong>Ben</strong> = bonifico. <strong>Dan</strong> = contanti.
          Imposta tu i target per ciascun dipendente; gli acconti vengono presi automaticamente dal mese.
        </p>
        ${rows.length === 0
          ? `<p class="muted" style="text-align:center; padding: var(--space-20); background: var(--cream-soft); border-radius: var(--radius-md);">Nessun dipendente attivo.</p>`
          : `<div class="card" style="padding: 0; overflow-x: auto; -webkit-overflow-scrolling: touch;">
              <table style="width:100%; min-width: 760px; border-collapse: collapse; font-size: var(--text-sm);">
                <thead style="background: var(--cream-soft);">
                  <tr>
                    <th style="text-align:left; padding: var(--space-8) var(--space-12); font-weight:600;">Dipendente</th>
                    <th style="text-align:right; padding: var(--space-8);">Totale</th>
                    <th style="text-align:right; padding: var(--space-8); color: #2980b9;">Ben</th>
                    <th style="text-align:right; padding: var(--space-8); color: var(--terracotta);">Dan</th>
                    <th style="text-align:right; padding: var(--space-8);">Acconti <span class="muted text-xs">(B/C)</span></th>
                    <th style="text-align:right; padding: var(--space-8);">Rest.</th>
                    <th style="text-align:right; padding: var(--space-8); color: #2980b9;">Rest. Ben</th>
                    <th style="text-align:right; padding: var(--space-8); color: var(--terracotta);">Rest. Dan</th>
                    <th style="padding: var(--space-8);"></th>
                  </tr>
                </thead>
                <tbody>${rows.map(renderRow).join('')}</tbody>
              </table>
            </div>`}
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

  function renderRow(r) {
    const u = r.user;
    const split = state.splits?.[u.id];
    const ben = split ? Number(split.ben_amount) : 0;
    const dan = split ? Number(split.dan_amount) : 0;
    const totale = Number(r.gross_amount || 0);
    const accBonifico = Number(r.advances_bonifico || 0);
    const accCash = Number(r.advances_cash || 0);
    const accTot = accBonifico + accCash;
    const restTot = totale - accTot;
    const restBen = ben - accBonifico;
    const restDan = dan - accCash;
    const splitTot = ben + dan;
    const mismatch = split && Math.abs(splitTot - totale) > 0.01;
    return `
      <tr style="border-top: 1px solid var(--border-soft);">
        <td style="padding: var(--space-8) var(--space-12);">
          <span style="font-weight:500;">${escapeHtml(u.full_name)}</span>
          ${mismatch ? `<br><span class="text-xs" style="color: var(--warning, #c9942a);">⚠ Ben+Dan (€ ${fmt(splitTot)}) ≠ Totale</span>` : ''}
        </td>
        <td style="padding: var(--space-8); text-align:right; font-family: var(--font-display);">€ ${fmt(totale)}</td>
        <td style="padding: var(--space-8); text-align:right; font-family: var(--font-display); color: #2980b9;">€ ${fmt(ben)}</td>
        <td style="padding: var(--space-8); text-align:right; font-family: var(--font-display); color: var(--terracotta);">€ ${fmt(dan)}</td>
        <td style="padding: var(--space-8); text-align:right; font-family: var(--font-display);">
          € ${fmt(accBonifico)} <span class="muted text-xs">B</span><br>
          € ${fmt(accCash)} <span class="muted text-xs">C</span>
        </td>
        <td style="padding: var(--space-8); text-align:right; font-family: var(--font-display); font-weight:600;">€ ${fmt(restTot)}</td>
        <td style="padding: var(--space-8); text-align:right; font-family: var(--font-display); color: #2980b9; font-weight:600;">€ ${fmt(restBen)}</td>
        <td style="padding: var(--space-8); text-align:right; font-family: var(--font-display); color: var(--terracotta); font-weight:600;">€ ${fmt(restDan)}</td>
        <td style="padding: var(--space-8); text-align:center;">
          <button type="button" data-split="${u.id}" class="btn btn--ghost btn--sm" aria-label="Modifica Ben/Dan">${icon('edit', { size: 14 })}</button>
        </td>
      </tr>
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
    container.querySelectorAll('[data-split]').forEach((b) => {
      b.addEventListener('click', () => openSplitModal(Number(b.dataset.split)));
    });
  }

  function openSplitModal(userId) {
    const r = state.data.by_user.find((x) => x.user.id === userId);
    if (!r) return;
    const split = state.splits?.[userId];
    const totale = Number(r.gross_amount || 0);
    const refMonth = `${state.year}-${String(state.month).padStart(2, '0')}`;
    const body = `
      <form id="split-form" class="stack-12">
        <p class="muted text-sm" style="margin:0;">Ripartizione per <strong>${escapeHtml(r.user.full_name)}</strong>, ${escapeHtml(state.data.month_label)}.</p>
        <p class="muted text-xs" style="margin:0;">Totale stipendio: <strong>€ ${fmt(totale)}</strong>. Suggerimento: la somma di Ben + Dan dovrebbe quadrare col totale.</p>
        <div class="form-row">
          <label class="label" for="split-ben">Ben (bonifico) €</label>
          <input id="split-ben" class="input" type="number" min="0" step="0.01" inputmode="decimal" value="${split ? Number(split.ben_amount).toFixed(2) : ''}" placeholder="0,00" />
        </div>
        <div class="form-row">
          <label class="label" for="split-dan">Dan (contanti) €</label>
          <input id="split-dan" class="input" type="number" min="0" step="0.01" inputmode="decimal" value="${split ? Number(split.dan_amount).toFixed(2) : ''}" placeholder="0,00" />
        </div>
      </form>
    `;
    showModal('Imposta Ben / Dan', body, [
      { label: 'Annulla', variant: 'ghost' },
      {
        label: 'Salva',
        variant: 'primary',
        closeOnClick: false,
        onClick: async () => {
          const benRaw = document.getElementById('split-ben').value.trim();
          const danRaw = document.getElementById('split-dan').value.trim();
          const ben = benRaw === '' ? 0 : Number(benRaw);
          const dan = danRaw === '' ? 0 : Number(danRaw);
          if (!(ben >= 0) || !(dan >= 0)) { showToast('Importi non validi', 'warn'); return; }
          try {
            await apiPut('/payroll-splits', {
              user_id: userId,
              payroll_month: refMonth,
              ben_amount: ben.toFixed(2),
              dan_amount: dan.toFixed(2),
            });
            showToast('Ripartizione salvata', 'success');
            document.querySelectorAll('.modal-backdrop').forEach((bd) => bd.remove());
            await load();
          } catch (err) {
            const msg = err instanceof ApiError && err.message ? err.message : 'Errore';
            showToast(msg, 'danger', 5000);
          }
        },
      },
    ]);
  }
}

function fmt(v) { const n = Number(v); return Number.isNaN(n) ? '0,00' : n.toFixed(2).replace('.', ','); }
function escapeHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
