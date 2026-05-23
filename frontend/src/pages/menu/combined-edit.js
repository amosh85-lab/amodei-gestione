// /menu/combined/new      — create flow
// /menu/combined/:id      — edit flow
//
// Form with name + sale_price + a dynamic list of components.
// Components are picked from the existing /products list. Each component
// row has a product picker (search) + qty + remove. A live preview shows
// cost (sum of qty × last_purchase_price) and margin % so the user can
// price the dish sensibly.

import { apiGet, apiPost, apiPatch, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { icon } from '../../js/icons.js';
import { showToast, confirmDialog } from '../../js/components.js';

export async function mountCombinedEdit(container, params) {
  const isNew = !params.id || params.id === 'new';
  const dishId = isNew ? null : Number(params.id);

  setHeader({
    title: isNew ? 'Nuovo combinato' : 'Modifica combinato',
    brand: true,
    backHref: '/menu?tab=combinati',
  });

  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
    <div class="card stack-12"><div class="skeleton skeleton--title"></div><div class="skeleton skeleton--line"></div><div class="skeleton skeleton--block"></div></div>
  </div>`;

  // Preload products (used by every component picker)
  let products = [];
  let existing = null;
  try {
    const [prodList, dish] = await Promise.all([
      apiGet('/products?active=true'),
      isNew ? Promise.resolve(null) : apiGet(`/menu/combined/${dishId}`),
    ]);
    products = prodList;
    existing = dish;
  } catch (err) {
    container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
      <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
        <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(err.message || '')}</p></div></div></div>`;
    return;
  }

  // Quick lookups
  const productsById = new Map(products.map((p) => [p.id, p]));

  // Form state
  const state = {
    name: existing?.name || '',
    sale_price: existing?.sale_price ?? '',
    components: existing
      ? existing.components.map((c) => ({ product_id: c.product_id, qty: String(c.qty) }))
      : [{ product_id: null, qty: '' }],
  };

  render();

  return () => {};

  // -----------------------------------------------------------------

  function render() {
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-20); padding-bottom: 120px;">
        <div class="card stack-16">
          <div class="form-row">
            <label class="label label--required" for="d-name">Nome piatto</label>
            <input id="d-name" class="input" required maxlength="200" value="${escapeAttr(state.name)}" placeholder="es. Saltimbocca + patate" />
          </div>
          <div class="form-row">
            <label class="label label--required" for="d-price">Prezzo di vendita (€)</label>
            <input id="d-price" class="input" type="number" min="0" step="0.01" required value="${escapeAttr(state.sale_price)}" />
          </div>
        </div>

        <h2 class="font-display text-xl" style="margin: var(--space-24) 0 var(--space-12) 0;">Componenti</h2>
        <div id="comp-list" class="stack-12">${state.components.map((c, i) => componentRow(c, i)).join('')}</div>
        <button type="button" id="add-comp" class="btn btn--secondary full-width" style="margin-top: var(--space-12);">
          ${icon('plus', { size: 18 })}<span>Aggiungi componente</span>
        </button>

        <div id="preview" class="card card--inset" style="margin-top: var(--space-20);">${previewHtml()}</div>

        <div class="row" style="gap: var(--space-12); margin-top: var(--space-24); justify-content: space-between;">
          ${!isNew ? `<button type="button" id="delete-btn" class="btn btn--danger">${icon('trash', { size: 18 })}<span>Disattiva</span></button>` : '<span></span>'}
          <button type="button" id="save-btn" class="btn btn--primary btn--lg">${icon('check', { size: 18 })}<span>${isNew ? 'Crea piatto' : 'Salva modifiche'}</span></button>
        </div>
      </section>
    `;

    wire();
  }

  function componentRow(c, idx) {
    const opts = products.map((p) =>
      `<option value="${p.id}" ${p.id === c.product_id ? 'selected' : ''}>${escapeHtml(p.name)} (${escapeHtml(p.unit)})</option>`
    ).join('');
    const unit = c.product_id ? (productsById.get(c.product_id)?.unit || '') : '';
    return `
      <div class="card" data-comp-row="${idx}">
        <div class="row" style="gap: var(--space-12); align-items: flex-end;">
          <div class="form-row flex-1" style="min-width: 0;">
            <label class="label" for="comp-prod-${idx}">Prodotto</label>
            <select id="comp-prod-${idx}" class="select" data-comp-prod="${idx}">
              <option value="">— scegli —</option>${opts}
            </select>
          </div>
          <div class="form-row" style="width: 110px; flex-shrink:0;">
            <label class="label" for="comp-qty-${idx}">Qty</label>
            <input id="comp-qty-${idx}" class="input" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeAttr(c.qty)}" data-comp-qty="${idx}" />
          </div>
          <span class="muted text-sm" style="min-width: 32px; padding-bottom: 12px;">${escapeHtml(unit)}</span>
          <button type="button" class="btn btn--ghost btn--icon" data-comp-remove="${idx}" aria-label="Rimuovi" ${state.components.length === 1 ? 'disabled' : ''} style="margin-bottom: 4px;">${icon('trash', { size: 18 })}</button>
        </div>
      </div>`;
  }

  function previewHtml() {
    const sale = Number(state.sale_price);
    let cost = 0;
    let costKnown = true;
    let hasComponents = false;
    for (const c of state.components) {
      if (!c.product_id || !Number(c.qty)) continue;
      hasComponents = true;
      const p = productsById.get(c.product_id);
      if (!p || p.last_purchase_price == null) { costKnown = false; continue; }
      cost += Number(p.last_purchase_price) * Number(c.qty);
    }
    if (!hasComponents) {
      return `<p class="muted text-sm" style="margin:0;">Aggiungi almeno un componente per vedere il margine.</p>`;
    }
    const costStr = costKnown ? `€ ${cost.toFixed(2)}` : '€ — <span class="muted text-xs">(qualche componente non ha ancora un prezzo di acquisto)</span>';
    const margin = costKnown && sale > 0 ? sale - cost : null;
    const marginPct = (margin != null && sale > 0) ? (margin / sale) * 100 : null;
    const marginColor = marginPct == null ? 'var(--ink-muted)' : (marginPct >= 30 ? 'var(--bottle-green)' : 'var(--terracotta-dark)');
    return `
      <div class="row" style="gap: var(--space-24); flex-wrap: wrap;">
        <div><p class="muted text-xs uppercase" style="margin:0; letter-spacing: var(--letter-spacing-wide);">Costo stimato</p><p class="font-display text-xl" style="margin: var(--space-4) 0 0 0;">${costStr}</p></div>
        <div><p class="muted text-xs uppercase" style="margin:0; letter-spacing: var(--letter-spacing-wide);">Prezzo di vendita</p><p class="font-display text-xl" style="margin: var(--space-4) 0 0 0;">€ ${sale ? sale.toFixed(2) : '—'}</p></div>
        <div><p class="muted text-xs uppercase" style="margin:0; letter-spacing: var(--letter-spacing-wide);">Margine</p><p class="font-display text-xl" style="margin: var(--space-4) 0 0 0; color: ${marginColor};">${marginPct == null ? '—' : `${marginPct.toFixed(0)}%`}</p></div>
      </div>`;
  }

  function wire() {
    container.querySelector('#d-name').addEventListener('input', (e) => {
      state.name = e.target.value;
    });
    container.querySelector('#d-price').addEventListener('input', (e) => {
      state.sale_price = e.target.value;
      refreshPreview();
    });
    container.querySelectorAll('[data-comp-prod]').forEach((sel) => {
      sel.addEventListener('change', (e) => {
        const i = Number(e.target.dataset.compProd);
        state.components[i].product_id = e.target.value ? Number(e.target.value) : null;
        render(); // re-render to update the unit label and preview
      });
    });
    container.querySelectorAll('[data-comp-qty]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const i = Number(e.target.dataset.compQty);
        state.components[i].qty = e.target.value;
        refreshPreview();
      });
    });
    container.querySelectorAll('[data-comp-remove]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const i = Number(e.target.closest('[data-comp-remove]').dataset.compRemove);
        if (state.components.length === 1) return;
        state.components.splice(i, 1);
        render();
      });
    });
    container.querySelector('#add-comp').addEventListener('click', () => {
      state.components.push({ product_id: null, qty: '' });
      render();
    });
    container.querySelector('#save-btn').addEventListener('click', submit);
    const deleteBtn = container.querySelector('#delete-btn');
    if (deleteBtn) deleteBtn.addEventListener('click', remove);
  }

  function refreshPreview() {
    const previewEl = container.querySelector('#preview');
    if (previewEl) previewEl.innerHTML = previewHtml();
  }

  async function submit() {
    // Validation
    const name = state.name.trim();
    const sale = Number(state.sale_price);
    if (!name) return showToast('Il nome è obbligatorio.', 'warn');
    if (!(sale >= 0)) return showToast('Il prezzo di vendita deve essere ≥ 0.', 'warn');
    const validComps = state.components.filter((c) => c.product_id && Number(c.qty) > 0);
    if (validComps.length === 0) return showToast('Aggiungi almeno un componente con quantità > 0.', 'warn');

    const payload = {
      name,
      sale_price: sale,
      components: validComps.map((c) => ({ product_id: c.product_id, qty: Number(c.qty) })),
    };

    const btn = container.querySelector('#save-btn');
    btn.disabled = true;
    const labelSpan = btn.querySelector('span');
    const orig = labelSpan.textContent;
    labelSpan.textContent = 'Salvataggio…';

    try {
      const dish = isNew
        ? await apiPost('/menu/combined', payload)
        : await apiPatch(`/menu/combined/${dishId}`, payload);
      showToast(isNew ? 'Piatto creato' : 'Modifiche salvate', 'success');
      navigate('/menu?tab=combinati');
    } catch (err) {
      showToast(err.message || 'Errore salvataggio', 'danger', 5000);
      btn.disabled = false;
      labelSpan.textContent = orig;
    }
  }

  async function remove() {
    if (isNew) return;
    const ok = await confirmDialog(
      `Disattivare "${existing.name}"?`,
      'Il piatto non sarà più visibile nel menu. I dati restano nello storico.',
      { confirmLabel: 'Disattiva', cancelLabel: 'Annulla', danger: true },
    );
    if (!ok) return;
    try {
      const { apiDelete } = await import('../../js/api.js');
      await apiDelete(`/menu/combined/${dishId}`);
      showToast('Piatto disattivato', 'success');
      navigate('/menu?tab=combinati');
    } catch (err) {
      showToast(err.message || 'Errore disattivazione', 'danger', 5000);
    }
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
