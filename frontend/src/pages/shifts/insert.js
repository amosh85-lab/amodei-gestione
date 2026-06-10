// /turni — inserimento turni giornaliero (manager/admin).
//
// Amodei: turno = (date, user_id, service) con start_time + hours.
// Una persona può avere 2 turni nello stesso giorno (pranzo + cena).
// Niente divisione cucina/sala (un solo reparto).

import { apiGet, apiPost, apiPut, apiDelete, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { icon } from '../../js/icons.js';
import { showToast, skeletonList, parseNumberInput } from '../../js/components.js';
import { todayLocalIso } from '../../js/dates.js';

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
    date: query.date || todayLocalIso(),
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
      const [day, leaves] = await Promise.all([
        apiGet(`/work-shifts/by-date/${state.date}`),
        apiGet(`/day-leaves?from_date=${state.date}&to_date=${state.date}`).catch(() => []),
      ]);
      state.leaves = {};
      for (const l of leaves) state.leaves[l.user_id] = l;
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
    const leave = state.leaves?.[r.user.id] || null;
    const isLeave = leave !== null;
    return `
      <div class="card" style="padding: var(--space-12); ${isLeave ? 'opacity: 0.85; background: rgba(106,76,147,0.04);' : (r.hours > 0 ? '' : 'opacity: 0.7;')}">
        <div style="display: flex; align-items: center; gap: var(--space-12);">
          <span style="width: 40px; height: 40px; border-radius: 50%; background: var(--terracotta); color: var(--off-white); display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-display); font-weight: 600; flex-shrink: 0;">${initials(r.user.full_name)}</span>
          <div style="flex: 1; min-width: 0;">
            <p style="margin: 0; font-weight: 500;">${escapeHtml(r.user.full_name)}</p>
            <p class="muted text-xs" style="margin: 2px 0 0 0;">${escapeHtml(r.user.role)}${isExisting ? ' · turno esistente' : ''}</p>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-4); margin-top: var(--space-12);">
          ${leaveBtn(r.user.id, '',         'Lavoro',   leave === null)}
          ${leaveBtn(r.user.id, 'ferie',    'Ferie',    leave?.kind === 'ferie')}
          ${leaveBtn(r.user.id, 'riposo',   'Riposo',   leave?.kind === 'riposo')}
          ${leaveBtn(r.user.id, 'malattia', 'Malattia', leave?.kind === 'malattia')}
        </div>
        ${isLeave ? '' : `
        <!-- Side-by-side: Inizio compatto (95px) + Ore fluido.
             Il container "wrap" di Inizio ha overflow hidden + border, e
             l'input type=time dentro è "nudo" (no border, no class .input).
             Così anche se iOS vuole stretchare il time picker, viene clippato
             alla larghezza del wrapper e visivamente resta a 95px. -->
        <div style="display: flex; gap: var(--space-8); margin-top: var(--space-12); align-items: flex-end;">
          <div style="flex: 0 0 95px;">
            <label class="muted text-xs" style="display:block; text-align: center;">Inizio</label>
            <div style="width: 95px; height: 44px; border: 1px solid var(--border-strong); border-radius: var(--radius-md); background: var(--off-white); overflow: hidden; display: flex; align-items: center;">
              <input type="time" data-time-idx="${idx}" value="${escapeAttr(r.start_time)}"
                     style="width: 100%; min-width: 0; height: 100%; border: none; outline: none; background: transparent; padding: 0 8px; font-family: var(--font-body); font-size: var(--text-base); color: var(--ink); box-sizing: border-box; -webkit-appearance: none; appearance: none;">
            </div>
          </div>
          <div style="flex: 1 1 auto; min-width: 0;">
            <label class="muted text-xs" style="display:block; text-align: center;">Ore</label>
            <div style="display: flex; align-items: center; gap: var(--space-4);">
              <button type="button" data-step-idx="${idx}" data-delta="-0.5" class="btn btn--secondary" style="flex: 0 0 36px; width: 36px; height: 44px; min-height: 44px; font-size: 1.2rem; padding: 0;">−</button>
              <input type="number" data-hours-idx="${idx}" class="input" value="${formatHours(r.hours)}" min="0" max="12" step="0.25" style="flex: 1 1 0; min-width: 0; width: 100%; text-align: center; font-family: var(--font-display); font-size: 1.1rem; padding: 0 4px;">
              <button type="button" data-step-idx="${idx}" data-delta="+0.5" class="btn btn--secondary" style="flex: 0 0 36px; width: 36px; height: 44px; min-height: 44px; font-size: 1.2rem; padding: 0;">+</button>
            </div>
          </div>
        </div>
        <div style="margin-top: var(--space-8);">
          <input type="text" data-notes-idx="${idx}" class="input" value="${escapeAttr(r.notes)}" placeholder="Note (opzionale)" maxlength="200">
        </div>
        `}
      </div>
    `;
  }

  function leaveBtn(userId, kind, label, active) {
    const colors = {
      '':         { bg: 'var(--terracotta)',    fg: 'var(--off-white)' },
      'ferie':    { bg: '#2980b9',              fg: 'var(--off-white)' },
      'riposo':   { bg: '#6a4c93',              fg: 'var(--off-white)' },
      'malattia': { bg: '#c0392b',              fg: 'var(--off-white)' },
    };
    const c = colors[kind];
    return `<button type="button" data-leave-kind="${kind}" data-leave-user="${userId}"
      style="padding: 6px var(--space-4); border-radius: var(--radius-md);
             border: 1px solid ${active ? c.bg : 'var(--border-soft)'};
             background: ${active ? c.bg : 'var(--off-white)'};
             color: ${active ? c.fg : 'var(--ink)'};
             font-size: 12px; cursor: pointer;
             font-weight: ${active ? '600' : '500'};">${label}</button>`;
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
    container.querySelectorAll('[data-leave-kind]').forEach((b) => {
      b.addEventListener('click', () => {
        const userId = Number(b.dataset.leaveUser);
        const kind = b.dataset.leaveKind || null;
        updateLeave(userId, kind);
      });
    });
    container.querySelector('#save-btn')?.addEventListener('click', save);
  }

  async function updateLeave(userId, kind) {
    try {
      const existing = state.leaves?.[userId];
      if (!kind) {
        if (existing) await apiDelete(`/day-leaves/${existing.id}`);
      } else {
        await apiPut('/day-leaves', { user_id: userId, date: state.date, kind });
      }
      showToast(kind ? `Segnato come ${kind}` : 'Stato rimosso', 'success');
      await load();
    } catch (err) {
      const msg = err instanceof ApiError && err.message ? err.message : 'Errore';
      showToast(msg, 'danger', 5000);
    }
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
