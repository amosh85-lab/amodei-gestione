// /turni — daily shift entry (manager/admin).
//
// Per ogni dipendente: stepper +/- step 0.5, input modificabile diretto.
// Tasti rapidi "Tutti a 4h/6h/8h" + "Reset". Sticky bottom "Salva turni
// del giorno" → POST /work-shifts/bulk con tutte le righe > 0.
// Regola "solo chi ha lavorato": righe a 0 vengono escluse dal salvataggio.

import { apiGet, apiPost, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { icon } from '../../js/icons.js';
import { showToast, skeletonList, parseNumberInput } from '../../js/components.js';

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

  const initialDate = query.date || new Date().toISOString().slice(0, 10);
  const state = {
    date: initialDate,
    rows: [],          // [{user, hours, notes, existingShiftId | null}]
    loading: true,
    error: null,
  };

  await load();
  return () => {};

  // -----------------------------------------------------------------

  async function load() {
    container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(4)}</div>`;
    state.error = null;
    try {
      const day = await apiGet(`/work-shifts/by-date/${state.date}`);
      // Costruisco le righe: chi ha già turno (con ore esistenti) + chi non ne ha (a 0)
      const rows = [];
      for (const sh of day.shifts) {
        rows.push({
          user: sh.user, hours: Number(sh.hours),
          notes: sh.notes || '', existingShiftId: sh.id,
        });
      }
      for (const u of day.users_without_shift) {
        rows.push({ user: u, hours: 0, notes: '', existingShiftId: null });
      }
      // Ordino per nome
      rows.sort((a, b) => a.user.full_name.localeCompare(b.user.full_name, 'it'));
      state.rows = rows;
      render();
    } catch (err) {
      state.error = err.message || 'Errore di rete';
      container.innerHTML = errorBlock(state.error, load);
    }
  }

  function render() {
    const totalHours = state.rows.reduce((s, r) => s + Number(r.hours), 0);
    const activeCount = state.rows.filter((r) => Number(r.hours) > 0).length;
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 110px;">
        ${renderDatePicker()}
        ${renderSummary(totalHours, activeCount)}
        ${renderQuickFill()}
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
              ${icon('check', { size: 20 })}<span>Salva turni (${activeCount}/${state.rows.length})</span>
            </button>
          </div>
        </div>` : ''}
    `;
    wire();
  }

  function renderDatePicker() {
    const today = new Date().toISOString().slice(0, 10);
    const isToday = state.date === today;
    return `
      <div class="card" style="padding: var(--space-12); margin-bottom: var(--space-12);">
        <div style="display: flex; align-items: center; gap: var(--space-8);">
          <button type="button" data-day-shift="-1" class="btn btn--ghost btn--icon" aria-label="Giorno precedente">${icon('chevron-left', { size: 20 })}</button>
          <input type="date" id="date-picker" class="input" value="${state.date}" style="flex: 1;">
          <button type="button" data-day-shift="+1" class="btn btn--ghost btn--icon" aria-label="Giorno successivo">${icon('chevron-right', { size: 20 })}</button>
          ${!isToday ? `<button type="button" id="today-btn" class="btn btn--secondary btn--sm">Oggi</button>` : ''}
        </div>
      </div>
    `;
  }

  function renderSummary(total, count) {
    return `
      <div class="card" style="padding: var(--space-12); margin-bottom: var(--space-12); background: var(--cream-soft);">
        <div style="display: flex; justify-content: space-between; align-items: baseline;">
          <div>
            <p class="muted text-xs" style="margin:0; text-transform: uppercase;">Totale giorno</p>
            <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 1.6rem; font-weight: 600;">${formatHours(total)} ore</p>
          </div>
          <p class="muted text-sm">${count} ${count === 1 ? 'dipendente' : 'dipendenti'} con turno</p>
        </div>
      </div>
    `;
  }

  function renderQuickFill() {
    return `
      <div style="display: flex; gap: var(--space-4); margin-bottom: var(--space-8); flex-wrap: wrap;">
        <button type="button" data-quick="4" class="btn btn--ghost btn--sm">Tutti 4h</button>
        <button type="button" data-quick="6" class="btn btn--ghost btn--sm">Tutti 6h</button>
        <button type="button" data-quick="8" class="btn btn--ghost btn--sm">Tutti 8h</button>
        <button type="button" data-quick="0" class="btn btn--ghost btn--sm" style="margin-left: auto;">Reset</button>
      </div>
    `;
  }

  function renderRow(r, idx) {
    const isExisting = r.existingShiftId !== null;
    return `
      <div class="card" style="padding: var(--space-12); ${r.hours > 0 ? '' : 'opacity: 0.7;'}">
        <div style="display: flex; align-items: center; gap: var(--space-12);">
          <span style="width: 40px; height: 40px; border-radius: 50%; background: var(--terracotta); color: var(--off-white); display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-display); font-weight: 600; flex-shrink: 0;">${initials(r.user.full_name)}</span>
          <div style="flex: 1; min-width: 0;">
            <p style="margin: 0; font-weight: 500;">${escapeHtml(r.user.full_name)}</p>
            <p class="muted text-xs" style="margin: 2px 0 0 0;">${r.user.role}${isExisting ? ' · turno esistente' : ''}</p>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: var(--space-8); margin-top: var(--space-12);">
          <button type="button" data-step-idx="${idx}" data-delta="-0.5" class="btn btn--secondary" style="width: 44px; height: 44px; font-size: 1.4rem; padding: 0;">−</button>
          <input type="number" data-hours-idx="${idx}" class="input" value="${formatHours(r.hours)}" min="0" max="12" step="0.25" style="flex: 1; text-align: center; font-family: var(--font-display); font-size: 1.2rem;">
          <span class="muted text-sm">h</span>
          <button type="button" data-step-idx="${idx}" data-delta="+0.5" class="btn btn--secondary" style="width: 44px; height: 44px; font-size: 1.4rem; padding: 0;">+</button>
        </div>
        <div style="margin-top: var(--space-8);">
          <input type="text" data-notes-idx="${idx}" class="input" value="${escapeAttr(r.notes)}" placeholder="Note (opzionale)" maxlength="200">
        </div>
      </div>
    `;
  }

  function wire() {
    container.querySelector('#date-picker')?.addEventListener('change', (e) => {
      state.date = e.target.value;
      load();
    });
    container.querySelectorAll('[data-day-shift]').forEach((b) => {
      b.addEventListener('click', () => {
        const d = new Date(state.date);
        d.setDate(d.getDate() + Number(b.dataset.dayShift));
        state.date = d.toISOString().slice(0, 10);
        load();
      });
    });
    container.querySelector('#today-btn')?.addEventListener('click', () => {
      state.date = new Date().toISOString().slice(0, 10);
      load();
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
    container.querySelectorAll('[data-notes-idx]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const idx = Number(e.target.dataset.notesIdx);
        state.rows[idx].notes = e.target.value;
      });
    });
    container.querySelectorAll('[data-quick]').forEach((b) => {
      b.addEventListener('click', () => {
        const h = Number(b.dataset.quick);
        state.rows.forEach((r) => { r.hours = h; });
        render();
      });
    });
    container.querySelector('#save-btn')?.addEventListener('click', save);
  }

  async function save() {
    const shifts = state.rows
      .filter((r) => Number(r.hours) > 0)
      .map((r) => ({
        user_id: r.user.id,
        hours: Number(r.hours).toFixed(2),
        notes: r.notes || null,
      }));
    if (shifts.length === 0) { showToast('Nessun turno da salvare', 'warn'); return; }
    // Validazione multiplo 0.25 lato client per evitare round-trip
    for (const sh of shifts) {
      const h = Number(sh.hours);
      if ((h * 4) % 1 !== 0) {
        showToast(`Ore deve essere multiplo di 0.25 (es. 0.25, 0.5, 0.75, 1.0…). Trovato: ${sh.hours}`, 'warn', 5000);
        return;
      }
    }
    try {
      await apiPost('/work-shifts/bulk', { date: state.date, shifts });
      showToast(`Salvati ${shifts.length} turni`, 'success');
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
