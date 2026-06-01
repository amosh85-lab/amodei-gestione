// /turni/settimanale — schema settimanale completo dei turni (Amodei).
//
// Griglia 7 giorni × 2 servizi (pranzo / cena), tutti i dipendenti in
// un'unica sezione (Amodei non ha divisione cucina/sala). Ogni cella
// elenca chi lavora con il proprio orario di inizio.
//
// Sotto, riepilogo ore per dipendente con badge straordinario
// (manager: solo flag is_overtime; admin vede +Xh sopra contratto).

import { apiGet } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { userHasRole } from '../../js/auth.js';
import { icon } from '../../js/icons.js';
import { skeletonList } from '../../js/components.js';

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const SERVICES = [
  { key: 'lunch',  label: 'Pranzo' },
  { key: 'dinner', label: 'Cena' },
];

export async function mountShiftsWeekly(container, _params, query) {
  setHeader({ title: 'Vista settimanale', brand: true, backHref: '/turni' });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(3)}</div>`;

  const isAdmin = userHasRole('admin');

  const state = {
    weekStart: query.week_start || mondayIso(new Date()),
    summaries: [],
    allShifts: [],
    error: null,
  };

  await load();
  return () => {};

  // -----------------------------------------------------------------

  async function load() {
    state.error = null;
    try {
      const monday = new Date(state.weekStart);
      const sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + 6);
      const sundayIso = sunday.toISOString().slice(0, 10);
      const [summaries, shifts, leaves] = await Promise.all([
        apiGet(`/work-shifts/weekly-summary?week_start=${state.weekStart}`),
        apiGet(`/work-shifts?from_date=${state.weekStart}&to_date=${sundayIso}`),
        apiGet(`/day-leaves?from_date=${state.weekStart}&to_date=${sundayIso}`).catch(() => []),
      ]);
      state.summaries = summaries;
      state.allShifts = shifts;
      state.allLeaves = leaves;
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
        ${renderScheduleBlock()}

        <h3 style="font-family: var(--font-display); font-size: var(--text-lg); margin: var(--space-24) 0 var(--space-8) 0;">Riepilogo ore</h3>
        ${state.summaries.length === 0
          ? `<p class="muted text-sm" style="text-align: center; padding: var(--space-16); background: var(--cream-soft); border-radius: var(--radius-md);">Nessun dipendente con turni questa settimana.</p>`
          : state.summaries.map(renderUserSummaryRow).join('')}
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

  // ---------- Schema settimanale ----------

  function renderScheduleBlock() {
    return `
      <div style="margin-top: var(--space-12); padding: var(--space-12); border-radius: var(--radius-md); background: var(--cream-soft);">
        ${SERVICES.map(renderServiceGrid).join('')}
      </div>
    `;
  }

  function renderServiceGrid(svc) {
    const monday = new Date(state.weekStart);
    const dayIsos = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      dayIsos.push(d.toISOString().slice(0, 10));
    }

    const today = new Date().toISOString().slice(0, 10);
    return `
      <div style="margin-bottom: var(--space-12); background: var(--off-white); border: 1px solid var(--border-soft); border-radius: var(--radius-md); overflow: hidden;">
        <p class="muted text-xs uppercase" style="margin: 0; padding: var(--space-8) var(--space-12); letter-spacing: var(--letter-spacing-wide); background: var(--off-white); border-bottom: 1px solid var(--border-soft);">
          ${escapeHtml(svc.label)}
        </p>
        <div style="display: grid; grid-template-columns: repeat(7, 1fr);">
          ${DAY_LABELS.map((lbl, i) => {
            const isToday = dayIsos[i] === today;
            return `<div class="muted text-xs" style="padding: var(--space-4); text-align: center; background: ${isToday ? 'var(--cream-soft)' : 'var(--off-white)'}; border-right: 1px solid var(--border-soft); ${isToday ? 'font-weight: 600; color: var(--terracotta);' : ''}">${lbl}</div>`;
          }).join('')}
          ${dayIsos.map((iso) => {
            const isToday = iso === today;
            const cellShifts = shiftsAt(svc.key, iso);
            // Day-leaves: solo nella riga "pranzo" per evitare doppia visualizzazione
            const cellLeaves = svc.key === 'lunch' ? leavesAt(iso) : [];
            return `<div style="padding: var(--space-4); min-height: 56px; border-top: 1px solid var(--border-soft); border-right: 1px solid var(--border-soft); background: ${isToday ? 'rgba(181,57,31,0.04)' : 'transparent'};">
              ${cellLeaves.map(renderLeaveChip).join('')}
              ${cellShifts.length === 0 && cellLeaves.length === 0
                ? '<span class="muted text-xs" style="opacity: 0.4;">−</span>'
                : cellShifts.map(renderShiftChip).join('')}
            </div>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  function renderShiftChip(sh) {
    const start = (sh.start_time || '').slice(0, 5);
    const name = shortName(sh.user.full_name);
    return `<div style="font-size: 11px; padding: 2px 4px; margin-bottom: 2px; background: rgba(181,57,31,0.10); border-radius: 4px; line-height: 1.2;">
      <strong style="display:block;">${escapeHtml(name)}</strong>
      <span class="muted">${escapeHtml(start)}</span>
    </div>`;
  }

  function shiftsAt(serviceKey, iso) {
    return state.allShifts
      .filter((sh) => sh.date === iso && sh.service === serviceKey)
      .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
  }

  function leavesAt(iso) {
    return (state.allLeaves || [])
      .filter((l) => l.date === iso)
      .sort((a, b) => (a.user?.full_name || '').localeCompare(b.user?.full_name || ''));
  }

  function renderLeaveChip(l) {
    const palette = {
      ferie:    { bg: 'rgba(41,128,185,0.16)',  fg: '#2980b9', label: 'Ferie' },
      riposo:   { bg: 'rgba(106,76,147,0.16)',  fg: '#6a4c93', label: 'Riposo' },
      malattia: { bg: 'rgba(192,57,43,0.16)',   fg: '#c0392b', label: 'Malattia' },
    };
    const p = palette[l.kind] || palette.ferie;
    const name = shortName(l.user?.full_name || '');
    return `<div style="font-size: 11px; padding: 2px 4px; margin-bottom: 2px; background: ${p.bg}; color: ${p.fg}; border-radius: 4px; line-height: 1.2;">
      <strong style="display:block;">${escapeHtml(name)}</strong>
      <span style="font-size: 10px;">${p.label}</span>
    </div>`;
  }

  // ---------- Riepilogo ore ----------

  function renderUserSummaryRow(s) {
    const ot = s.is_overtime;
    const adminDetail = isAdmin && s.overtime_hours != null && Number(s.overtime_hours) > 0
      ? ` <span class="muted text-xs">(+${formatHours(s.overtime_hours)}h sopra ${formatHours(s.contract_hours || 0)})</span>`
      : '';
    return `
      <div class="card" style="padding: var(--space-12); margin-bottom: var(--space-8); ${ot ? 'border-left: 4px solid var(--warning, #c9942a);' : ''}">
        <div style="display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-8);">
          <p style="margin: 0; font-weight: 600;">${escapeHtml(s.user.full_name)}</p>
          <span style="font-family: var(--font-display); font-size: 1.2rem;">${formatHours(s.total_hours)}h ${ot ? '⚠' : ''}</span>
        </div>
        ${ot ? `<p class="text-xs" style="margin: var(--space-8) 0 0 0; color: var(--warning, #c9942a);">Straordinario${adminDetail}</p>` : ''}
      </div>
    `;
  }

  // ---------- Wiring ----------

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

// ---------- Helpers ----------

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
function shortName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.`;
}
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
