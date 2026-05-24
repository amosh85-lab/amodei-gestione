// /turni/settimanale — vista settimanale tabellare (manager/admin).
// Per ogni dipendente: ore L-D + totale. Alert overtime (manager solo badge,
// admin con dettaglio "+Xh sopra contratto").

import { apiGet } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { setHeader as _ } from '../../js/app-shell.js';
import { userHasRole } from '../../js/auth.js';
import { icon } from '../../js/icons.js';
import { skeletonList } from '../../js/components.js';

const DAY_LABELS = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];

export async function mountShiftsWeekly(container, _params, query) {
  setHeader({ title: 'Vista settimanale', brand: true, backHref: '/turni' });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(3)}</div>`;

  const isAdmin = userHasRole('admin');
  const state = {
    weekStart: query.week_start || mondayIso(new Date()),
    summaries: [],
    dailyShifts: {},   // userId → { 'YYYY-MM-DD' → hours }
    error: null,
  };

  await load();
  return () => {};

  async function load() {
    state.error = null;
    try {
      const monday = new Date(state.weekStart);
      const sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + 6);
      const sundayIso = sunday.toISOString().slice(0, 10);
      const [summaries, shifts] = await Promise.all([
        apiGet(`/work-shifts/weekly-summary?week_start=${state.weekStart}`),
        apiGet(`/work-shifts?from_date=${state.weekStart}&to_date=${sundayIso}`),
      ]);
      state.summaries = summaries;
      // Map shifts: userId → date → hours
      state.dailyShifts = {};
      for (const sh of shifts) {
        if (!state.dailyShifts[sh.user.id]) state.dailyShifts[sh.user.id] = {};
        state.dailyShifts[sh.user.id][sh.date] = Number(sh.hours);
      }
      render();
    } catch (err) {
      state.error = err.message || 'Errore';
      container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
        <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
          <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(state.error)}</p></div></div></div>`;
    }
  }

  function render() {
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
        ${renderWeekNav()}
        ${state.summaries.length === 0
          ? `<p class="muted" style="text-align: center; padding: var(--space-20); background: var(--cream-soft); border-radius: var(--radius-md);">Nessun dipendente nel periodo.</p>`
          : state.summaries.map(renderUserRow).join('')}
      </section>
    `;
    wire();
  }

  function renderWeekNav() {
    const m = new Date(state.weekStart);
    const s = new Date(m); s.setDate(s.getDate() + 6);
    const label = `${m.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })} − ${s.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}`;
    return `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-12);">
        <button type="button" data-nav="prev" class="btn btn--ghost btn--icon" aria-label="Settimana precedente">${icon('chevron-left', { size: 22 })}</button>
        <p style="margin:0; font-family: var(--font-display); font-size: var(--text-md); text-align: center;">${escapeHtml(label)}</p>
        <button type="button" data-nav="next" class="btn btn--ghost btn--icon" aria-label="Settimana successiva">${icon('chevron-right', { size: 22 })}</button>
      </div>
    `;
  }

  function renderUserRow(s) {
    const dayHours = [];
    const monday = new Date(state.weekStart);
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const h = state.dailyShifts[s.user.id]?.[iso] || 0;
      dayHours.push(h);
    }
    const ot = s.is_overtime;
    const adminDetail = isAdmin && s.overtime_hours != null && Number(s.overtime_hours) > 0
      ? ` <span class="muted text-xs">(+${formatHours(s.overtime_hours)}h sopra ${formatHours(s.contract_hours || 0)})</span>`
      : '';
    return `
      <div class="card" style="padding: var(--space-12); margin-bottom: var(--space-12); ${ot ? 'border-left: 4px solid var(--warning, #c9942a);' : ''}">
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: var(--space-8);">
          <p style="margin: 0; font-weight: 600;">${escapeHtml(s.user.full_name)}</p>
          <span style="font-family: var(--font-display); font-size: 1.2rem;">${formatHours(s.total_hours)}h ${ot ? '⚠' : ''}</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; font-size: var(--text-xs); text-align: center;">
          ${DAY_LABELS.map((lbl, i) => `<div class="muted">${lbl}</div>`).join('')}
          ${dayHours.map((h) => `<div style="padding: var(--space-4) 0; font-family: var(--font-display); color: ${h > 0 ? 'var(--ink)' : 'var(--ink-muted)'};">${h > 0 ? formatHours(h) : '−'}</div>`).join('')}
        </div>
        ${ot ? `<p class="text-xs" style="margin: var(--space-8) 0 0 0; color: var(--warning, #c9942a);">${isAdmin ? 'Straordinario' : 'Straordinario'}${adminDetail}</p>` : ''}
      </div>
    `;
  }

  function wire() {
    container.querySelectorAll('[data-nav]').forEach((b) => {
      b.addEventListener('click', () => {
        const m = new Date(state.weekStart);
        m.setDate(m.getDate() + (b.dataset.nav === 'prev' ? -7 : 7));
        state.weekStart = m.toISOString().slice(0, 10);
        load();
      });
    });
  }
}

function mondayIso(d) {
  const day = (d.getDay() + 6) % 7;
  const m = new Date(d);
  m.setDate(m.getDate() - day);
  return m.toISOString().slice(0, 10);
}
function formatHours(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return '0';
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
