// /menu — Singoli (prodotti vendibili) + Combinati (piatti).

import { apiGet } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { userHasRole } from '../../js/auth.js';
import { icon } from '../../js/icons.js';
import { showToast, skeletonList } from '../../js/components.js';

export function mountMenuList(container, _params, query) {
  const canEdit = userHasRole('admin', 'manager');
  const tab = query.tab === 'combinati' ? 'combinati' : 'singoli';

  setHeader({
    title: 'Menu',
    brand: true,
    actions: canEdit ? [{
      label: 'Nuovo combinato',
      iconName: 'plus',
      onClick: () => navigate('/menu/combined/new'),
    }] : [],
  });

  container.innerHTML = `
    <section class="container" style="padding-block: var(--space-20); padding-bottom: 96px;">
      <div class="row" style="gap: var(--space-8); margin-bottom: var(--space-20);">
        ${tabPill('singoli', 'Singoli', tab === 'singoli')}
        ${tabPill('combinati', 'Combinati', tab === 'combinati')}
      </div>
      <div id="menu-results">${skeletonList(3)}</div>
    </section>
  `;

  container.querySelectorAll('[data-tab]').forEach((b) => {
    b.addEventListener('click', () => {
      const t = b.dataset.tab;
      navigate(`/menu?tab=${t}`, { replace: true });
    });
  });

  const resultsEl = container.querySelector('#menu-results');
  load();

  return () => {};

  // -----------------------------------------------------------------

  async function load() {
    try {
      if (tab === 'singoli') {
        const products = await apiGet('/products?active=true');
        renderSingoli(products);
      } else {
        const dishes = await apiGet('/menu/combined');
        renderCombinati(dishes);
      }
    } catch (err) {
      showToast(err.message || 'Errore caricamento menu', 'danger', 4000);
      resultsEl.innerHTML = `<div class="alert alert--urgent">
        <span class="alert__icon">${icon('alert', { size: 22 })}</span>
        <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(err.message || '')}</p></div>
      </div>`;
    }
  }

  function renderSingoli(products) {
    const list = products.filter((p) => p.sale_price != null);
    if (list.length === 0) {
      resultsEl.innerHTML = emptyState(
        'Nessun prodotto con prezzo di vendita',
        'I prodotti che vuoi vendere singolarmente devono avere un sale_price nella loro scheda. Modifica un prodotto dal Magazzino per impostarlo.',
      );
      return;
    }
    resultsEl.innerHTML = `<div class="stack-12">${list.map(singoloCard).join('')}</div>`;
    resultsEl.querySelectorAll('[data-product-id]').forEach((el) => {
      el.addEventListener('click', () => navigate(`/magazzino/${el.dataset.productId}`));
    });
  }

  function singoloCard(p) {
    const qty = Number(p.qty_total || 0);
    const available = qty > 0;
    const availPill = available
      ? `<span class="pill pill--success" style="white-space:nowrap;">Disponibile</span>`
      : `<span class="pill pill--danger" style="white-space:nowrap;">Esaurito</span>`;
    const category = p.category
      ? `<p class="muted text-xs uppercase" style="margin:0; letter-spacing: var(--letter-spacing-wide);">${escapeHtml(p.category)}</p>`
      : '';
    return `
      <div class="card" data-product-id="${p.id}" style="cursor: pointer; min-height: 56px;">
        <div class="row row--top" style="gap: var(--space-16);">
          <div class="flex-1" style="min-width: 0;">
            <h3 class="font-display text-lg" style="margin:0;">${escapeHtml(p.name)}</h3>
            ${category}
            <div class="row" style="gap: var(--space-8); margin-top: var(--space-8);">${availPill}<span class="muted text-xs">Scorta: ${formatQty(qty, p.unit)}</span></div>
          </div>
          <div class="center-text" style="flex-shrink:0;">
            <div class="font-display text-2xl" style="line-height:1; color: var(--terracotta);">€ ${formatPrice(p.sale_price)}</div>
            <div class="muted text-xs" style="margin-top: var(--space-4);">IVA ${escapeHtml((p.vat_rate || '').replace('iva_', ''))}%</div>
          </div>
        </div>
      </div>`;
  }

  function renderCombinati(dishes) {
    if (dishes.length === 0) {
      resultsEl.innerHTML = emptyState(
        'Nessun piatto combinato',
        canEdit
          ? 'Crea il primo combinando 2 o più prodotti del magazzino con un prezzo unico.'
          : 'Nessun combinato in carta al momento.',
        canEdit ? { label: 'Crea combinato', onClick: () => navigate('/menu/combined/new') } : null,
      );
      return;
    }
    resultsEl.innerHTML = `<div class="stack-12">${dishes.map(combinatoCard).join('')}</div>`;
    resultsEl.querySelectorAll('[data-dish-id]').forEach((el) => {
      el.addEventListener('click', () => {
        if (canEdit) navigate(`/menu/combined/${el.dataset.dishId}`);
      });
    });
  }

  function combinatoCard(d) {
    const availPill = d.available
      ? `<span class="pill pill--success" style="white-space:nowrap;">Disponibile</span>`
      : `<span class="pill pill--danger" style="white-space:nowrap;">Componente esaurito</span>`;
    const compsSummary = (d.components || [])
      .map((c) => escapeHtml(c.product_name || `#${c.product_id}`))
      .join(' · ') || '<span class="muted">Nessun componente</span>';
    const marginInfo = d.margin_percent != null
      ? `<span class="badge ${d.margin_percent >= 30 ? 'badge--success' : 'badge--warn'}">Margine ${Number(d.margin_percent).toFixed(0)}%</span>`
      : `<span class="badge">Margine —</span>`;
    return `
      <div class="card" data-dish-id="${d.id}" style="cursor: ${canEdit ? 'pointer' : 'default'}; min-height: 56px;">
        <div class="row row--top" style="gap: var(--space-16);">
          <div class="flex-1" style="min-width: 0;">
            <h3 class="font-display text-lg" style="margin:0;">${escapeHtml(d.name)}</h3>
            <p class="muted text-sm" style="margin: var(--space-4) 0 0 0;">${compsSummary}</p>
            <div class="row" style="gap: var(--space-8); margin-top: var(--space-8); flex-wrap: wrap;">
              ${availPill}${marginInfo}
            </div>
          </div>
          <div class="center-text" style="flex-shrink:0;">
            <div class="font-display text-2xl" style="line-height:1; color: var(--terracotta);">€ ${formatPrice(d.sale_price)}</div>
            ${d.cost != null ? `<div class="muted text-xs" style="margin-top: var(--space-4);">costo € ${formatPrice(d.cost)}</div>` : ''}
          </div>
        </div>
      </div>`;
  }

  function emptyState(title, message, cta = null) {
    const ctaHtml = cta
      ? `<button type="button" id="empty-cta" class="btn btn--primary" style="margin-top: var(--space-16);">${icon('plus', { size: 18 })}<span>${escapeHtml(cta.label)}</span></button>`
      : '';
    setTimeout(() => {
      const btn = resultsEl.querySelector('#empty-cta');
      if (btn && cta) btn.addEventListener('click', cta.onClick);
    }, 0);
    return `<div class="card center-text" style="padding: var(--space-32);">
      <div style="color: var(--ink-soft); margin-bottom: var(--space-16);">${icon('inventory', { size: 56 })}</div>
      <h3 class="font-display text-xl" style="margin: 0 0 var(--space-8) 0;">${escapeHtml(title)}</h3>
      <p class="muted">${escapeHtml(message)}</p>
      ${ctaHtml}
    </div>`;
  }
}

function tabPill(id, label, active) {
  return `<button type="button" data-tab="${id}" class="pill ${active ? 'pill--success' : ''}" style="cursor:pointer; border:none; white-space:nowrap;">${label}</button>`;
}

function formatQty(qty, unit) {
  const n = Number(qty);
  const rounded = Number.isInteger(n) ? n.toString() : n.toFixed(2);
  return `${rounded} ${unit || ''}`.trim();
}
function formatPrice(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return n.toFixed(2);
}
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
