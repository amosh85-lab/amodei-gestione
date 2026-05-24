// /segnala — fast stock-alert reporting for staff.
//
// 2 big buttons per product (Scarso / Finito). Optimistic UI: the card is
// marked "segnalato" immediately, POST goes in the background. On error
// the visual state rolls back and a toast appears.

import { apiGet, apiPost, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { icon } from '../../js/icons.js';
import { showToast, skeletonList } from '../../js/components.js';

export async function mountQuickSignal(container, _params, query = {}) {
  setHeader({
    title: 'Segnala scorte',
    brand: true,
    backHref: '/',
  });

  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(4)}</div>`;

  let products = [];
  let alertsByProduct = new Map();   // product_id → existing open alert (or undefined)
  try {
    const [prods, alertsResp] = await Promise.all([
      apiGet('/products?active=true'),
      apiGet('/alerts?status=open&limit=500').catch(() => []),  // staff might 403
    ]);
    products = prods;
    if (Array.isArray(alertsResp)) {
      for (const a of alertsResp) alertsByProduct.set(a.product_id, a);
    }
  } catch (err) {
    container.innerHTML = errorCard(err.message || 'Errore caricamento');
    return;
  }

  const state = {
    search: '',
    // local state of signaled products (product_id → 'low'|'out'). Optimistic.
    signaled: new Map(),
    // pending POSTs to avoid double-tap races
    pending: new Set(),
  };

  // seed signaled from existing alerts so already-flagged products show up flagged
  for (const a of alertsByProduct.values()) {
    state.signaled.set(a.product_id, a.status_signaled);
  }

  // Deep-link preselect: /segnala?product_id=42 pre-filters the list by that
  // product's name (sent here from /riordini-previsti). Falls back silently
  // if the id isn't in the active products list.
  const preselectId = parseInt(query.product_id, 10);
  if (preselectId) {
    const target = products.find((p) => p.id === preselectId);
    if (target) state.search = target.name.toLowerCase();
  }

  render();
  return () => {};

  // -----------------------------------------------------------------

  function render() {
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-16); padding-bottom: 96px;">
        <div class="input-group" style="margin-bottom: var(--space-16); position: sticky; top: 0; z-index: 2; background: var(--cream-soft); padding-block: var(--space-8);">
          <span class="input-group__icon">${icon('search', { size: 18 })}</span>
          <input id="qs-search" class="input" type="search" placeholder="Cerca prodotto…" autofocus />
        </div>
        <div id="qs-list"></div>
      </section>
    `;
    const inputEl = container.querySelector('#qs-search');
    inputEl.value = state.search;
    inputEl.addEventListener('input', (e) => {
      state.search = e.target.value.trim().toLowerCase();
      renderList();
    });
    renderList();
  }

  function renderList() {
    const listEl = container.querySelector('#qs-list');
    let list = products;
    if (state.search) {
      list = list.filter((p) => {
        const name = (p.name || '').toLowerCase();
        const code = (p.code || '').toLowerCase();
        return name.includes(state.search) || code.includes(state.search);
      });
    }
    // sort: not-signaled first, then signaled (so newly active products stay on top)
    list = [...list].sort((a, b) => {
      const sa = state.signaled.has(a.id) ? 1 : 0;
      const sb = state.signaled.has(b.id) ? 1 : 0;
      if (sa !== sb) return sa - sb;
      return a.name.localeCompare(b.name, 'it');
    });
    if (list.length === 0) {
      listEl.innerHTML = `<p class="muted center-text" style="margin-top: var(--space-24);">Nessun prodotto trovato.</p>`;
      return;
    }
    listEl.innerHTML = `<div class="stack-12">${list.map(card).join('')}</div>`;
    listEl.querySelectorAll('[data-signal]').forEach((b) => {
      b.addEventListener('click', () => signal(Number(b.dataset.pid), b.dataset.signal));
    });
  }

  function card(p) {
    const current = state.signaled.get(p.id);
    const isPending = state.pending.has(p.id);
    if (current) {
      const label = current === 'out' ? 'Finito' : 'Scarso';
      const cls = current === 'out' ? 'badge--danger' : 'badge--warn';
      return `
        <div class="card" style="opacity: 0.7;">
          <div class="row" style="gap: var(--space-12);">
            <div class="flex-1" style="min-width:0;">
              <p class="font-display text-lg" style="margin:0;">${escapeHtml(p.name)}</p>
              <p class="muted text-xs" style="margin: var(--space-4) 0 0 0;">${escapeHtml(p.category || '')}</p>
            </div>
            <span class="badge ${cls}" style="white-space:nowrap;">${icon('check', { size: 14 })}<span>Segnalato · ${label}</span></span>
          </div>
          <div class="row" style="gap: var(--space-12); margin-top: var(--space-12);">
            ${signalBtn(p.id, 'low',  'Aggiorna a scarso', 'btn--secondary', isPending, current === 'low')}
            ${signalBtn(p.id, 'out',  'Aggiorna a finito', 'btn--danger',    isPending, current === 'out')}
          </div>
        </div>`;
    }
    return `
      <div class="card" style="min-height: 56px;">
        <p class="font-display text-lg" style="margin:0;">${escapeHtml(p.name)}</p>
        <p class="muted text-xs" style="margin: var(--space-4) 0 var(--space-12) 0;">${escapeHtml(p.category || '')} · ${escapeHtml(p.unit)}</p>
        <div class="row" style="gap: var(--space-12);">
          ${signalBtn(p.id, 'low', '🟡 SCARSO', 'btn--lg', isPending)}
          ${signalBtn(p.id, 'out', '🔴 FINITO', 'btn--lg btn--danger', isPending)}
        </div>
      </div>`;
  }

  function signalBtn(pid, signal, label, extra = '', disabled = false, alreadyAtThisLevel = false) {
    const cls = `btn ${extra}`.trim() + (alreadyAtThisLevel ? ' btn--ghost' : '');
    return `<button type="button" data-signal="${signal}" data-pid="${pid}"
              class="${cls} flex-1" ${disabled || alreadyAtThisLevel ? 'disabled' : ''}
              style="min-height: 64px; font-size: var(--text-lg); font-weight: 600;">
        ${escapeHtml(label)}
      </button>`;
  }

  async function signal(productId, level) {
    if (state.pending.has(productId)) return;
    const prevSignaled = state.signaled.get(productId);
    // Optimistic
    state.pending.add(productId);
    state.signaled.set(productId, level);
    renderList();

    try {
      const created = await apiPost('/alerts', {
        product_id: productId,
        status_signaled: level,
      });
      // backend may have escalated (e.g. demote attempt → stays at higher level)
      state.signaled.set(productId, created.status_signaled);
      state.pending.delete(productId);
      renderList();
      showToast('Inviata all\'amministrazione', 'success', 2500);
    } catch (err) {
      // rollback
      state.pending.delete(productId);
      if (prevSignaled === undefined) state.signaled.delete(productId);
      else state.signaled.set(productId, prevSignaled);
      renderList();
      const msg = err instanceof ApiError && err.message ? err.message : 'Errore segnalazione';
      showToast(msg, 'danger', 4000);
    }
  }
}

function errorCard(msg) {
  return `<div class="alert alert--urgent">
    <span class="alert__icon">${icon('alert', { size: 22 })}</span>
    <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(msg)}</p></div></div>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
