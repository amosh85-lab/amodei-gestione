// /magazzino/carico — multi-step form to register a new batch.

import { apiGet, apiPost, apiUpload, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { icon } from '../../js/icons.js';
import { showToast, showModal, skeletonList, parseNumberInput } from '../../js/components.js';

const STEPS = [
  { id: 1, title: 'Prodotto' },
  { id: 2, title: 'Fornitore' },
  { id: 3, title: 'Quantità e prezzo' },
  { id: 4, title: 'Scadenza' },
  { id: 5, title: 'Foto e note' },
  { id: 6, title: 'Riepilogo' },
];

export async function mountInventoryLoad(container, _params, query) {
  setHeader({
    title: 'Carica lotto',
    brand: true,
    backHref: '/magazzino',
  });

  // Form state (mutated as the user progresses)
  const state = {
    step: 1,
    product: null,             // { id, name, unit, ... }
    supplier: null,            // { id, name }
    initial_qty: '',
    list_price_unit: '',       // listino pre-sconto (opzionale)
    discount_pct: '',          // sconto % (opzionale, es. 15)
    purchase_price_unit: '',   // netto unitario (obbligatorio, può essere auto-calcolato)
    expiry_date: '',
    notes: '',
    photo_file: null,          // File or null
    photo_preview_url: null,   // ObjectURL (revoked on cleanup)
  };

  // Show skeleton while we preload products + suppliers (small lists for a wine bar)
  container.innerHTML = `<div class="container" style="padding-top: var(--space-24);">${skeletonList(3)}</div>`;
  let products = [];
  let suppliers = [];
  try {
    [products, suppliers] = await Promise.all([
      apiGet('/products?active=true'),
      apiGet('/suppliers'),
    ]);
  } catch (err) {
    showToast(err.message || 'Errore nel caricamento dati', 'danger', 5000);
    container.innerHTML = `<div class="container" style="padding-top: var(--space-24);">
      <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
        <div class="alert__body"><strong>Impossibile caricare</strong>
          <p class="alert__text">${escapeHtml(err.message || '')}</p></div></div>
    </div>`;
    return;
  }

  // Pre-select product if /magazzino/carico?product_id=N
  if (query.product_id) {
    state.product = products.find((p) => String(p.id) === String(query.product_id)) || null;
  }

  render();

  return () => {
    if (state.photo_preview_url) URL.revokeObjectURL(state.photo_preview_url);
  };

  // -----------------------------------------------------------------

  function render() {
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-20); padding-bottom: 120px;">
        ${stepIndicator(state.step)}
        <div id="step-body" class="card stack-16" style="margin-top: var(--space-16);">
          ${stepBody(state.step)}
        </div>
        <div class="row" style="margin-top: var(--space-20); justify-content: space-between; gap: var(--space-12);">
          <button type="button" id="back-btn" class="btn btn--ghost" ${state.step === 1 ? 'disabled' : ''}>${icon('chevron-left', { size: 18 })}<span>Indietro</span></button>
          ${state.step < 6
            ? `<button type="button" id="next-btn" class="btn btn--primary">${icon('chevron-right', { size: 18 })}<span>Avanti</span></button>`
            : `<button type="button" id="confirm-btn" class="btn btn--primary">${icon('check', { size: 18 })}<span>Conferma carico</span></button>`}
        </div>
      </section>
    `;
    wireStep(state.step);
    container.querySelector('#back-btn').addEventListener('click', () => {
      if (state.step > 1) { state.step -= 1; render(); }
    });
    const nextBtn = container.querySelector('#next-btn');
    if (nextBtn) nextBtn.addEventListener('click', () => {
      if (!validateStep(state.step)) return;
      state.step += 1;
      render();
    });
    const confirmBtn = container.querySelector('#confirm-btn');
    if (confirmBtn) confirmBtn.addEventListener('click', submit);
  }

  function stepIndicator(currentStep) {
    return `
      <div class="row" style="gap: 4px;">
        ${STEPS.slice(0, 5).map((s) => `
          <div style="flex:1; height: 4px; border-radius: 2px; background: ${s.id <= currentStep ? 'var(--terracotta)' : 'var(--border-soft)'};"></div>
        `).join('')}
      </div>
      <p class="muted text-xs uppercase" style="margin-top: var(--space-12); letter-spacing: var(--letter-spacing-wide);">
        Passo ${Math.min(currentStep, 5)} / 5 · ${escapeHtml(STEPS[currentStep - 1].title)}
      </p>
    `;
  }

  function stepBody(s) {
    if (s === 1) return stepProductHtml();
    if (s === 2) return stepSupplierHtml();
    if (s === 3) return stepQtyHtml();
    if (s === 4) return stepExpiryHtml();
    if (s === 5) return stepPhotoHtml();
    if (s === 6) return stepRecapHtml();
    return '';
  }

  function wireStep(s) {
    if (s === 1) wireProduct();
    if (s === 2) wireSupplier();
    if (s === 3) wireQty();
    if (s === 4) wireExpiry();
    if (s === 5) wirePhoto();
  }

  function validateStep(s) {
    if (s === 1) {
      if (!state.product) { showToast('Seleziona o crea un prodotto.', 'warn'); return false; }
      return true;
    }
    if (s === 3) {
      const q = Number(state.initial_qty);
      const p = Number(state.purchase_price_unit);
      if (!(q > 0)) { showToast('Inserisci una quantità maggiore di 0.', 'warn'); return false; }
      if (!(p >= 0)) { showToast('Il prezzo deve essere ≥ 0.', 'warn'); return false; }
      return true;
    }
    return true;
  }

  // ------------------ Step 1: Product ------------------
  function stepProductHtml() {
    const selected = state.product;
    return `
      <h3 class="card__title" style="margin:0;">Quale prodotto stai caricando?</h3>
      ${selected ? `
        <div class="card card--inset row" style="gap: var(--space-12);">
          <div class="flex-1">
            <p class="font-display text-lg" style="margin:0;">${escapeHtml(selected.name)}</p>
            <p class="muted text-xs">${escapeHtml(selected.category || '—')} · unità: ${escapeHtml(selected.unit)}</p>
          </div>
          <button type="button" id="clear-product" class="btn btn--ghost btn--sm">Cambia</button>
        </div>
      ` : `
        <div class="input-group">
          <span class="input-group__icon">${icon('search', { size: 18 })}</span>
          <input id="product-search" class="input" placeholder="Cerca prodotto…" autofocus />
        </div>
        <div id="product-list" class="stack-8" style="max-height: 40vh; overflow-y: auto;"></div>
        <button type="button" id="new-product-btn" class="btn btn--secondary full-width">${icon('plus', { size: 18 })}<span>Nuovo prodotto</span></button>
      `}
    `;
  }

  function wireProduct() {
    const clearBtn = container.querySelector('#clear-product');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => { state.product = null; render(); });
      return;
    }
    const searchEl = container.querySelector('#product-search');
    const listEl = container.querySelector('#product-list');
    const renderList = (q = '') => {
      const filtered = products.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        (p.code || '').toLowerCase().includes(q)
      ).slice(0, 20);
      if (filtered.length === 0) {
        listEl.innerHTML = `<p class="muted text-sm">Nessun prodotto trovato${q ? ` per "${escapeHtml(q)}"` : ''}.</p>`;
        return;
      }
      listEl.innerHTML = filtered.map((p) => `
        <button type="button" data-pid="${p.id}" class="card" style="width:100%; text-align:left; cursor:pointer; border: 1px solid var(--border-soft); padding: var(--space-12) var(--space-16);">
          <p style="margin:0; font-weight:500;">${escapeHtml(p.name)}</p>
          <p class="muted text-xs" style="margin:0;">${escapeHtml(p.category || '—')} · ${escapeHtml(p.unit)}</p>
        </button>
      `).join('');
      listEl.querySelectorAll('[data-pid]').forEach((b) => {
        b.addEventListener('click', () => {
          const id = Number(b.dataset.pid);
          state.product = products.find((p) => p.id === id);
          state.step = 2;
          render();
        });
      });
    };
    renderList();
    searchEl.addEventListener('input', () => renderList(searchEl.value.trim().toLowerCase()));
    container.querySelector('#new-product-btn').addEventListener('click', openNewProductModal);
  }

  function openNewProductModal() {
    const body = `
      <form id="new-product-form" class="stack-12">
        <div class="form-row"><label class="label label--required" for="np-name">Nome</label><input id="np-name" class="input" required maxlength="200"></div>
        <div class="grid-2">
          <div class="form-row"><label class="label" for="np-cat">Categoria</label><input id="np-cat" class="input" maxlength="80"></div>
          <div class="form-row"><label class="label label--required" for="np-unit">Unità</label><input id="np-unit" class="input" list="unit-list" required maxlength="32" placeholder="es. kg, bottiglia, cassa"></div>
        </div>
        <div class="form-row"><label class="label" for="np-vat">IVA</label>
          <select id="np-vat" class="select">
            <option value="iva_4">4%</option><option value="iva_5">5%</option>
            <option value="iva_10">10%</option><option value="iva_22" selected>22%</option>
          </select>
        </div>
        <datalist id="unit-list">
          ${['pz','kg','g','lt','cl','ml','bottiglia','cassa','confezione','scatola','tanica','fusto','barattolo','vaschetta','mazzo','metro'].map((u) => `<option value="${u}">`).join('')}
        </datalist>
      </form>`;
    showModal('Nuovo prodotto', body, [
      { label: 'Annulla', variant: 'ghost' },
      { label: 'Crea', variant: 'primary', closeOnClick: false, onClick: async (close) => {
        const name = document.getElementById('np-name').value.trim();
        const unit = document.getElementById('np-unit').value.trim();
        if (!name || !unit) { showToast('Nome e unità sono obbligatori.', 'warn'); return; }
        try {
          const created = await apiPost('/products', {
            name, unit,
            category: document.getElementById('np-cat').value.trim() || null,
            vat_rate: document.getElementById('np-vat').value,
          });
          products.unshift(created);
          state.product = created;
          state.step = 2;
          showToast('Prodotto creato', 'success');
          close();
          render();
        } catch (err) {
          showToast(err.message || 'Errore creazione', 'danger', 5000);
        }
      } },
    ]);
  }

  // ------------------ Step 2: Supplier ------------------
  function stepSupplierHtml() {
    if (state.supplier) {
      return `
        <h3 class="card__title" style="margin:0;">Da quale fornitore?</h3>
        <div class="card card--inset row" style="gap: var(--space-12);">
          <div class="flex-1">
            <p class="font-display text-lg" style="margin:0;">${escapeHtml(state.supplier.name)}</p>
          </div>
          <button type="button" id="clear-supplier" class="btn btn--ghost btn--sm">Cambia</button>
        </div>
        <button type="button" id="skip-supplier" class="btn btn--ghost full-width">Senza fornitore</button>
      `;
    }
    return `
      <h3 class="card__title" style="margin:0;">Da quale fornitore? <span class="muted text-sm" style="font-family: var(--font-body); font-weight:400;">(facoltativo)</span></h3>
      <div class="input-group">
        <span class="input-group__icon">${icon('search', { size: 18 })}</span>
        <input id="supplier-search" class="input" placeholder="Cerca fornitore…" autofocus />
      </div>
      <div id="supplier-list" class="stack-8" style="max-height: 40vh; overflow-y: auto;"></div>
      <div class="row" style="gap: var(--space-12);">
        <button type="button" id="new-supplier-btn" class="btn btn--secondary flex-1">${icon('plus', { size: 18 })}<span>Nuovo</span></button>
        <button type="button" id="skip-supplier" class="btn btn--ghost flex-1">Salta</button>
      </div>
    `;
  }

  function wireSupplier() {
    const skipBtn = container.querySelector('#skip-supplier');
    if (skipBtn) skipBtn.addEventListener('click', () => { state.supplier = null; state.step = 3; render(); });

    const clearBtn = container.querySelector('#clear-supplier');
    if (clearBtn) { clearBtn.addEventListener('click', () => { state.supplier = null; render(); }); return; }

    const searchEl = container.querySelector('#supplier-search');
    const listEl = container.querySelector('#supplier-list');
    const renderList = (q = '') => {
      const filtered = suppliers.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 20);
      if (filtered.length === 0) {
        listEl.innerHTML = `<p class="muted text-sm">Nessun fornitore trovato.</p>`;
        return;
      }
      listEl.innerHTML = filtered.map((s) => `
        <button type="button" data-sid="${s.id}" class="card" style="width:100%; text-align:left; cursor:pointer; padding: var(--space-12) var(--space-16);">
          <p style="margin:0; font-weight:500;">${escapeHtml(s.name)}</p>
          ${s.contact_name ? `<p class="muted text-xs" style="margin:0;">${escapeHtml(s.contact_name)}</p>` : ''}
        </button>
      `).join('');
      listEl.querySelectorAll('[data-sid]').forEach((b) => {
        b.addEventListener('click', () => {
          const id = Number(b.dataset.sid);
          state.supplier = suppliers.find((s) => s.id === id);
          state.step = 3;
          render();
        });
      });
    };
    renderList();
    searchEl.addEventListener('input', () => renderList(searchEl.value.trim().toLowerCase()));
    container.querySelector('#new-supplier-btn').addEventListener('click', openNewSupplierModal);
  }

  function openNewSupplierModal() {
    const body = `
      <form id="new-supp-form" class="stack-12">
        <div class="form-row"><label class="label label--required" for="ns-name">Nome</label><input id="ns-name" class="input" required maxlength="160"></div>
        <div class="form-row"><label class="label" for="ns-contact">Contatto</label><input id="ns-contact" class="input" maxlength="160"></div>
        <div class="grid-2">
          <div class="form-row"><label class="label" for="ns-phone">Telefono</label><input id="ns-phone" class="input" maxlength="40"></div>
          <div class="form-row"><label class="label" for="ns-wa">WhatsApp (+39…)</label><input id="ns-wa" class="input" maxlength="40" placeholder="+393331112233"></div>
        </div>
      </form>`;
    showModal('Nuovo fornitore', body, [
      { label: 'Annulla', variant: 'ghost' },
      { label: 'Crea', variant: 'primary', closeOnClick: false, onClick: async (close) => {
        const name = document.getElementById('ns-name').value.trim();
        if (!name) { showToast('Il nome è obbligatorio.', 'warn'); return; }
        try {
          const created = await apiPost('/suppliers', {
            name,
            contact_name: document.getElementById('ns-contact').value.trim() || null,
            phone: document.getElementById('ns-phone').value.trim() || null,
            whatsapp: document.getElementById('ns-wa').value.trim() || null,
          });
          suppliers.unshift(created);
          state.supplier = created;
          state.step = 3;
          showToast('Fornitore creato', 'success');
          close();
          render();
        } catch (err) {
          showToast(err.message || 'Errore creazione', 'danger', 5000);
        }
      } },
    ]);
  }

  // ------------------ Step 3: Qty + price (con sconto) ------------------
  function stepQtyHtml() {
    const unit = state.product?.unit || '';
    return `
      <h3 class="card__title" style="margin:0;">Quantità e prezzo d'acquisto</h3>
      <p class="muted text-sm">Inserisci quantità, prezzo di listino e sconto (se previsto). Il prezzo netto si calcola automaticamente. IVA esclusa.</p>
      <div class="form-row">
        <label class="label label--required" for="qty-input">Quantità (${escapeHtml(unit)})</label>
        <input id="qty-input" class="input" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeAttr(state.initial_qty)}" required />
      </div>
      <div class="grid-2">
        <div class="form-row">
          <label class="label" for="list-price-input">Prezzo listino €/${escapeHtml(unit)} <span class="muted text-xs">(opz.)</span></label>
          <input id="list-price-input" class="input" type="number" min="0" step="0.0001" inputmode="decimal" value="${escapeAttr(state.list_price_unit)}" />
        </div>
        <div class="form-row">
          <label class="label" for="discount-input">Sconto % <span class="muted text-xs">(opz.)</span></label>
          <input id="discount-input" class="input" type="number" min="0" max="100" step="0.01" inputmode="decimal" value="${escapeAttr(state.discount_pct)}" />
        </div>
      </div>
      <div class="form-row">
        <label class="label label--required" for="price-input">Prezzo NETTO unitario €/${escapeHtml(unit)}</label>
        <input id="price-input" class="input" type="number" min="0" step="0.0001" inputmode="decimal" value="${escapeAttr(state.purchase_price_unit)}" required />
        <p class="muted text-xs" id="price-hint" style="margin: var(--space-4) 0 0 0;"></p>
      </div>
    `;
  }

  function wireQty() {
    const qtyEl = container.querySelector('#qty-input');
    const listEl = container.querySelector('#list-price-input');
    const discEl = container.querySelector('#discount-input');
    const priceEl = container.querySelector('#price-input');
    const hintEl  = container.querySelector('#price-hint');

    qtyEl.addEventListener('input', () => { state.initial_qty = qtyEl.value; });

    function recomputeNet({ fromUser }) {
      const list = parseNumberInput(state.list_price_unit);
      const disc = parseNumberInput(state.discount_pct);
      if (Number.isFinite(list) && list > 0 && Number.isFinite(disc) && disc >= 0 && disc <= 100) {
        const net = list * (1 - disc / 100);
        state.purchase_price_unit = net.toFixed(4);
        priceEl.value = state.purchase_price_unit;
        hintEl.textContent = `= € ${list.toFixed(4)} × (1 − ${disc.toFixed(2)}%) = € ${net.toFixed(4)}`;
      } else if (!fromUser) {
        hintEl.textContent = '';
      }
    }

    listEl.addEventListener('input', () => { state.list_price_unit = listEl.value; recomputeNet({ fromUser: false }); });
    discEl.addEventListener('input', () => { state.discount_pct = discEl.value; recomputeNet({ fromUser: false }); });
    priceEl.addEventListener('input', () => {
      state.purchase_price_unit = priceEl.value;
      hintEl.textContent = '';
    });
    recomputeNet({ fromUser: false });
    qtyEl.focus();
  }

  // ------------------ Step 4: Expiry ------------------
  function stepExpiryHtml() {
    return `
      <h3 class="card__title" style="margin:0;">Scadenza <span class="muted text-sm" style="font-family: var(--font-body); font-weight:400;">(facoltativa)</span></h3>
      <p class="muted text-sm">Lascia vuoto per prodotti senza data di scadenza.</p>
      <div class="form-row">
        <label class="label" for="exp-input">Data di scadenza</label>
        <input id="exp-input" class="input" type="date" value="${escapeAttr(state.expiry_date)}" />
      </div>
    `;
  }

  function wireExpiry() {
    const el = container.querySelector('#exp-input');
    el.addEventListener('change', () => { state.expiry_date = el.value; });
  }

  // ------------------ Step 5: Photo + notes ------------------
  function stepPhotoHtml() {
    const preview = state.photo_preview_url
      ? `<div class="row" style="gap: var(--space-12);"><img src="${escapeAttr(state.photo_preview_url)}" alt="anteprima" style="width: 96px; height: 96px; object-fit: cover; border-radius: var(--radius-md); border: 1px solid var(--border-soft);"><button type="button" id="remove-photo" class="btn btn--ghost btn--sm">Rimuovi</button></div>`
      : '';
    return `
      <h3 class="card__title" style="margin:0;">Foto scontrino e note <span class="muted text-sm" style="font-family: var(--font-body); font-weight:400;">(facoltativo)</span></h3>
      <div class="form-row">
        <label class="label" for="photo-input">Foto dello scontrino</label>
        <input id="photo-input" class="input" type="file" accept="image/*" capture="environment" />
        ${preview}
      </div>
      <div class="form-row">
        <label class="label" for="notes-input">Note</label>
        <textarea id="notes-input" class="textarea" placeholder="Note libere sul carico…">${escapeHtml(state.notes)}</textarea>
      </div>
    `;
  }

  function wirePhoto() {
    const fileEl = container.querySelector('#photo-input');
    const notesEl = container.querySelector('#notes-input');
    fileEl.addEventListener('change', () => {
      const file = fileEl.files[0];
      if (state.photo_preview_url) URL.revokeObjectURL(state.photo_preview_url);
      if (!file) {
        state.photo_file = null;
        state.photo_preview_url = null;
        render();
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        showToast('Foto troppo grande (max 5 MB).', 'warn');
        fileEl.value = '';
        return;
      }
      state.photo_file = file;
      state.photo_preview_url = URL.createObjectURL(file);
      render();
    });
    notesEl.addEventListener('input', () => { state.notes = notesEl.value; });
    const removeBtn = container.querySelector('#remove-photo');
    if (removeBtn) removeBtn.addEventListener('click', () => {
      if (state.photo_preview_url) URL.revokeObjectURL(state.photo_preview_url);
      state.photo_file = null;
      state.photo_preview_url = null;
      fileEl.value = '';
      render();
    });
  }

  // ------------------ Step 6: Recap ------------------
  function stepRecapHtml() {
    const unit = state.product?.unit || '';
    return `
      <h3 class="card__title" style="margin:0;">Riepilogo</h3>
      <div class="stack-12">
        ${recapRow('Prodotto', state.product?.name || '—')}
        ${recapRow('Fornitore', state.supplier?.name || '—')}
        ${recapRow('Quantità', `${state.initial_qty || '—'} ${unit}`)}
        ${state.list_price_unit ? recapRow('Listino', `€ ${state.list_price_unit}`) : ''}
        ${state.discount_pct ? recapRow('Sconto', `${state.discount_pct}%`) : ''}
        ${recapRow('Prezzo netto unitario', state.purchase_price_unit ? `€ ${state.purchase_price_unit}` : '—')}
        ${recapRow('Scadenza', state.expiry_date || 'nessuna')}
        ${recapRow('Foto', state.photo_file ? 'allegata' : 'nessuna')}
        ${state.notes ? recapRow('Note', state.notes) : ''}
      </div>
    `;
  }

  function recapRow(label, value) {
    return `<div class="row" style="gap: var(--space-12); padding: var(--space-8) 0; border-top: 1px solid var(--border-soft);">
      <span class="muted text-xs uppercase" style="min-width: 120px; letter-spacing: var(--letter-spacing-wide);">${escapeHtml(label)}</span>
      <span class="flex-1 text-sm">${escapeHtml(value)}</span>
    </div>`;
  }

  async function submit() {
    const btn = container.querySelector('#confirm-btn');
    btn.disabled = true;
    btn.innerHTML = `<span>Caricamento…</span>`;

    const fd = new FormData();
    fd.append('product_id', String(state.product.id));
    fd.append('initial_qty', String(state.initial_qty));
    fd.append('purchase_price_unit', String(state.purchase_price_unit));
    if (state.list_price_unit !== '' && state.list_price_unit != null) {
      fd.append('list_price_unit', String(state.list_price_unit));
    }
    if (state.discount_pct !== '' && state.discount_pct != null) {
      fd.append('discount_pct', String(state.discount_pct));
    }
    if (state.supplier) fd.append('supplier_id', String(state.supplier.id));
    fd.append('load_date', new Date().toISOString().slice(0, 10));
    if (state.expiry_date) fd.append('expiry_date', state.expiry_date);
    if (state.notes) fd.append('notes', state.notes);
    if (state.photo_file) fd.append('receipt_photo', state.photo_file, state.photo_file.name);

    try {
      const batch = await apiUpload('/batches', fd, { timeoutMs: 30000 });
      showToast('Lotto caricato', 'success', 3000);
      navigate(`/magazzino/${state.product.id}`);
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = `${icon('check', { size: 18 })}<span>Conferma carico</span>`;
      showToast(err.message || 'Errore nel caricamento', 'danger', 6000);
    }
  }
}

// -------------------- Helpers --------------------

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
