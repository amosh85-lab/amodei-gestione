// /pasti-staff — list grouped by date.

import { apiGet } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { userHasRole, getCurrentUser } from '../../js/auth.js';
import { icon } from '../../js/icons.js';
import { showToast, skeletonList } from '../../js/components.js';
import { localIso } from '../../js/dates.js';

export function mountStaffMealsList(container, _params, query) {
  const isManagerOrAdmin = userHasRole('admin', 'manager');

  setHeader({
    title: 'Pasti staff',
    brand: true,
    actions: [{
      label: 'Nuovo',
      iconName: 'plus',
      onClick: () => navigate('/pasti-staff/nuovo'),
    }],
  });

  const state = {
    range: query.range || 'month',  // 'today' | 'week' | 'month'
    meals: [],
    loading: true,
  };

  container.innerHTML = `
    <section class="container" style="padding-block: var(--space-20); padding-bottom: 96px;">
      <div class="row" style="gap: var(--space-8); margin-bottom: var(--space-16); flex-wrap: wrap;">
        ${chip('today', 'Oggi')}
        ${chip('week', 'Questa settimana')}
        ${chip('month', 'Questo mese')}
        ${isManagerOrAdmin ? `<a href="#/pasti-staff/statistiche" class="pill" style="cursor:pointer; border:none; white-space:nowrap;">${icon('settings', { size: 14 })}<span>Statistiche</span></a>` : ''}
      </div>
      <div id="meals">${skeletonList(3)}</div>
    </section>
  `;

  container.querySelectorAll('[data-range]').forEach((b) => {
    b.addEventListener('click', () => {
      state.range = b.dataset.range;
      syncChips();
      load();
    });
  });

  // Pull to refresh
  const scrollHost = container.closest('#app') || container;
  const detachPull = attachPullToRefresh(scrollHost, load);

  load();
  return () => detachPull();

  // -----------------------------------------------------------------

  function chip(id, label) {
    const active = state.range === id;
    return `<button type="button" data-range="${id}" class="pill ${active ? 'pill--success' : ''}" style="cursor:pointer; border:none; white-space:nowrap;">${label}</button>`;
  }
  function syncChips() {
    container.querySelectorAll('[data-range]').forEach((b) => {
      b.className = `pill ${state.range === b.dataset.range ? 'pill--success' : ''}`;
    });
  }

  async function load() {
    const today = new Date();
    let from, to;
    if (state.range === 'today') {
      from = to = localIso(today);
    } else if (state.range === 'week') {
      const monday = new Date(today);
      const dow = (today.getDay() + 6) % 7; // mon=0
      monday.setDate(today.getDate() - dow);
      from = localIso(monday);
      to = localIso(today);
    } else {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      from = localIso(first);
      to = localIso(today);
    }
    const mealsEl = container.querySelector('#meals');
    try {
      const meals = await apiGet(`/staff-meals?from=${from}&to=${to}&limit=200`);
      state.meals = meals;
      renderMeals();
    } catch (err) {
      mealsEl.innerHTML = errorCard(err.message || 'Errore caricamento pasti');
    }
  }

  function renderMeals() {
    const mealsEl = container.querySelector('#meals');
    if (state.meals.length === 0) {
      mealsEl.innerHTML = `<div class="card center-text" style="padding: var(--space-32);">
        <div style="color: var(--ink-soft); margin-bottom: var(--space-16);">${icon('cash', { size: 56 })}</div>
        <h3 class="font-display text-xl" style="margin: 0 0 var(--space-8) 0;">Nessun pasto registrato</h3>
        <p class="muted">Inizia col primo: tap sul "+" in alto.</p>
      </div>`;
      return;
    }
    // Group by date
    const groups = {};
    for (const m of state.meals) {
      (groups[m.date] = groups[m.date] || []).push(m);
    }
    const sortedDates = Object.keys(groups).sort().reverse();
    mealsEl.innerHTML = sortedDates.map((d) => `
      <h3 class="font-display text-lg" style="margin: var(--space-24) 0 var(--space-12) 0;">${escapeHtml(humanDate(d))}</h3>
      <div class="stack-12">${groups[d].map(card).join('')}</div>
    `).join('');
    mealsEl.querySelectorAll('[data-meal-id]').forEach((el) => {
      el.addEventListener('click', () => navigate(`/pasti-staff/${el.dataset.mealId}`));
    });
  }

  function card(m) {
    const serviceLabel = m.service === 'lunch' ? 'Pranzo' : 'Cena';
    const serviceBadge = m.service === 'lunch'
      ? `<span class="badge badge--warn">${escapeHtml(serviceLabel)}</span>`
      : `<span class="badge badge--success">${escapeHtml(serviceLabel)}</span>`;
    const items = (m.items || []).map((it) => `${formatQty(it.qty)} ${escapeHtml(it.product_unit)} ${escapeHtml(it.product_name)}`).join(', ');
    const cost = isManagerOrAdmin && m.cost_total != null
      ? `<span class="badge">€ ${Number(m.cost_total).toFixed(2)}</span>`
      : '';
    const notes = m.notes ? `<p class="muted text-sm" style="margin: var(--space-8) 0 0 0; font-style: italic;">${escapeHtml(m.notes)}</p>` : '';
    const cancelled = m.cancelled_at
      ? `<span class="badge badge--danger">Annullato</span>`
      : '';
    return `
      <div class="card ${m.cancelled_at ? '' : ''}" data-meal-id="${m.id}" style="cursor: pointer; min-height: 56px; ${m.cancelled_at ? 'opacity: 0.55;' : ''}">
        <div class="row" style="gap: var(--space-12); flex-wrap: wrap;">
          ${serviceBadge}
          ${avatars(m.participants || [])}
          <span class="flex-1"></span>
          ${cancelled}
          ${cost}
        </div>
        <p style="margin: var(--space-12) 0 0 0;">${items}</p>
        ${notes}
      </div>
    `;
  }
}

// -------------------- Helpers --------------------

function avatars(users) {
  if (!users.length) return '';
  const visible = users.slice(0, 3);
  const extra = users.length - visible.length;
  const av = visible.map((u, i) => `
    <span title="${escapeAttr(u.full_name)}" style="
      width: 28px; height: 28px; border-radius: 50%;
      background: var(--terracotta); color: var(--off-white);
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 600;
      margin-left: ${i === 0 ? '0' : '-8px'};
      border: 2px solid var(--off-white);
      z-index: ${10 - i};">${escapeHtml(initials(u.full_name))}</span>`).join('');
  const more = extra > 0 ? `<span style="
    width: 28px; height: 28px; border-radius: 50%;
    background: var(--ink-muted); color: var(--off-white);
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 600;
    margin-left: -8px;
    border: 2px solid var(--off-white);">+${extra}</span>` : '';
  return `<div style="display: inline-flex; align-items: center;">${av}${more}</div>`;
}

export function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function humanDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatQty(qty) {
  const n = Number(qty);
  if (Number.isNaN(n)) return '—';
  return Number.isInteger(n) ? n.toString() : n.toFixed(2);
}

function errorCard(msg) {
  return `<div class="alert alert--urgent">
    <span class="alert__icon">${icon('alert', { size: 22 })}</span>
    <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(msg)}</p></div></div>`;
}

function attachPullToRefresh(scrollEl, onRefresh) {
  let startY = 0, armed = false;
  const onStart = (e) => {
    if (scrollEl.scrollTop <= 0) { startY = e.touches[0].clientY; armed = true; }
    else armed = false;
  };
  const onEnd = (e) => {
    if (!armed) return;
    armed = false;
    if (e.changedTouches[0].clientY - startY > 80) onRefresh();
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
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
