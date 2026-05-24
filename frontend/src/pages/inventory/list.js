// /magazzino — list of products with stock + filters + search.

import { apiGet } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { userHasRole } from '../../js/auth.js';
import { icon } from '../../js/icons.js';
import { showToast, skeletonList } from '../../js/components.js';

const EXPIRY_BUCKETS = [
  { maxDays: 1,  cls: 'badge--danger', label: (d) => d <= 0 ? 'Scaduto' : 'Scade oggi' },
  { maxDays: 2,  cls: 'badge--danger', label: () => 'Scade in 1g' },
  { maxDays: 5,  cls: 'badge--warn',   label: (d) => `Scade tra ${d}g` },
  { maxDays: 10, cls: 'badge--warn',   label: (d) => `Scade tra ${d}g` },
];

export function mountInventoryList(container) {
  const state = {
    products: [],
    filter: 'all',    // 'all' | 'expiring' | 'low' | category-name
    category: null,
    search: '',
    loading: true,
  };

  setHeader({
    title: 'Magazzino',
    brand: true,
    actions: [
      {
        label: 'Sprechi',
        iconName: 'trash',
        onClick: () => navigate('/report/sprechi'),
      },
      {
        label: 'Margini',
        iconName: 'bar-chart',
        onClick: () => navigate('/report/margini'),
      },
      {
        label: 'Aggiorna',
        iconName: 'refresh-cw',
        onClick: () => refresh(),
      },
      {
        label: 'Carica',
        iconName: 'plus',
        onClick: () => navigate('/magazzino/carico'),
      },
    ],
  });

  container.innerHTML = `
    <section class="container" style="padding-block: var(--space-20);">

      <div class="input-group" style="margin-bottom: var(--space-16);">
        <span class="input-group__icon">${icon('search', { size: 18 })}</span>
        <input id="search" class="input" type="search" placeholder="Cerca prodotto o codice…" />
      </div>

      <div id="filter-chips" class="row" style="margin-bottom: var(--space-20); gap: var(--space-8); overflow-x: auto; flex-wrap: nowrap; padding-bottom: var(--space-4);">
        ${chipHtml('all', 'Tutti', true)}
        ${chipHtml('expiring', 'In scadenza')}
        ${chipHtml('low', 'Scorta bassa')}
        ${chipHtml('category', 'Per categoria…')}
      </div>

      <div id="results"></div>
    </section>
  `;

  const resultsEl = container.querySelector('#results');
  const searchEl = container.querySelector('#search');
  const chipsEl = container.querySelector('#filter-chips');

  // ----- search with debounce -----
  let searchTimer = null;
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = searchEl.value.trim();
      refresh();
    }, 250);
  });

  // ----- filter chips -----
  chipsEl.addEventListener('click', (ev) => {
    const chip = ev.target.closest('[data-chip]');
    if (!chip) return;
    const key = chip.dataset.chip;
    if (key === 'category') {
      openCategoryModal();
      return;
    }
    state.filter = key;
    state.category = null;
    syncChips();
    refresh();
  });

  // ----- pull-to-refresh -----
  const scrollHost = container.closest('#app') || container;
  const detachPull = attachPullToRefresh(scrollHost, () => refresh());

  resultsEl.innerHTML = skeletonList(4);
  refresh();

  // cleanup
  return () => {
    clearTimeout(searchTimer);
    detachPull();
  };

  // -----------------------------------------------------------------

  function chipHtml(key, label, active = false) {
    return `<button type="button" data-chip="${key}" class="pill ${active ? 'pill--success' : ''}" style="cursor:pointer; border:none; white-space:nowrap;">${escapeHtml(label)}</button>`;
  }

  function syncChips() {
    chipsEl.querySelectorAll('[data-chip]').forEach((b) => {
      const k = b.dataset.chip;
      const isActive =
        state.filter === k ||
        (k === 'category' && state.filter === 'category' && state.category);
      b.className = `pill ${isActive ? 'pill--success' : ''}`;
      if (k === 'category' && state.category) {
        b.textContent = `Categoria: ${state.category}`;
      } else if (k === 'category') {
        b.textContent = 'Per categoria…';
      }
    });
  }

  async function refresh() {
    state.loading = true;
    if (state.products.length === 0) {
      resultsEl.innerHTML = skeletonList(4);
    }
    try {
      const params = new URLSearchParams();
      if (state.search) params.set('search', state.search);
      if (state.filter === 'expiring') params.set('expiring_within_days', '5');
      if (state.filter === 'category' && state.category) {
        params.set('category', state.category);
      }
      const path = `/products${params.toString() ? `?${params}` : ''}`;
      const products = await apiGet(path);
      state.products = products;
      state.loading = false;
      renderResults();
    } catch (err) {
      state.loading = false;
      showToast(err.message || 'Errore nel caricamento', 'danger', 4000);
      resultsEl.innerHTML = `<div class="alert alert--urgent">
        <span class="alert__icon">${icon('alert', { size: 22 })}</span>
        <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(err.message || 'Impossibile caricare i prodotti.')}</p></div>
      </div>`;
    }
  }

  function renderResults() {
    let list = state.products;
    if (state.filter === 'low') {
      list = list.filter((p) => Number(p.min_stock) > 0 && Number(p.qty_total) < Number(p.min_stock));
    }
    if (list.length === 0) {
      renderEmpty();
      return;
    }
    resultsEl.innerHTML = `<div class="stack-12">${list.map(cardHtml).join('')}</div>`;
    resultsEl.querySelectorAll('[data-product-id]').forEach((el) => {
      el.addEventListener('click', () => navigate(`/magazzino/${el.dataset.productId}`));
    });
  }

  function cardHtml(p) {
    const expiryBadge = expiryBadgeHtml(p.next_expiry_date);
    const lowStock = Number(p.min_stock) > 0 && Number(p.qty_total) < Number(p.min_stock);
    const lowBadge = lowStock
      ? `<span class="badge badge--warn">${icon('warning', { size: 14 })}<span>Scorta bassa</span></span>`
      : '';
    const qty = formatQty(p.qty_total, p.unit);
    const category = p.category ? `<p class="muted text-xs uppercase" style="margin:0; letter-spacing: var(--letter-spacing-wide);">${escapeHtml(p.category)}</p>` : '';
    return `
      <div class="card" data-product-id="${p.id}" style="cursor: pointer; min-height: 56px;">
        <div class="row row--top" style="gap: var(--space-16); align-items: flex-start;">
          <div class="flex-1" style="min-width: 0;">
            <h3 class="font-display text-lg" style="margin: 0;">${escapeHtml(p.name)}</h3>
            ${category}
            ${(expiryBadge || lowBadge) ? `<div class="row" style="gap: var(--space-8); margin-top: var(--space-8);">${expiryBadge}${lowBadge}</div>` : ''}
          </div>
          <div class="center-text" style="flex-shrink: 0;">
            <div class="font-display text-2xl" style="line-height:1; color: var(--ink);">${escapeHtml(qty.split(' ')[0])}</div>
            <div class="muted text-xs" style="margin-top: var(--space-4);">${escapeHtml(qty.split(' ').slice(1).join(' ') || p.unit)}</div>
          </div>
        </div>
      </div>`;
  }

  function renderEmpty() {
    const canCreate = userHasRole('admin', 'manager');
    const noFilters = state.filter === 'all' && !state.search;
    if (noFilters) {
      resultsEl.innerHTML = `
        <div class="card center-text" style="padding: var(--space-32);">
          <div style="color: var(--ink-soft); margin-bottom: var(--space-16);">${icon('inventory', { size: 64 })}</div>
          <h3 class="font-display text-xl" style="margin: 0 0 var(--space-8) 0;">Nessun prodotto in magazzino</h3>
          <p class="muted">Inizia caricando il primo lotto: definisci il prodotto e registra il carico in pochi secondi.</p>
          ${canCreate ? `<button type="button" id="empty-cta" class="btn btn--primary" style="margin-top: var(--space-16);">${icon('plus', { size: 18 })}<span>Crea primo prodotto</span></button>` : ''}
        </div>`;
      if (canCreate) {
        resultsEl.querySelector('#empty-cta').addEventListener('click', () => navigate('/magazzino/carico'));
      }
    } else {
      resultsEl.innerHTML = `
        <div class="card center-text" style="padding: var(--space-24);">
          <div style="color: var(--ink-soft); margin-bottom: var(--space-12);">${icon('search', { size: 40 })}</div>
          <p class="muted">Nessun prodotto trovato con i filtri correnti.</p>
        </div>`;
    }
  }

  async function openCategoryModal() {
    try {
      const cats = await apiGet('/products/categories');
      const { showModal } = await import('../../js/components.js');
      const inner = cats.length === 0
        ? `<p class="muted">Nessuna categoria definita ancora.</p>`
        : `<div class="stack-8">${cats.map((c) => `<button type="button" data-cat="${escapeAttr(c)}" class="btn btn--ghost full-width" style="justify-content:flex-start;">${escapeHtml(c)}</button>`).join('')}</div>`;
      let closeFn;
      closeFn = showModal('Filtra per categoria', inner, [
        { label: 'Tutte', variant: 'secondary', onClick: () => {
          state.filter = 'all'; state.category = null; syncChips(); refresh();
        } },
      ]);
      // Re-bind category buttons inside modal body
      // showModal sets the innerHTML; we can query the document because modal is in the DOM.
      document.querySelectorAll('.modal__body [data-cat]').forEach((b) => {
        b.addEventListener('click', () => {
          state.filter = 'category';
          state.category = b.dataset.cat;
          syncChips();
          refresh();
          closeFn();
        });
      });
    } catch (err) {
      showToast(err.message || 'Errore nel caricamento delle categorie', 'danger');
    }
  }
}

// -------------------- Helpers --------------------

function expiryBadgeHtml(nextExpiryDate) {
  if (!nextExpiryDate) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(nextExpiryDate);
  target.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (days > 10) return '';
  const bucket = EXPIRY_BUCKETS.find((b) => days <= b.maxDays);
  if (!bucket) return '';
  return `<span class="badge ${bucket.cls}">${bucket.label(days)}</span>`;
}

function formatQty(qty, unit) {
  const n = Number(qty);
  const rounded = Number.isInteger(n) ? n.toString() : n.toFixed(2);
  return `${rounded} ${unit || ''}`.trim();
}

function attachPullToRefresh(scrollEl, onRefresh) {
  let startY = 0;
  let armed = false;
  const onStart = (e) => {
    if (scrollEl.scrollTop <= 0) {
      startY = e.touches[0].clientY;
      armed = true;
    } else {
      armed = false;
    }
  };
  const onEnd = (e) => {
    if (!armed) return;
    armed = false;
    const delta = e.changedTouches[0].clientY - startY;
    if (delta > 80) onRefresh();
  };
  scrollEl.addEventListener('touchstart', onStart, { passive: true });
  scrollEl.addEventListener('touchend', onEnd, { passive: true });
  return () => {
    scrollEl.removeEventListener('touchstart', onStart);
    scrollEl.removeEventListener('touchend', onEnd);
  };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
