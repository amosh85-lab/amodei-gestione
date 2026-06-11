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
    //   { user, start_time, end_time, notes, existingShiftId }
    // Il backend salva (start_time, hours): end_time esiste solo qui in UI
    // e le ore si derivano da fine − inizio (oltre mezzanotte: +24h).
    rows: [],
    // Mancia POS del (date, service) corrente: tip = riga esistente sul
    // backend (o null), tipAmount = valore corrente dell'input.
    tip: null,
    tipAmount: '',
    loading: true,
  };

  await load();
  return () => {};

  // -----------------------------------------------------------------

  async function load() {
    container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(4)}</div>`;
    try {
      const [day, leaves, tips] = await Promise.all([
        apiGet(`/work-shifts/by-date/${state.date}`),
        apiGet(`/day-leaves?from_date=${state.date}&to_date=${state.date}`).catch(() => []),
        apiGet(`/shift-tips?from_date=${state.date}&to_date=${state.date}`).catch(() => []),
      ]);
      state.tip = tips.find((t) => t.service === state.service) || null;
      state.tipAmount = state.tip ? String(Number(state.tip.amount)) : '';
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
          // Turni già salvati: fine = inizio + ore registrate.
          end_time: existing ? addHoursToTime(existing.start_time.slice(0, 5), existing.hours) : '',
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
    const totalHours = state.rows.reduce((s, r) => s + rowHours(r), 0);
    const activeCount = state.rows.filter((r) => rowHours(r) > 0).length;
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 110px;">
        ${renderFilters()}
        ${renderSummary(totalHours, activeCount)}
        ${renderTipCard(activeCount)}
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
              ${icon('check', { size: 20 })}<span id="save-btn-label">Salva turni ${escapeHtml(serviceLabel())} (${activeCount}/${state.rows.length})</span>
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
            <p id="sum-hours" style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 1.6rem; font-weight: 600;">${formatHours(total)} ore</p>
          </div>
          <p id="sum-count" class="muted text-sm">${count}/${state.rows.length} con turno</p>
        </div>
      </div>`;
  }

  function renderTipCard(activeCount) {
    return `
      <div class="card" style="padding: var(--space-12); margin-bottom: var(--space-12);">
        <div style="display: flex; align-items: center; gap: var(--space-12);">
          <div style="flex: 1; min-width: 0;">
            <label class="muted text-xs" for="tip-input" style="display: block; text-transform: uppercase;">Mancia POS · ${escapeHtml(serviceLabel())}</label>
            <p class="muted text-xs" id="tip-share" style="margin: 2px 0 0 0;">${escapeHtml(tipShareHint(activeCount))}</p>
          </div>
          <div style="flex: 0 0 120px; display: flex; align-items: center; gap: var(--space-4);">
            <span class="muted">€</span>
            <input type="number" id="tip-input" class="input" value="${escapeAttr(state.tipAmount)}" min="0" step="0.01" inputmode="decimal" placeholder="0,00" style="text-align: right; font-family: var(--font-display);">
          </div>
        </div>
      </div>`;
  }

  function tipShareHint(activeCount) {
    const amt = parseNumberInput(state.tipAmount);
    if (!(amt > 0)) return 'Divisa tra chi è in turno, sommata in busta a fine mese.';
    if (activeCount === 0) return 'Nessuno in turno: inserisci prima le ore.';
    return `€ ${fmtEuro(amt)} ÷ ${activeCount} in turno = € ${fmtEuro(amt / activeCount)} a testa`;
  }

  function updateTipHint() {
    const el = container.querySelector('#tip-share');
    if (el) el.textContent = tipShareHint(state.rows.filter((r) => rowHours(r) > 0).length);
  }

  // Aggiorna i derivati (totale riga, riepilogo, hint mancia, label salva)
  // senza ri-renderizzare: un render completo farebbe perdere il focus
  // all'input che si sta usando.
  function refreshDerived(idx) {
    if (idx != null) {
      const span = container.querySelector(`[data-total-idx="${idx}"]`);
      if (span) span.textContent = rowTotalLabel(state.rows[idx]);
    }
    const total = state.rows.reduce((s, r) => s + rowHours(r), 0);
    const active = state.rows.filter((r) => rowHours(r) > 0).length;
    const sumHours = container.querySelector('#sum-hours');
    if (sumHours) sumHours.textContent = `${formatHours(total)} ore`;
    const sumCount = container.querySelector('#sum-count');
    if (sumCount) sumCount.textContent = `${active}/${state.rows.length} con turno`;
    const saveLabel = container.querySelector('#save-btn-label');
    if (saveLabel) saveLabel.textContent = `Salva turni ${serviceLabel()} (${active}/${state.rows.length})`;
    updateTipHint();
  }

  function renderRow(r, idx) {
    const isExisting = r.existingShiftId !== null;
    const leave = state.leaves?.[r.user.id] || null;
    const isLeave = leave !== null;
    return `
      <div class="card" style="padding: var(--space-12); ${isLeave ? 'opacity: 0.85; background: rgba(106,76,147,0.04);' : (rowHours(r) > 0 ? '' : 'opacity: 0.7;')}">
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
        <!-- Side-by-side: Inizio + Fine compatti (95px) + Totale derivato.
             I container "wrap" hanno overflow hidden + border, e l'input
             type=time dentro è "nudo" (no border, no class .input). Così
             anche se iOS vuole stretchare il time picker, viene clippato
             alla larghezza del wrapper e visivamente resta a 95px. -->
        <div style="display: flex; gap: var(--space-8); margin-top: var(--space-12); align-items: flex-end;">
          <div style="flex: 0 0 95px;">
            <label class="muted text-xs" style="display:block; text-align: center;">Inizio</label>
            <div style="width: 95px; height: 44px; border: 1px solid var(--border-strong); border-radius: var(--radius-md); background: var(--off-white); overflow: hidden; display: flex; align-items: center;">
              <input type="time" data-time-idx="${idx}" step="900" value="${escapeAttr(r.start_time)}"
                     style="width: 100%; min-width: 0; height: 100%; border: none; outline: none; background: transparent; padding: 0 8px; font-family: var(--font-body); font-size: var(--text-base); color: var(--ink); box-sizing: border-box; -webkit-appearance: none; appearance: none;">
            </div>
          </div>
          <div style="flex: 0 0 95px;">
            <label class="muted text-xs" style="display:block; text-align: center;">Fine</label>
            <div style="width: 95px; height: 44px; border: 1px solid var(--border-strong); border-radius: var(--radius-md); background: var(--off-white); overflow: hidden; display: flex; align-items: center;">
              <input type="time" data-end-idx="${idx}" step="900" value="${escapeAttr(r.end_time)}"
                     style="width: 100%; min-width: 0; height: 100%; border: none; outline: none; background: transparent; padding: 0 8px; font-family: var(--font-body); font-size: var(--text-base); color: var(--ink); box-sizing: border-box; -webkit-appearance: none; appearance: none;">
            </div>
          </div>
          <div style="flex: 1 1 auto; min-width: 0;">
            <label class="muted text-xs" style="display:block; text-align: center;">Totale</label>
            <div style="height: 44px; display: flex; align-items: center; justify-content: center;">
              <span data-total-idx="${idx}" style="font-family: var(--font-display); font-size: 1.1rem; white-space: nowrap;">${escapeHtml(rowTotalLabel(r))}</span>
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
    container.querySelector('#tip-input')?.addEventListener('input', (e) => {
      state.tipAmount = e.target.value;
      updateTipHint();
    });
    container.querySelectorAll('[data-time-idx]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const idx = Number(e.target.dataset.timeIdx);
        state.rows[idx].start_time = e.target.value;
        refreshDerived(idx);
      });
    });
    container.querySelectorAll('[data-end-idx]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const idx = Number(e.target.dataset.endIdx);
        state.rows[idx].end_time = e.target.value;
        refreshDerived(idx);
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
    const shifts = [];
    for (const r of state.rows) {
      const h = rowHours(r);
      if (h <= 0) continue;
      if (!r.start_time || !/^\d{2}:\d{2}/.test(r.start_time)) {
        showToast(`Orario di inizio non valido per ${r.user.full_name}`, 'warn', 5000);
        return;
      }
      if (h > 12) {
        showToast(`Turno di ${r.user.full_name} oltre 12 ore (${formatHours(h)}h): controlla inizio e fine`, 'warn', 5000);
        return;
      }
      if ((h * 4) % 1 !== 0) {
        showToast(`Usa orari a step di 15 minuti (turno di ${r.user.full_name}: ${formatHours(h)}h)`, 'warn', 5000);
        return;
      }
      shifts.push({
        user_id: r.user.id,
        service: state.service,
        start_time: r.start_time,
        hours: h.toFixed(2),
        notes: r.notes || null,
      });
    }
    const tipVal = parseNumberInput(state.tipAmount);
    const hasTip = Number.isFinite(tipVal) && tipVal > 0;
    const tipChanged = hasTip
      ? !state.tip || Number(state.tip.amount) !== tipVal
      : !!state.tip;
    if (shifts.length === 0 && hasTip) {
      showToast('La mancia si divide tra chi è in turno: inserisci prima gli orari', 'warn', 5000);
      return;
    }
    if (shifts.length === 0 && !tipChanged) { showToast('Nessun turno da salvare', 'warn'); return; }
    try {
      if (shifts.length > 0) {
        await apiPost('/work-shifts/bulk', { date: state.date, shifts });
      }
      if (tipChanged) {
        if (hasTip) {
          await apiPut('/shift-tips', { date: state.date, service: state.service, amount: tipVal.toFixed(2) });
        } else {
          await apiDelete(`/shift-tips/${state.tip.id}`);
        }
      }
      const tipMsg = tipChanged ? (hasTip ? ` · mancia € ${fmtEuro(tipVal)}` : ' · mancia rimossa') : '';
      showToast(`Salvati ${shifts.length} turni${tipMsg}`, 'success');
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

// Ore tra inizio e fine ("HH:MM"). Fine prima dell'inizio = turno che
// scavalca mezzanotte (es. 18:00 → 02:00 = 8h). Fine vuota o uguale
// all'inizio = nessun turno (0).
function hoursFromRange(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  if ([sh, sm, eh, em].some((n) => !Number.isFinite(n))) return 0;
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return mins / 60;
}

function rowHours(r) {
  return hoursFromRange(r.start_time, r.end_time);
}

function rowTotalLabel(r) {
  const h = rowHours(r);
  if (h <= 0) return '—';
  const warn = h > 12 || (h * 4) % 1 !== 0 ? ' ⚠' : '';
  return `${formatHours(h)} h${warn}`;
}

// "HH:MM" + ore decimali → "HH:MM" (modulo 24h, per i turni esistenti).
function addHoursToTime(start, hours) {
  const [h, m] = String(start).split(':').map(Number);
  const total = ((h * 60 + m + Math.round(Number(hours) * 60)) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function formatHours(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return '0';
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
function fmtEuro(v) {
  const n = Number(v);
  return Number.isNaN(n) ? '0,00' : n.toFixed(2).replace('.', ',');
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
