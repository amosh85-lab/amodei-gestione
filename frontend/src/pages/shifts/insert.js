// /turni — inserimento turni giornaliero (manager/admin).
//
// Amodei: turno = (date, user_id, service) con start_time + hours.
// Una persona può avere 2 turni nello stesso giorno (pranzo + cena).
// Niente divisione cucina/sala (un solo reparto).

import { apiGet, apiPost, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { icon } from '../../js/icons.js';
import { showToast, skeletonList, parseNumberInput } from '../../js/components.js';

const SERVICES = [
  { key: 'lunch',  label: 'Pranzo', defaultStart: '11:00' },
  { key: 'dinner', label: 'Cena',   defaultStart: '18:00' },
];

export async function mountShiftsInsert(container, _params, query) {
  setHeader({
    title: 'Turni',
    brand: true,
    backHref: '/',
    actions: [
      { label: 'Calendario', iconName: 'calendar', onClick: () => navigate('/turni/calendario') },
      { label: 'Settimanale', iconName: 'bar-chart', onClick: () => navigate('/turni/settimanale') },
    ],
  });

  const state = {
    date: query.date || new Date().toISOString().slice(0, 10),
    service: query.service === 'dinner' ? 'dinner' : 'lunch',
    // rows: per ogni dipendente con/senza turno per (date, service corrente):
    //   { user, start_time, hours, notes, existingShiftId }
    rows: [],
    loading: true,
  };

  await load();
  return () => {};

  // -----------------------------------------------------------------

  async function load() {
    container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(4)}</div>`;
    try {
      const day = await apiGet(`/work-shifts/by-date/${state.date}`);
      const allUsers = [...day.shifts.map((s) => s.user), ...day.users_without_shift];
      const seen = new Set();
      const uniqueUsers = allUsers.filter((u) => {
        if (seen.has(u.id)) return false;
        seen.add(u.id);
        return true;
      });

      const defaultStart = (SERVICES.find((s) => s.key === state.service) || {}).defaultStart || '11:00';
      const rows = uniqueUsers.map((user) => {
        const existing = day.shifts.find(
          (sh) => sh.user.id === user.id && sh.service === state.service,
        ) || null;
        return {
          user,
          start_time: existing ? existing.start_time.slice(0, 5) : defaultStart,
          hours: existing ? Number(existing.hours) : 0,
          notes: existing?.notes || '',
          existingShiftId: existing?.id || null,
        };
      });
      rows.sort((a, b) => a.user.full_name.localeCompare(b.user.full_name, 'it'));
      state.rows = rows;
      render();
    } catch (err) {
      container.innerHTML = errorBlock(err.message || 'Errore di rete', load);
    }
  }

  function render() {
    const totalHours = state.rows.reduce((s, r) => s + Number(r.hours), 0);
    const activeCount = state.rows.filter((r) => Number(r.hours) > 0).length;
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 110px;">
        ${renderFilters()}
        ${renderSummary(totalHours, activeCount)}
        <div id="rows-list" style="margin-top: var(--space-12); display: grid; gap: var(--space-12);">
          ${state.rows.length === 0
            ? `<p class="muted" style="text-align: center; padding: var(--space-20); background: var(--cream-soft); border-radius: var(--radius-md);">Nessun dipendente attivo. Aggiungili da Impostazioni → Utenti.</p>`
            : state.rows.map((r, i) => renderRow(r, i)).join('')}
        </div>
      </section>
      ${state.rows.length > 0 ? `
        <div style="position: fixed; left: 0; right: 0; bottom: calc(72px + env(safe-area-inset-bottom, 0px)); z-index: 9; padding: var(--space-12) var(--space-20); background: var(--off-white); border-top: 1px solid var(--border-soft); box-shadow: 0 -2px 12px rgba(120,30,20,0.06);">
          <div class="container" style="padding: 0;">
            <button type="button" id="save-btn" class="btn btn--primary btn--lg full-width">
              ${icon('check', { size: 20 })}<span>Salva turni ${escapeHtml(serviceLabel())} (${activeCount}/${state.rows.length})</span>
            </button>
          </div>
        </div>` : ''}
    `;
    wire();
  }

  function renderFilters() {
    const dp = `
      <div class="card" style="padding: var(--space-12); margin-bottom: var(--space-8);">
        <div style="display: flex; align-items: center; gap: var(--space-8);">
          <button type="button" data-day-shift="-1" class="btn btn--ghost btn--icon" aria-label="Giorno precedente">${icon('chevron-left', { size: 20 })}</button>
          <input type="date" id="date-picker" class="input" value="${state.date}" style="flex: 1;">
          <button type="button" data-day-shift="+1" class="btn btn--ghost btn--icon" aria-label="Giorno successivo">${icon('chevron-right', { size: 20 })}</button>
        </div>
      </div>`;
    const serviceTabs = `
      <div class="row" style="gap: var(--space-4); margin-bottom: var(--space-12);">
        ${SERVICES.map((s) => {
          const active = state.service === s.key;
          return `<button type="button" data-service="${s.key}"
            style="flex: 1; padding: var(--space-8); border: 1px solid ${active ? 'var(--terracotta)' : 'var(--border-soft)'};
                   border-radius: var(--radius-md);
                   background: ${active ? 'var(--terracotta)' : 'var(--off-white)'};
                   color: ${active ? 'var(--off-white)' : 'var(--ink)'};
                   cursor: pointer;">
            ${escapeHtml(s.label)}
          </button>`;
        }).join('')}
      </div>`;
    return dp + serviceTabs;
  }

  function renderSummary(total, count) {
    return `
      <div class="card" style="padding: var(--space-12); margin-bottom: var(--space-12); background: var(--cream-soft);">
        <div style="display: flex; justify-content: space-between; align-items: baseline;">
          <div>
            <p class="muted text-xs" style="margin:0; text-transform: uppercase;">${escapeHtml(serviceLabel())}</p>
            <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 1.6rem; font-weight: 600;">${formatHours(total)} ore</p>
          </div>
          <p class="muted text-sm">${count}/${state.rows.length} con turno</p>
        </div>
      </div>`;
  }

  function renderRow(r, idx) {
    const isExisting = r.existingShiftId !== null;
    return `
      <div class="card" style="padding: var(--space-12); ${r.hours > 0 ? '' : 'opacity: 0.7;'}">
        <div style="display: flex; align-items: center; gap: var(--space-12);">
          <span style="width: 40px; height: 40px; border-radius: 50%; background: var(--terracotta); color: var(--off-white); display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-display); font-weight: 600; flex-shrink: 0;">${initials(r.user.full_name)}</span>
          <div style="flex: 1; min-width: 0;">
            <p style="margin: 0; font-weight: 500;">${escapeHtml(r.user.full_name)}</p>
            <p class="muted text-xs" style="margin: 2px 0 0 0;">${escapeHtml(r.user.role)}${isExisting ? ' · turno esistente' : ''}</p>
          </div>
        </div>
        <div style="display: flex; gap: var(--space-8); margin-top: var(--space-12); flex-wrap: wrap;">
          <div style="flex: 1 1 100px; min-width: 0;">
            <label class="muted text-xs" style="display:block;">Inizio</label>
            <input type="time" data-time-idx="${idx}" class="input" value="${escapeAttr(r.start_time)}" style="width: 100%;">
          </div>
          <div style="flex: 2 1 160px; min-width: 0;">
            <label class="muted text-xs" style="display:block;">Ore</label>
            <div style="display: flex; align-items: center; gap: var(--space-4);">
              <button type="button" data-step-idx="${idx}" data-delta="-0.5" class="btn btn--secondary" style="flex: 0 0 36px; width: 36px; height: 36px; font-size: 1.2rem; padding: 0;">−</button>
              <input type="number" data-hours-idx="${idx}" class="input" value="${formatHours(r.hours)}" min="0" max="12" step="0.25" style="flex: 1 1 0; min-width: 0; text-align: center; font-family: var(--font-display); font-size: 1.05rem;">
              <button type="button" data-step-idx="${idx}" data-delta="+0.5" class="btn btn--secondary" style="flex: 0 0 36px; width: 36px; height: 36px; font-size: 1.2rem; padding: 0;">+</button>
            </div>
          </div>
        </div>
        <div style="margin-top: var(--space-8);">
          <input type="text" data-notes-idx="${idx}" class="input" value="${escapeAttr(r.notes)}" placeholder="Note (opzionale)" maxlength="200">
        </div>
      </div>
    `;
  }

  function serviceLabel() {
    return (SERVICES.find((s) => s.key === state.service) || {}).label || state.service;
  }

  function wire() {
    container.querySelector('#date-picker')?.addEventListener('change', (e) => {
      state.date = e.target.value;
      state.service = 'lunch';
      navigate(qs(), { replace: true });
      load();
    });
    container.querySelectorAll('[data-day-shift]').forEach((b) => {
      b.addEventListener('click', () => {
        const d = new Date(state.date);
        d.setDate(d.getDate() + Number(b.dataset.dayShift));
        state.date = d.toISOString().slice(0, 10);
        state.service = 'lunch';
        navigate(qs(), { replace: true });
        load();
      });
    });
    container.querySelectorAll('[data-service]').forEach((b) => {
      b.addEventListener('click', () => {
        state.service = b.dataset.service;
        navigate(qs(), { replace: true });
        load();
      });
    });
    container.querySelectorAll('[data-step-idx]').forEach((b) => {
      b.addEventListener('click', () => {
        const idx = Number(b.dataset.stepIdx);
        const delta = Number(b.dataset.delta);
        const r = state.rows[idx];
        r.hours = Math.max(0, Math.min(12, Number(r.hours) + delta));
        render();
      });
    });
    container.querySelectorAll('[data-hours-idx]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const idx = Number(e.target.dataset.hoursIdx);
        const v = parseNumberInput(e.target.value);
        state.rows[idx].hours = Number.isFinite(v) ? Math.max(0, Math.min(12, v)) : 0;
      });
    });
    container.querySelectorAll('[data-time-idx]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const idx = Number(e.target.dataset.timeIdx);
        state.rows[idx].start_time = e.target.value;
      });
    });
    container.querySelectorAll('[data-notes-idx]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const idx = Number(e.target.dataset.notesIdx);
        state.rows[idx].notes = e.target.value;
      });
    });
    container.querySelector('#save-btn')?.addEventListener('click', save);
  }

  function qs() {
    return `/turni?date=${state.date}&service=${state.service}`;
  }

  async function save() {
    const shifts = state.rows
      .filter((r) => Number(r.hours) > 0)
      .map((r) => ({
        user_id: r.user.id,
        service: state.service,
        start_time: r.start_time,
        hours: Number(r.hours).toFixed(2),
        notes: r.notes || null,
      }));
    if (shifts.length === 0) { showToast('Nessun turno da salvare', 'warn'); return; }
    for (const sh of shifts) {
      if (!sh.start_time || !/^\d{2}:\d{2}/.test(sh.start_time)) {
        showToast('Inserisci un orario di inizio valido per ogni turno', 'warn');
        return;
      }
      const h = Number(sh.hours);
      if ((h * 4) % 1 !== 0) {
        showToast(`Ore deve essere multiplo di 0.25. Trovato: ${sh.hours}`, 'warn', 5000);
        return;
      }
    }
    try {
      await apiPost('/work-shifts/bulk', { date: state.date, shifts });
      showToast(`Salvati ${shifts.length} turni`, 'success');
      // Dopo aver salvato il pranzo, passa subito alla cena dello stesso giorno.
      if (state.service === 'lunch') {
        state.service = 'dinner';
        navigate(qs(), { replace: true });
      }
      await load();
    } catch (err) {
      const msg = err instanceof ApiError && err.message ? err.message : 'Errore salvataggio';
      showToast(msg, 'danger', 5000);
    }
  }
}

// ---------- helpers ----------

function formatHours(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return '0';
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
function initials(name) {
  return String(name || '').split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
}
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
function errorBlock(msg, onRetry) {
  setTimeout(() => {
    const btn = document.getElementById('retry-load');
    if (btn) btn.addEventListener('click', onRetry);
  }, 0);
  return `<div class="container" style="padding-top: var(--space-20);">
    <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
      <div class="alert__body"><strong>Errore</strong>
        <p class="alert__text">${escapeHtml(msg)}</p>
        <button type="button" id="retry-load" class="btn btn--secondary btn--sm" style="margin-top: var(--space-8);">Riprova</button>
      </div></div></div>`;
}
