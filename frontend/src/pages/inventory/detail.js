// /magazzino/:id — product detail with batches and recent movements.

import { apiGet, apiPatch, apiDelete, apiPost, absoluteUrl, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { userHasRole } from '../../js/auth.js';
import { icon } from '../../js/icons.js';
import { showToast, showModal, confirmDialog } from '../../js/components.js';

const EXPIRY_BUCKETS = [
  { maxDays: 1,  cls: 'badge--danger', label: (d) => d <= 0 ? 'Scaduto' : 'Scade oggi' },
  { maxDays: 2,  cls: 'badge--danger', label: () => 'Scade in 1g' },
  { maxDays: 5,  cls: 'badge--warn',   label: (d) => `Scade tra ${d}g` },
  { maxDays: 10, cls: 'badge--warn',   label: (d) => `Scade tra ${d}g` },
];

export async function mountInventoryDetail(container, params) {
  const productId = params.id;
  const canEdit = userHasRole('admin', 'manager');

  setHeader({
    title: 'Caricamento…',
    brand: true,
    backHref: '/magazzino',
  });

  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
    <div class="card stack-12"><div class="skeleton skeleton--title"></div><div class="skeleton skeleton--line"></div><div class="skeleton skeleton--block"></div></div>
  </div>`;

  let product;
  try {
    product = await apiGet(`/products/${productId}`);
  } catch (err) {
    container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
      <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
        <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(err.message || 'Prodotto non disponibile.')}</p></div>
      </div></div>`;
    return;
  }

  setHeader({
    title: product.name,
    brand: true,
    backHref: '/magazzino',
    actions: canEdit ? [{
      label: 'Azioni',
      iconName: 'more-vertical',
      onClick: () => openActionsMenu(product),
    }] : [],
  });

  const movementsSlot = `<section class="container" style="padding-block: var(--space-16); padding-bottom: 96px;"><div id="movements-area"></div></section>`;

  container.innerHTML = `
    ${renderMetrics(product)}
    ${renderLotti(product)}
    ${canEdit ? movementsSlot : ''}
    ${renderFab(product)}
  `;

  // Wire batch row clicks (rettifica menu)
  if (canEdit) {
    container.querySelectorAll('[data-batch-menu]').forEach((b) => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = Number(b.dataset.batchMenu);
        const batch = product.batches.find((x) => x.id === id);
        if (batch) openBatchMenu(product, batch);
      });
    });
  }

  // Wire photo thumbnails (lightbox)
  container.querySelectorAll('[data-photo]').forEach((img) => {
    img.addEventListener('click', () => openLightbox(img.dataset.photo));
  });

  container.querySelector('#fab-load')?.addEventListener('click', () => {
    navigate(`/magazzino/carico?product_id=${productId}`);
  });

  // Movements (admin/manager only)
  if (canEdit) {
    loadMovements(productId).then((items) => {
      const area = container.querySelector('#movements-area');
      if (!area) return;
      area.innerHTML = renderMovements(items);
    });
  }

  return () => {};

  // -----------------------------------------------------------------

  async function loadMovements(pid) {
    try {
      return await apiGet(`/movements?product_id=${pid}&limit=10`);
    } catch (err) {
      return { __error: err.message || 'Errore caricamento movimenti' };
    }
  }

  function renderMetrics(p) {
    const margin = computeMargin(p.sale_price, p.last_purchase_price);
    const next = formatNextExpiry(p.next_expiry_date);
    return `
      <section class="container" style="padding-block: var(--space-20);">
        <div class="grid-2" style="gap: var(--space-12);">
          ${metricCard('Scorta totale', formatQty(p.qty_total, p.unit), p.qty_total > 0 ? 'ink' : 'ink-muted')}
          ${metricCard('Prezzo vendita', p.sale_price != null ? `€ ${formatPrice(p.sale_price, 2)}` : '—', 'ink')}
          ${metricCard('Margine', margin != null ? `${margin.toFixed(0)}%` : '—', margin == null || margin > 30 ? 'bottle-green' : 'amber')}
          ${metricCard('Prossima scad.', next.label, next.color)}
        </div>
        ${p.category ? `<p class="muted text-xs uppercase" style="margin-top: var(--space-12); letter-spacing: var(--letter-spacing-wide);">${escapeHtml(p.category)} · IVA ${escapeHtml(p.vat_rate || '').replace('iva_', '')}%</p>` : ''}
      </section>
    `;
  }

  function metricCard(label, value, accent = 'ink') {
    const colorMap = {
      ink: 'var(--ink)',
      'ink-muted': 'var(--ink-muted)',
      'bottle-green': 'var(--bottle-green)',
      amber: '#8B6A2E',
      terracotta: 'var(--terracotta-dark)',
    };
    return `
      <div class="card" style="padding: var(--space-12) var(--space-16);">
        <p class="muted text-xs uppercase" style="margin:0; letter-spacing: var(--letter-spacing-wide);">${escapeHtml(label)}</p>
        <p class="font-display text-xl" style="margin: var(--space-4) 0 0 0; color: ${colorMap[accent] || colorMap.ink};">${value}</p>
      </div>
    `;
  }

  function renderLotti(p) {
    if (!p.batches || p.batches.length === 0) {
      return `
        <section class="container" style="padding-block: var(--space-16);">
          <h2 class="font-display text-xl" style="margin: 0 0 var(--space-12) 0;">Lotti</h2>
          <div class="card center-text" style="padding: var(--space-24);">
            <div style="color: var(--ink-soft); margin-bottom: var(--space-12);">${icon('inventory', { size: 40 })}</div>
            <p class="muted">Nessun lotto in magazzino. Caricane uno con il pulsante in basso.</p>
          </div>
        </section>`;
    }
    return `
      <section class="container" style="padding-block: var(--space-16);">
        <h2 class="font-display text-xl" style="margin: 0 0 var(--space-12) 0;">Lotti (${p.batches.length})</h2>
        <div class="stack-12">${p.batches.map((b) => batchCard(p, b)).join('')}</div>
      </section>`;
  }

  function batchCard(p, b) {
    const expiry = expiryBadgeHtml(b.expiry_date) || (b.expiry_date ? `<span class="badge">Scade ${formatDate(b.expiry_date)}</span>` : '<span class="badge">Senza scadenza</span>');
    const supplier = b.supplier_name ? escapeHtml(b.supplier_name) : '<span class="muted">Fornitore non indicato</span>';
    const photo = b.receipt_photo_url ? `
      <img data-photo="${escapeAttr(absoluteUrl(b.receipt_photo_url))}" src="${escapeAttr(absoluteUrl(b.receipt_photo_url))}"
           alt="Scontrino" loading="lazy"
           style="width: 56px; height: 56px; object-fit: cover; border-radius: var(--radius-md); border: 1px solid var(--border-soft); cursor: zoom-in;">
    ` : '';
    const menu = canEdit ? `
      <button type="button" data-batch-menu="${b.id}" class="btn btn--ghost btn--icon" aria-label="Azioni lotto" style="margin-left: auto;">${icon('more-vertical', { size: 18 })}</button>
    ` : '';
    return `
      <div class="card">
        <div class="row row--top" style="gap: var(--space-12); align-items: flex-start;">
          <div class="flex-1" style="min-width: 0;">
            <div class="row" style="gap: var(--space-12);">
              <span class="font-display text-lg" style="line-height:1;">${formatQty(b.current_qty, p.unit)}</span>
              <span class="muted text-xs">su ${formatQty(b.initial_qty, p.unit)} iniziali</span>
            </div>
            <div class="row" style="gap: var(--space-8); margin-top: var(--space-8); flex-wrap: wrap;">
              ${expiry}
              <span class="badge">€ ${formatPrice(b.purchase_price_unit, 4)} / ${escapeHtml(p.unit)}</span>
            </div>
            <p class="muted text-xs" style="margin-top: var(--space-8);">Caricato ${formatDate(b.load_date)} · ${supplier}</p>
          </div>
          ${photo}
          ${menu}
        </div>
      </div>
    `;
  }

  function renderMovements(items) {
    if (items && items.__error) {
      return `<div class="alert alert--warn"><span class="alert__icon">${icon('warning', { size: 20 })}</span><div class="alert__body"><strong>Movimenti non disponibili</strong><p class="alert__text">${escapeHtml(items.__error)}</p></div></div>`;
    }
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) {
      return `<h2 class="font-display text-xl" style="margin: 0 0 var(--space-12) 0;">Movimenti recenti</h2>
              <div class="card"><p class="muted text-sm">Nessun movimento registrato.</p></div>`;
    }
    return `
      <h2 class="font-display text-xl" style="margin: 0 0 var(--space-12) 0;">Movimenti recenti</h2>
      <div class="card-inset stack-8">
        ${list.map((m) => movementRow(m)).join('')}
      </div>`;
  }

  function movementRow(m) {
    const sign = Number(m.qty) < 0 ? '−' : (m.type === 'load' ? '+' : '−');
    const absQty = Math.abs(Number(m.qty));
    const colorCls = ({
      load: 'pill--success',
      sale: '',
      waste_expiry: 'pill--danger',
      waste_other: 'pill--danger',
      adjustment: 'pill--warn',
      staff_meal: '',
    })[m.type] || '';
    return `
      <div class="row" style="gap: var(--space-12); padding: var(--space-12) 0; border-top: 1px solid var(--border-soft);">
        <span class="pill ${colorCls}" style="white-space:nowrap;">${escapeHtml(m.type)}</span>
        <span class="flex-1 text-sm">${sign}${absQty} ${escapeHtml(product.unit)} ${m.reason ? `· <span class="muted">${escapeHtml(m.reason)}</span>` : ''}</span>
        <span class="muted text-xs" style="white-space:nowrap;">${formatDateTime(m.created_at)}</span>
      </div>
    `;
  }

  function renderFab(p) {
    return `
      <button type="button" id="fab-load" class="btn btn--primary btn--lg"
              style="position: fixed; right: var(--space-20); bottom: calc(80px + env(safe-area-inset-bottom, 0px)); border-radius: var(--radius-full); box-shadow: var(--shadow-lg); padding: var(--space-16) var(--space-24); z-index: 5;">
        ${icon('plus', { size: 20 })}<span>Carica lotto</span>
      </button>`;
  }

  function openActionsMenu(p) {
    showModal('Azioni prodotto', `
      <div class="stack-8">
        <button type="button" data-act="edit" class="btn btn--secondary full-width" style="justify-content:flex-start;">${icon('edit', { size: 18 })}<span>Modifica prodotto</span></button>
        ${p.active ? `<button type="button" data-act="disable" class="btn btn--danger full-width" style="justify-content:flex-start;">${icon('trash', { size: 18 })}<span>Disattiva prodotto</span></button>` : ''}
      </div>
    `, []);
    setTimeout(() => {
      document.querySelectorAll('.modal__body [data-act="edit"]').forEach((b) => {
        b.addEventListener('click', () => { closeAnyModal(); openEditModal(p); });
      });
      document.querySelectorAll('.modal__body [data-act="disable"]').forEach((b) => {
        b.addEventListener('click', async () => {
          closeAnyModal();
          const ok = await confirmDialog(
            `Disattivare "${p.name}"?`,
            'Il prodotto non sarà più ordinabile. I lotti e i movimenti restano nello storico.',
            { confirmLabel: 'Disattiva', cancelLabel: 'Annulla', danger: true },
          );
          if (!ok) return;
          try {
            await apiDelete(`/products/${p.id}`);
            showToast('Prodotto disattivato', 'success');
            navigate('/magazzino');
          } catch (err) {
            showToast(err.message || 'Errore disattivazione', 'danger', 5000);
          }
        });
      });
    }, 0);
  }

  function openEditModal(p) {
    const body = `
      <form id="edit-form" class="stack-12">
        <div class="form-row">
          <label class="label" for="ed-name">Nome</label>
          <input id="ed-name" class="input" value="${escapeAttr(p.name)}" required maxlength="200" />
        </div>
        <div class="grid-2">
          <div class="form-row">
            <label class="label" for="ed-cat">Categoria</label>
            <input id="ed-cat" class="input" value="${escapeAttr(p.category || '')}" maxlength="80" />
          </div>
          <div class="form-row">
            <label class="label" for="ed-unit">Unità</label>
            <input id="ed-unit" class="input" value="${escapeAttr(p.unit)}" required maxlength="32" />
          </div>
        </div>
        <div class="grid-2">
          <div class="form-row">
            <label class="label" for="ed-price">Prezzo vendita (€)</label>
            <input id="ed-price" class="input" type="number" min="0" step="0.01" value="${p.sale_price ?? ''}" />
          </div>
          <div class="form-row">
            <label class="label" for="ed-min">Scorta minima</label>
            <input id="ed-min" class="input" type="number" min="0" step="0.01" value="${p.min_stock ?? '0'}" />
          </div>
        </div>
        <div class="form-row">
          <label class="label" for="ed-vat">IVA</label>
          <select id="ed-vat" class="select">
            ${['iva_4','iva_5','iva_10','iva_22'].map((v) => `<option value="${v}" ${p.vat_rate === v ? 'selected' : ''}>${v.replace('iva_','')}%</option>`).join('')}
          </select>
        </div>
      </form>
    `;
    let closeFn;
    closeFn = showModal('Modifica prodotto', body, [
      { label: 'Annulla', variant: 'ghost' },
      { label: 'Salva', variant: 'primary', closeOnClick: false, onClick: async () => {
        const payload = {
          name: document.getElementById('ed-name').value.trim(),
          category: document.getElementById('ed-cat').value.trim() || null,
          unit: document.getElementById('ed-unit').value.trim(),
          sale_price: document.getElementById('ed-price').value || null,
          min_stock: document.getElementById('ed-min').value || '0',
          vat_rate: document.getElementById('ed-vat').value,
        };
        try {
          await apiPatch(`/products/${p.id}`, payload);
          showToast('Modifiche salvate', 'success');
          closeFn();
          mountInventoryDetail(container, { id: String(p.id) });
        } catch (err) {
          showToast(err.message || 'Errore salvataggio', 'danger', 5000);
        }
      } },
    ]);
  }

  function openBatchMenu(p, b) {
    showModal(`Lotto · scade ${b.expiry_date ? formatDate(b.expiry_date) : '—'}`, `
      <p class="muted text-sm">Disponibili: ${formatQty(b.current_qty, p.unit)} su ${formatQty(b.initial_qty, p.unit)}</p>
      <form id="ret-form" class="stack-12" style="margin-top: var(--space-16);">
        <div class="form-row">
          <label class="label" for="ret-qty">Nuova quantità (${escapeHtml(p.unit)})</label>
          <input id="ret-qty" class="input" type="number" min="0" step="0.01" value="${b.current_qty}" required />
        </div>
        <div class="form-row">
          <label class="label label--required" for="ret-reason">Motivo</label>
          <input id="ret-reason" class="input" placeholder="es. errore conta, prelievo manuale…" required maxlength="500" />
        </div>
      </form>
    `, [
      { label: 'Annulla', variant: 'ghost' },
      { label: 'Salva rettifica', variant: 'primary', closeOnClick: false, onClick: async (close) => {
        const newQty = document.getElementById('ret-qty').value;
        const reason = document.getElementById('ret-reason').value.trim();
        if (!reason) {
          showToast('Indica un motivo', 'warn');
          return;
        }
        try {
          await apiPost('/movements/rettifica', {
            batch_id: b.id,
            new_qty: newQty,
            reason,
          });
          showToast('Rettifica salvata', 'success');
          close();
          mountInventoryDetail(container, { id: String(p.id) });
        } catch (err) {
          showToast(err.message || 'Errore rettifica', 'danger', 5000);
        }
      } },
    ]);
  }

  function openLightbox(url) {
    showModal('Foto scontrino', `<div class="center"><img src="${escapeAttr(url)}" alt="Scontrino" style="max-width: 100%; max-height: 70vh; border-radius: var(--radius-md);"></div>`, []);
  }

  function closeAnyModal() {
    document.querySelectorAll('.modal-backdrop').forEach((bd) => bd.remove());
  }
}

// -------------------- Helpers --------------------

function computeMargin(sale, purchase) {
  const s = Number(sale);
  const p = Number(purchase);
  if (!s || !p || s <= 0) return null;
  return ((s - p) / s) * 100;
}

function formatPrice(v, frac = 2) {
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return n.toFixed(frac);
}

function formatQty(qty, unit) {
  const n = Number(qty);
  const rounded = Number.isInteger(n) ? n.toString() : n.toFixed(2);
  return `${rounded} ${unit || ''}`.trim();
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }) + ' · ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function formatNextExpiry(iso) {
  if (!iso) return { label: '—', color: 'ink-muted' };
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(iso); target.setHours(0,0,0,0);
  const days = Math.round((target - today) / 86400000);
  if (days < 0) return { label: `Scaduto ${formatDate(iso)}`, color: 'terracotta' };
  if (days === 0) return { label: 'Oggi', color: 'terracotta' };
  if (days === 1) return { label: 'Domani', color: 'amber' };
  if (days <= 5) return { label: `${days} giorni`, color: 'amber' };
  return { label: formatDate(iso), color: 'ink' };
}

function expiryBadgeHtml(nextExpiryDate) {
  if (!nextExpiryDate) return '';
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(nextExpiryDate); target.setHours(0,0,0,0);
  const days = Math.round((target - today) / 86400000);
  if (days > 10) return '';
  const bucket = EXPIRY_BUCKETS.find((b) => days <= b.maxDays);
  if (!bucket) return '';
  return `<span class="badge ${bucket.cls}">${bucket.label(days)}</span>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
