// /miei-turni — lista turni propri (staff / chiunque auth).

import { apiGet } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { icon } from '../../js/icons.js';
import { skeletonList } from '../../js/components.js';

export async function mountMyShifts(container, _params, query) {
  setHeader({ title: 'I miei turni', brand: true, backHref: '/' });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(3)}</div>`;

  const now = new Date();
  const state = {
    year: parseInt(query.y, 10) || now.getFullYear(),
    month: (parseInt(query.m, 10) || (now.getMonth() + 1)) - 1,
    shifts: [],
  };

  await load();
  return () => {};

  async function load() {
    const { from, to } = monthRange(state.year, state.month);
    try {
      state.shifts = await apiGet(`/work-shifts?from_date=${from}&to_date=${to}`);
      render();
    } catch (err) {
      container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
        <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
          <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(err.message || '')}</p></div></div></div>`;
    }
  }

  function render() {
    const total = state.shifts.reduce((s, sh) => s + Number(sh.hours), 0);
    const label = new Date(state.year, state.month, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-12);">
          <button type="button" data-nav="prev" class="btn btn--ghost btn--icon" aria-label="Mese precedente">${icon('chevron-left', { size: 22 })}</button>
          <p style="margin:0; font-family: var(--font-display); font-size: var(--text-lg); text-transform: capitalize; font-weight: 500;">${escapeHtml(label)}</p>
          <button type="button" data-nav="next" class="btn btn--ghost btn--icon" aria-label="Mese successivo">${icon('chevron-right', { size: 22 })}</button>
        </div>
        <div class="card" style="padding: var(--space-16); margin-bottom: var(--space-16); background: var(--cream-soft);">
          <p class="muted text-xs" style="margin:0; text-transform: uppercase;">Totale del mese</p>
          <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 1.8rem; font-weight: 600;">${formatHours(total)} ore</p>
          <p class="muted text-xs" style="margin: 2px 0 0 0;">${state.shifts.length} giornate</p>
        </div>
        ${state.shifts.length === 0
          ? `<p class="muted" style="text-align: center; padding: var(--space-20); background: var(--cream-soft); border-radius: var(--radius-md);">Nessun turno questo mese.</p>`
          : `<div class="card" style="padding: 0;">${state.shifts.map(renderRow).join('')}</div>`}
      </section>
    `;
    wire();
  }

  function renderRow(sh, i) {
    return `
      <div style="padding: var(--space-12) var(--space-16); ${i > 0 ? 'border-top: 1px solid var(--border-soft);' : ''}">
        <div style="display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-8);">
          <span style="font-weight: 500;">${formatDate(sh.date)}</span>
          <span style="font-family: var(--font-display); font-size: 1.2rem;">${formatHours(sh.hours)}h</span>
        </div>
        ${sh.notes ? `<p class="muted text-xs" style="margin: var(--space-4) 0 0 0;">${escapeHtml(sh.notes)}</p>` : ''}
      </div>
    `;
  }

  function wire() {
    container.querySelectorAll('[data-nav]').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.dataset.nav === 'prev') {
          state.month -= 1;
          if (state.month < 0) { state.month = 11; state.year -= 1; }
        } else {
          state.month += 1;
          if (state.month > 11) { state.month = 0; state.year += 1; }
        }
        load();
      });
    });
  }
}

function monthRange(y, m) {
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: fmt(new Date(y, m, 1)), to: fmt(new Date(y, m + 1, 0)) };
}
function formatHours(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return '0';
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}
function formatDate(iso) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
