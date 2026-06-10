// /turni/calendario — vista mensile dei turni (manager/admin).
// Ogni cella mostra il totale ore del giorno. Tap → /turni con date pre-impostata.

import { apiGet } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { icon } from '../../js/icons.js';
import { skeletonList } from '../../js/components.js';
import { todayLocalIso } from '../../js/dates.js';

export async function mountShiftsCalendar(container, _params, query) {
  setHeader({ title: 'Calendario turni', brand: true, backHref: '/turni' });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(4)}</div>`;

  const now = new Date();
  const state = {
    year: parseInt(query.y, 10) || now.getFullYear(),
    month: (parseInt(query.m, 10) || (now.getMonth() + 1)) - 1,   // 0-indexed
    byDay: new Map(),     // 'YYYY-MM-DD' → total_hours
    totalMonth: 0,
  };

  await load();
  return () => {};

  async function load() {
    const { from, to } = monthRange(state.year, state.month);
    try {
      const shifts = await apiGet(`/work-shifts?from_date=${from}&to_date=${to}`);
      state.byDay = new Map();
      let total = 0;
      for (const sh of shifts) {
        const cur = state.byDay.get(sh.date) || 0;
        state.byDay.set(sh.date, cur + Number(sh.hours));
        total += Number(sh.hours);
      }
      state.totalMonth = total;
      render();
    } catch (err) {
      container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
        <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
          <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(err.message || '')}</p></div></div></div>`;
    }
  }

  function render() {
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
        ${renderMonthNav()}
        ${renderCalendar()}
        ${renderKpi()}
      </section>
    `;
    wire();
  }

  function renderMonthNav() {
    const label = new Date(state.year, state.month, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
    return `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-12);">
        <button type="button" data-nav="prev" class="btn btn--ghost btn--icon" aria-label="Mese precedente">${icon('chevron-left', { size: 22 })}</button>
        <p style="margin:0; font-family: var(--font-display); font-size: var(--text-lg); text-transform: capitalize; font-weight: 500;">${escapeHtml(label)}</p>
        <button type="button" data-nav="next" class="btn btn--ghost btn--icon" aria-label="Mese successivo">${icon('chevron-right', { size: 22 })}</button>
      </div>
    `;
  }

  function renderCalendar() {
    const firstDow = (new Date(state.year, state.month, 1).getDay() + 6) % 7; // 0 = lun
    const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
    const todayIso = todayLocalIso();
    const headers = ['L', 'M', 'M', 'G', 'V', 'S', 'D']
      .map((h) => `<div style="text-align:center; font-size: var(--text-xs); color: var(--ink-muted); padding: var(--space-4) 0;">${h}</div>`).join('');
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push('<div></div>');
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${state.year}-${String(state.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const hours = state.byDay.get(iso) || 0;
      const isToday = iso === todayIso;
      const dotColor = hours > 0 ? 'var(--terracotta)' : 'var(--border-soft)';
      cells.push(`
        <button type="button" data-day="${iso}" style="
          aspect-ratio: 1 / 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
          background: ${isToday ? 'var(--cream-soft)' : 'transparent'};
          border: 1px solid ${isToday ? 'var(--terracotta)' : 'var(--border-soft)'};
          border-radius: var(--radius-md); cursor: pointer; padding: var(--space-4); gap: 2px;">
          <span style="font-size: var(--text-sm); color: var(--ink);">${d}</span>
          <span style="font-family: var(--font-display); font-size: 10px; color: ${hours > 0 ? 'var(--terracotta-dark)' : 'var(--ink-muted)'};">${hours > 0 ? formatHours(hours) + 'h' : '—'}</span>
          <span style="width: 5px; height: 5px; border-radius: 50%; background: ${dotColor};"></span>
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

  function renderKpi() {
    const daysWith = [...state.byDay.values()].filter((h) => h > 0).length;
    const avg = daysWith > 0 ? state.totalMonth / daysWith : 0;
    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-8);">
        <div class="card" style="padding: var(--space-12);">
          <p class="muted text-xs" style="margin:0; text-transform: uppercase;">Ore totali mese</p>
          <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 1.4rem; font-weight: 600;">${formatHours(state.totalMonth)}h</p>
        </div>
        <div class="card" style="padding: var(--space-12);">
          <p class="muted text-xs" style="margin:0; text-transform: uppercase;">Media giornaliera</p>
          <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 1.4rem; font-weight: 600;">${formatHours(avg)}h</p>
          <p class="muted text-xs" style="margin: 2px 0 0 0;">${daysWith} ${daysWith === 1 ? 'giornata' : 'giornate'}</p>
        </div>
      </div>
    `;
  }

  function wire() {
    container.querySelectorAll('[data-day]').forEach((b) => {
      b.addEventListener('click', () => navigate(`/turni?date=${b.dataset.day}`));
    });
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
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
