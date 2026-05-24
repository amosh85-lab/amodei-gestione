// /chiusura-serale — end-of-day workflow.
//
// Loads GET /evening-close/today. If a close already exists for today,
// shows it read-only with a "Modifica" entry point for admin/manager.
// Otherwise renders the list of active products with pre-filled qty
// inputs + per-row diff badges + a sticky save bar.

import { apiGet, apiPost, apiPatch, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { userHasRole, getCurrentUser } from '../../js/auth.js';
import { icon } from '../../js/icons.js';
import { showToast, showModal, confirmDialog, skeletonList } from '../../js/components.js';

export async function mountInventoryClose(container) {
  const canEdit = userHasRole('admin', 'manager');

  setHeader({
    title: 'Chiusura serale',
    brand: true,
    backHref: '/',
  });

  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(3)}</div>`;

  let data;
  try {
    data = await apiGet('/evening-close/today');
  } catch (err) {
    container.innerHTML = errorCard(err.message || 'Errore di rete');
    return;
  }

  const todayLabel = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  const closeExists = data.close != null;
  const state = {
    editMode: !closeExists,         // form editable iff no close yet
    close: data.close,
    items: data.items,
    search: '',
    category: null,
    // localQty: { [product_id]: string } — only present when editMode
    localQty: {},
  };
  // Seed localQty
  for (const it of state.items) {
    const startValue = it.qty_remaining_saved ?? it.qty_actual;
    state.localQty[it.product_id] = formatNumForInput(startValue);
  }

  render();

  return () => {};

  // -----------------------------------------------------------------

  function render() {
    if (!state.editMode && state.close) renderReadOnly();
    else renderEditable();
  }

  function renderReadOnly() {
    const c = state.close;
    const closedBy = c.user_name || `utente #${c.user_id}`;
    const items = state.items;
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-20); padding-bottom: 80px;">
        <div class="card stack-12">
          <p class="muted text-xs uppercase" style="margin:0; letter-spacing: var(--letter-spacing-wide);">Chiusura del</p>
          <h2 class="font-display text-2xl" style="margin:0;">${escapeHtml(todayLabel)}</h2>
          <p class="muted text-sm" style="margin:0;">Chiusa da <strong>${escapeHtml(closedBy)}</strong> alle ${formatTime(c.created_at)}.</p>
          ${c.notes ? `<p class="text-sm" style="margin:0;"><em>${escapeHtml(c.notes)}</em></p>` : ''}
          ${canEdit
            ? `<button type="button" id="enable-edit" class="btn btn--secondary" style="align-self: flex-start;">${icon('edit', { size: 18 })}<span>Modifica</span></button>`
            : `<p class="muted text-xs" style="margin:0;">Solo admin o manager possono modificare la chiusura.</p>`}
        </div>

        <h3 class="font-display text-xl" style="margin: var(--space-24) 0 var(--space-12) 0;">Prodotti contati (${items.length})</h3>
        <div class="stack-8">
          ${items.map(rowReadOnly).join('')}
        </div>
      </section>
    `;
    const editBtn = container.querySelector('#enable-edit');
    if (editBtn) editBtn.addEventListener('click', () => {
      state.editMode = true;
      render();
    });
  }

  function rowReadOnly(it) {
    const saved = Number(it.qty_remaining_saved ?? 0);
    const actualNow = Number(it.qty_actual);
    const diffNow = actualNow - saved;
    const diffBadge = Math.abs(diffNow) > 0.001
      ? `<span class="badge badge--warn">Δ ${diffNow > 0 ? '+' : ''}${diffNow.toFixed(2)}</span>`
      : '';
    return `
      <div class="card">
        <div class="row" style="gap: var(--space-12);">
          <div class="flex-1" style="min-width: 0;">
            <p class="font-display text-base" style="margin:0;">${escapeHtml(it.product_name)}</p>
            ${it.category ? `<p class="muted text-xs uppercase" style="margin:0; letter-spacing: var(--letter-spacing-wide);">${escapeHtml(it.category)}</p>` : ''}
          </div>
          <div class="center-text">
            <div class="font-display text-lg" style="line-height:1;">${formatQty(saved)}</div>
            <div class="muted text-xs">${escapeHtml(it.product_unit)}</div>
          </div>
          ${diffBadge}
        </div>
      </div>
    `;
  }

  function renderEditable() {
    const items = filteredItems();
    const changedCount = items.reduce((n, it) => {
      const target = parseFloat(state.localQty[it.product_id] || '0');
      const start = Number(it.qty_remaining_saved ?? it.qty_actual);
      return Math.abs(target - start) > 0.001 ? n + 1 : n;
    }, 0);

    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-20); padding-bottom: 180px;">
        <div class="card">
          <p class="muted text-xs uppercase" style="margin:0; letter-spacing: var(--letter-spacing-wide);">Chiusura del</p>
          <p class="font-display text-xl" style="margin: var(--space-4) 0 0 0;">${escapeHtml(todayLabel)}</p>
          ${state.close
            ? `<p class="muted text-sm" style="margin: var(--space-8) 0 0 0;">Stai <strong>modificando</strong> una chiusura esistente — verranno generati movimenti correttivi.</p>`
            : `<p class="muted text-sm" style="margin: var(--space-8) 0 0 0;">Conta cosa è rimasto, salva. Il sistema crea automaticamente i movimenti di vendita.</p>`}
        </div>

        <div class="input-group" style="margin: var(--space-16) 0 var(--space-12) 0;">
          <span class="input-group__icon">${icon('search', { size: 18 })}</span>
          <input id="ec-search" class="input" type="search" placeholder="Cerca prodotto…" />
        </div>

        <div id="ec-chips" class="row" style="gap: var(--space-8); margin-bottom: var(--space-16); overflow-x: auto; flex-wrap: nowrap; padding-bottom: var(--space-4);">
          ${chipHtml(null, 'Tutte', state.category === null)}
          ${distinctCategories(state.items).map((cat) => chipHtml(cat, cat, state.category === cat)).join('')}
        </div>

        <div id="ec-list" class="stack-8">${items.length === 0
          ? '<p class="muted" style="padding: var(--space-16); text-align: center; background: var(--cream-soft); border-radius: var(--radius-md);">Nessun prodotto trovato con questi filtri.</p>'
          : items.map(rowEditable).join('')}</div>
      </section>

      <div style="position: fixed; left: 0; right: 0; bottom: calc(72px + env(safe-area-inset-bottom, 0px)); z-index: 9; padding: var(--space-12) var(--space-20); background: var(--off-white); border-top: 1px solid var(--border-soft); box-shadow: 0 -2px 12px rgba(120,30,20,0.06);">
        <div class="container" style="padding: 0;">
          <div class="row" style="gap: var(--space-12);">
            <span class="muted text-sm flex-1">${changedCount} ${changedCount === 1 ? 'modifica' : 'modifiche'} rispetto allo stato attuale</span>
            <button type="button" id="ec-save" class="btn btn--primary btn--lg">${icon('check', { size: 20 })}<span>Salva chiusura</span></button>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#ec-search').addEventListener('input', (e) => {
      state.search = e.target.value.trim().toLowerCase();
      const listEl = container.querySelector('#ec-list');
      if (listEl) {
        const filtered = filteredItems();
        listEl.innerHTML = filtered.length === 0
          ? '<p class="muted" style="padding: var(--space-16); text-align: center; background: var(--cream-soft); border-radius: var(--radius-md);">Nessun prodotto trovato con questi filtri.</p>'
          : filtered.map(rowEditable).join('');
      }
      wireRowInputs();
    });

    container.querySelectorAll('[data-chip]').forEach((b) => {
      b.addEventListener('click', () => {
        const v = b.dataset.chip;
        state.category = v === '__all__' ? null : v;
        render();
      });
    });

    container.querySelector('#ec-save').addEventListener('click', save);
    wireRowInputs();
  }

  function chipHtml(value, label, active) {
    return `<button type="button" data-chip="${value === null ? '__all__' : escapeAttr(value)}" class="pill ${active ? 'pill--success' : ''}" style="cursor:pointer; border:none; white-space:nowrap;">${escapeHtml(label)}</button>`;
  }

  function distinctCategories(items) {
    return [...new Set(items.map((it) => it.category).filter(Boolean))].sort();
  }

  function filteredItems() {
    return state.items.filter((it) => {
      if (state.category && it.category !== state.category) return false;
      if (state.search) {
        const q = state.search;
        const name = (it.product_name || '').toLowerCase();
        if (!name.includes(q)) return false;
      }
      return true;
    });
  }

  function rowEditable(it) {
    const local = state.localQty[it.product_id] ?? '';
    const start = Number(it.qty_remaining_saved ?? it.qty_actual);
    const target = parseFloat(local);
    const validDiff = !Number.isNaN(target);
    const diff = validDiff ? (start - target) : null;
    const diffBadge = validDiff && Math.abs(diff) > 0.001
      ? (diff > 0
          ? `<span class="badge badge--warn">hai venduto ${diff.toFixed(2)}</span>`
          : `<span class="badge badge--success">+${(-diff).toFixed(2)} trovato</span>`)
      : '';
    return `
      <div class="card" data-row="${it.product_id}">
        <div class="row" style="gap: var(--space-12);">
          <div class="flex-1" style="min-width: 0;">
            <p class="font-display text-base" style="margin:0;">${escapeHtml(it.product_name)}</p>
            <p class="muted text-xs" style="margin: var(--space-4) 0 0 0;">attuale: ${formatQty(it.qty_actual)} ${escapeHtml(it.product_unit)}</p>
          </div>
          <input class="input ec-input" data-pid="${it.product_id}"
                 type="number" inputmode="decimal" step="0.01" min="0"
                 value="${escapeAttr(local)}"
                 style="width: 96px; text-align: right; font-family: var(--font-display); font-size: var(--text-lg);" />
          <span class="muted text-xs" style="min-width: 32px;">${escapeHtml(it.product_unit)}</span>
        </div>
        ${diffBadge ? `<div style="margin-top: var(--space-8);">${diffBadge}</div>` : ''}
      </div>
    `;
  }

  function wireRowInputs() {
    container.querySelectorAll('.ec-input').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const pid = Number(e.target.dataset.pid);
        state.localQty[pid] = e.target.value;
        // Update only this row's diff badge + counter to avoid full re-render
        const card = e.target.closest('[data-row]');
        const it = state.items.find((x) => x.product_id === pid);
        if (card && it) {
          card.outerHTML = rowEditable(it);
          wireRowInputs();
        }
        updateChangedCounter();
      });
    });
  }

  function updateChangedCounter() {
    const counterEl = document.querySelector('#ec-save')?.parentElement?.querySelector('.muted.text-sm');
    if (!counterEl) return;
    const items = state.items;
    const changedCount = items.reduce((n, it) => {
      const target = parseFloat(state.localQty[it.product_id] || '0');
      const start = Number(it.qty_remaining_saved ?? it.qty_actual);
      return Math.abs(target - start) > 0.001 ? n + 1 : n;
    }, 0);
    counterEl.textContent = `${changedCount} ${changedCount === 1 ? 'modifica' : 'modifiche'} rispetto allo stato attuale`;
  }

  async function save() {
    const items = [];
    for (const it of state.items) {
      const raw = state.localQty[it.product_id];
      if (raw === '' || raw == null) continue;
      const value = parseFloat(raw);
      if (Number.isNaN(value) || value < 0) {
        showToast(`Quantità non valida per ${it.product_name}`, 'warn');
        return;
      }
      items.push({ product_id: it.product_id, qty_remaining: value.toFixed(2) });
    }
    if (items.length === 0) {
      showToast('Niente da salvare.', 'warn');
      return;
    }
    const changedCount = items.reduce((n, sent) => {
      const it = state.items.find((x) => x.product_id === sent.product_id);
      const start = Number(it.qty_remaining_saved ?? it.qty_actual);
      return Math.abs(parseFloat(sent.qty_remaining) - start) > 0.001 ? n + 1 : n;
    }, 0);

    const ok = await confirmDialog(
      'Confermi la chiusura?',
      `Stai per salvare la chiusura del ${todayLabel}. Saranno generati i movimenti automatici per ${changedCount} prodotti modificati.`,
      { confirmLabel: 'Conferma', cancelLabel: 'Annulla' },
    );
    if (!ok) return;

    const btn = container.querySelector('#ec-save');
    btn.disabled = true;
    const lbl = btn.querySelector('span');
    const orig = lbl.textContent;
    lbl.textContent = 'Salvataggio…';

    try {
      const body = { items };
      const result = state.close
        ? await apiPatch(`/evening-close/${state.close.id}`, body, { timeoutMs: 30000 })
        : await apiPost('/evening-close', body, { timeoutMs: 30000 });
      showToast(
        `Chiusura salvata. ${result.movements_created} movimenti generati.`,
        'success', 4000,
      );
      if (result.warnings && result.warnings.length > 0) {
        showModal('Attenzione', `<ul class="stack-8" style="padding-left: var(--space-20);">${result.warnings.map((w) => `<li class="text-sm">${escapeHtml(w)}</li>`).join('')}</ul>`, [
          { label: 'Ho capito', variant: 'primary' },
        ]);
      }
      navigate('/', { replace: true });
    } catch (err) {
      btn.disabled = false;
      lbl.textContent = orig;
      if (err instanceof ApiError && err.status === 409) {
        showToast('Chiusura di oggi già esistente. Ricarica la pagina.', 'warn', 5000);
      } else {
        showToast(err.message || 'Errore di salvataggio', 'danger', 6000);
      }
    }
  }
}

// -------------------- Helpers --------------------

function errorCard(msg) {
  return `<div class="container" style="padding-top: var(--space-20);">
    <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
      <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(msg)}</p></div></div></div>`;
}

function formatQty(qty) {
  const n = Number(qty);
  if (Number.isNaN(n)) return '—';
  return Number.isInteger(n) ? n.toString() : n.toFixed(2);
}

function formatNumForInput(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return '';
  return Number.isInteger(n) ? n.toString() : n.toFixed(2);
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
