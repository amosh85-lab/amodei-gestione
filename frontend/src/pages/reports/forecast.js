// /riordini-previsti — daily reorder forecast (manager/admin).
//
// Reads from GET /forecast/low-stock-prediction. Each row shows the
// product's name, average daily consumption, current stock, days left
// (colored badge red <3, amber 3-7, green >7, gray = no consumption),
// and the suggested order qty. Tap a row → /segnala?product_id=N.
// Admin-only button at the top triggers POST /forecast/generate-system-alerts.

import { apiGet, apiPost, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { userHasRole } from '../../js/auth.js';
import { icon } from '../../js/icons.js';
import { showToast, skeletonList } from '../../js/components.js';

export async function mountReportsForecast(container, _params, _query) {
  setHeader({ title: 'Riordini previsti', brand: true, backHref: '/riordini' });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(5)}</div>`;

  const state = {
    rows: [],
    generating: false,
  };
  const isAdmin = userHasRole('admin');

  await load();
  return () => {};

  // -----------------------------------------------------------------

  async function load() {
    try {
      state.rows = await apiGet('/forecast/low-stock-prediction');
      render();
    } catch (err) {
      container.innerHTML = errorBlock(err.message || 'Errore di rete');
    }
  }

  function render() {
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
        ${renderHeader()}
        ${renderList()}
      </section>
    `;
    wire();
  }

  function renderHeader() {
    const urgentCount = state.rows.filter((r) => r.days_until_stockout != null && r.days_until_stockout < 7).length;
    return `
      <div style="margin-bottom: var(--space-16);">
        <p class="muted text-sm" style="margin: 0 0 var(--space-8) 0;">
          Storico 28 giorni · copertura 14 giorni · ${urgentCount} prodotti sotto la soglia di 7gg.
        </p>
        ${isAdmin ? `
          <button type="button" id="gen-btn" class="btn btn--primary" ${state.generating ? 'disabled' : ''}>
            ${state.generating ? 'Generazione in corso…' : 'Genera segnalazioni di sistema'}
          </button>
          <p class="muted text-xs" style="margin: var(--space-4) 0 0 0;">
            Manuale: il job giornaliero alle 6:00 UTC le crea già automaticamente.
          </p>
        ` : ''}
      </div>
    `;
  }

  function renderList() {
    if (state.rows.length === 0) {
      return emptyCard('Nessun prodotto attivo.');
    }
    return `
      <div class="card" style="padding: 0;">
        ${state.rows.map((r, i) => row(r, i)).join('')}
      </div>
    `;
  }

  function row(r, i) {
    const badge = daysBadge(r.days_until_stockout);
    const suggested = Number(r.suggested_order_qty);
    return `
      <button type="button" data-pid="${r.product_id}" style="
        display: block; width: 100%; padding: var(--space-12) var(--space-16);
        ${i > 0 ? 'border-top: 1px solid var(--border-soft);' : ''}
        background: transparent; border: none; text-align: left; cursor: pointer;">
        <div style="display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-8);">
          <span style="font-weight: 500;">${escapeHtml(r.name)}</span>
          ${badge}
        </div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: 2px; gap: var(--space-8);">
          <span class="muted text-xs">
            ${formatQty(r.current_qty)} ${escapeHtml(r.unit)} in stock · ${formatQty(r.consumption_per_day)} ${escapeHtml(r.unit)}/giorno${r.category ? ' · ' + escapeHtml(r.category) : ''}
          </span>
          ${suggested > 0 ? `<span style="font-family: var(--font-display); color: var(--terracotta-dark);">+ ${formatQty(suggested)} ${escapeHtml(r.unit)}</span>` : ''}
        </div>
      </button>
    `;
  }

  function daysBadge(days) {
    if (days == null) {
      return `<span class="badge" style="background: var(--cream-soft); color: var(--ink-muted); white-space: nowrap;">— nessun consumo</span>`;
    }
    let bg, color, label;
    if (days < 3) {
      bg = 'var(--terracotta-dark)'; color = 'var(--off-white)'; label = `${days} gg`;
    } else if (days < 7) {
      bg = 'var(--warning, #c9942a)'; color = 'var(--off-white)'; label = `${days} gg`;
    } else {
      bg = 'var(--success, #4f8e3a)'; color = 'var(--off-white)'; label = `${days} gg`;
    }
    return `<span class="badge" style="background: ${bg}; color: ${color}; white-space: nowrap; font-family: var(--font-display);">${label}</span>`;
  }

  function wire() {
    const gen = container.querySelector('#gen-btn');
    if (gen) gen.addEventListener('click', generateAlerts);
    container.querySelectorAll('[data-pid]').forEach((btn) => {
      btn.addEventListener('click', () => navigate(`/segnala?product_id=${btn.dataset.pid}`));
    });
  }

  async function generateAlerts() {
    if (state.generating) return;
    state.generating = true;
    render();
    try {
      const out = await apiPost('/forecast/generate-system-alerts');
      showToast(
        `Generate ${out.created} segnalazioni di sistema (skippate ${out.skipped_existing_open} con alert aperti).`,
        'success', 4000,
      );
    } catch (err) {
      const msg = err instanceof ApiError && err.message ? err.message : 'Errore generazione';
      showToast(msg, 'danger', 5000);
    } finally {
      state.generating = false;
      await load();   // re-render with same data; alerts are visible via /riordini
    }
  }
}

// ---------- helpers ----------

function formatQty(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return '0';
  return n.toFixed(2).replace('.', ',');
}

function emptyCard(msg) {
  return `<p class="muted" style="margin: 0; padding: var(--space-16); text-align: center; background: var(--cream-soft); border-radius: var(--radius-md);">${escapeHtml(msg)}</p>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function errorBlock(msg) {
  return `<div class="container" style="padding-top: var(--space-20);">
    <div class="alert alert--urgent">
      <span class="alert__icon">${icon('alert', { size: 22 })}</span>
      <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(msg)}</p></div>
    </div>
  </div>`;
}
