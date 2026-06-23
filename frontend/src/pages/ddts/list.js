// /ddt — documenti di trasporto (manager/admin).
//
// Due sezioni:
//   1. "Da fatturare" — DDT non ancora fatturati, RAGGRUPPATI PER FORNITORE,
//      con totale del gruppo e bottone "Genera fattura" (somma i DDT e crea
//      la fattura di fine mese).
//   2. "DDT del mese" — elenco recente; tap → dettaglio. Badge "Fatturato".

import { apiGet, apiPost, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { icon } from '../../js/icons.js';
import { skeletonList, showModal, showToast, docTabs } from '../../js/components.js';
import { todayLocalIso } from '../../js/dates.js';

const CAT_LABEL = { food: '🍖 Food', beverage: '🍷 Beverage', consumo: '🧴 Consumo' };
const CAT_COLOR = {
  food:     'background: rgba(181,57,31,0.12); color: var(--terracotta-dark);',
  beverage: 'background: rgba(79,142,58,0.12); color: var(--bottle-green, #4f8e3a);',
  consumo:  'background: rgba(120,120,120,0.12); color: var(--ink-muted);',
};

export async function mountDdtList(container, _params, _query) {
  setHeader({
    title: 'DDT',
    brand: true,
    backHref: '/',
    actions: [
      { label: 'Nuovo', iconName: 'plus', onClick: () => navigate('/ddt/nuovo') },
    ],
  });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(3)}</div>`;

  const state = { summary: null, recent: [], error: null };

  await load();
  return () => {};

  async function load() {
    state.error = null;
    try {
      const [summary, recent] = await Promise.all([
        apiGet('/ddts/summary'),
        apiGet('/ddts?limit=1000'),
      ]);
      state.summary = summary;
      state.recent = recent;
      render();
    } catch (err) {
      state.error = err.message || 'Errore di rete';
      container.innerHTML = errorBlock(state.error, load);
    }
  }

  function render() {
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
        ${docTabs('ddt')}
        ${renderKpi()}
        ${renderGroups()}
        ${renderRecent()}
      </section>
    `;
    wire();
  }

  function renderKpi() {
    const s = state.summary || { total_unbilled: 0, count: 0 };
    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-8); margin-bottom: var(--space-16);">
        <div class="card" style="padding: var(--space-12);">
          <p class="muted text-xs" style="margin:0; text-transform: uppercase;">Da fatturare</p>
          <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 1.4rem; font-weight: 600; color: var(--terracotta-dark);">€ ${fmt(s.total_unbilled)}</p>
          <p class="muted text-xs" style="margin: 2px 0 0 0;">${s.count} DDT</p>
        </div>
        <div class="card" style="padding: var(--space-12);">
          <p class="muted text-xs" style="margin:0; text-transform: uppercase;">Mese corrente</p>
          <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 1.4rem; font-weight: 600;">€ ${fmt(state.recent.reduce((a, d) => a + Number(d.amount_total), 0))}</p>
          <p class="muted text-xs" style="margin: 2px 0 0 0;">${state.recent.length} DDT</p>
        </div>
      </div>
    `;
  }

  function renderGroups() {
    const groups = (state.summary && state.summary.by_supplier) || [];
    if (groups.length === 0) {
      return `<p class="muted" style="margin: 0 0 var(--space-16) 0; padding: var(--space-16); text-align: center; background: var(--cream-soft); border-radius: var(--radius-md);">Nessun DDT da fatturare. 🎉</p>`;
    }
    return `
      <h2 class="text-sm" style="margin: 0 0 var(--space-8) 0; text-transform: uppercase; letter-spacing: 0.04em;" class="muted">Da fatturare per fornitore</h2>
      <div class="stack-12" style="margin-bottom: var(--space-20);">
        ${groups.map((g) => groupCard(g)).join('')}
      </div>
    `;
  }

  function groupCard(g) {
    return `
      <div class="card" style="padding: var(--space-12) var(--space-16);">
        <div style="display: flex; justify-content: space-between; gap: var(--space-8); align-items: baseline;">
          <div style="min-width: 0;">
            <div style="display: flex; gap: var(--space-8); align-items: center; flex-wrap: wrap;">
              <span style="font-weight: 600;">${escapeHtml(g.supplier.name)}</span>
              <span class="badge" style="${CAT_COLOR[g.supplier.category]} white-space: nowrap; font-size: var(--text-xs);">${CAT_LABEL[g.supplier.category] || g.supplier.category}</span>
            </div>
            <p class="muted text-xs" style="margin: 2px 0 0 0;">${g.count} DDT non fatturati</p>
          </div>
          <span style="font-family: var(--font-display); font-size: 1.3rem;">€ ${fmt(g.total)}</span>
        </div>
        <button type="button" data-gen="${g.supplier.id}" class="btn btn--primary full-width" style="margin-top: var(--space-12);">
          ${icon('check', { size: 16 })}<span>Genera fattura</span>
        </button>
      </div>
    `;
  }

  function renderRecent() {
    if (state.recent.length === 0) {
      return `<p class="muted" style="margin: 0; padding: var(--space-16); text-align: center; background: var(--cream-soft); border-radius: var(--radius-md);">Nessun DDT questo mese.</p>`;
    }
    return `
      <h2 class="text-sm muted" style="margin: 0 0 var(--space-8) 0; text-transform: uppercase; letter-spacing: 0.04em;">DDT del mese</h2>
      <div class="card" style="padding: 0;">
        ${state.recent.map((d, i) => row(d, i)).join('')}
      </div>
    `;
  }

  function row(d, i) {
    const billedBadge = d.is_billed
      ? `<span class="badge" style="background: rgba(79,142,58,0.15); color: var(--bottle-green, #4f8e3a); white-space: nowrap;">✓ Fatturato</span>`
      : `<span class="badge" style="background: rgba(201,148,42,0.15); color: var(--warning, #c9942a); white-space: nowrap;">Da fatturare</span>`;
    return `
      <button type="button" data-id="${d.id}" style="
        display: block; width: 100%; padding: var(--space-12) var(--space-16);
        ${i > 0 ? 'border-top: 1px solid var(--border-soft);' : ''}
        background: transparent; border: none; text-align: left; cursor: pointer;">
        <div style="display: flex; justify-content: space-between; gap: var(--space-8); align-items: baseline;">
          <div style="min-width: 0; flex: 1;">
            <div style="display: flex; gap: var(--space-8); align-items: center; flex-wrap: wrap;">
              <span style="font-weight: 600;">${escapeHtml(d.supplier.name)}</span>
              ${billedBadge}
            </div>
            <p class="muted text-xs" style="margin: 2px 0 0 0;">#${escapeHtml(d.ddt_number)} · ${formatDate(d.ddt_date)}</p>
          </div>
          <span style="font-family: var(--font-display); font-size: 1.2rem;">€ ${fmt(d.amount_total)}</span>
        </div>
      </button>
    `;
  }

  function wire() {
    container.querySelectorAll('[data-doctab]').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.dataset.doctab !== '/ddt') navigate(b.dataset.doctab);
      });
    });
    container.querySelectorAll('[data-id]').forEach((b) => {
      b.addEventListener('click', () => navigate(`/ddt/${b.dataset.id}`));
    });
    container.querySelectorAll('[data-gen]').forEach((b) => {
      b.addEventListener('click', () => {
        const group = (state.summary.by_supplier || []).find((g) => String(g.supplier.id) === b.dataset.gen);
        if (group) openGenerateModal(group);
      });
    });
  }

  function openGenerateModal(group) {
    const today = todayLocalIso();
    const list = group.ddts.map((d) =>
      `<div class="row" style="justify-content: space-between; padding: var(--space-4) 0;">
        <span class="text-sm">#${escapeHtml(d.ddt_number)} · ${formatDate(d.ddt_date)}</span>
        <span class="text-sm" style="font-family: var(--font-display);">€ ${fmt(d.amount_total)}</span>
      </div>`).join('');
    const body = `
      <p class="muted text-sm" style="margin: 0 0 var(--space-8) 0;">${escapeHtml(group.supplier.name)} — ${group.count} DDT</p>
      <div style="max-height: 28vh; overflow-y: auto; border: 1px solid var(--border-soft); border-radius: var(--radius-md); padding: var(--space-8) var(--space-12); margin-bottom: var(--space-12);">
        ${list}
        <div class="row" style="justify-content: space-between; padding-top: var(--space-8); margin-top: var(--space-4); border-top: 1px solid var(--border-soft); font-weight: 600;">
          <span>Totale fattura</span>
          <span style="font-family: var(--font-display); font-size: 1.2rem;">€ ${fmt(group.total)}</span>
        </div>
      </div>
      <form id="gen-form" class="stack-12" novalidate>
        <div class="form-row">
          <label class="label label--required" for="gen-number">Numero fattura del fornitore</label>
          <input id="gen-number" class="input" type="text" maxlength="50" required placeholder="Es. FT/2026/045">
        </div>
        <div class="form-row">
          <label class="label label--required" for="gen-date">Data fattura</label>
          <input id="gen-date" class="input" type="date" value="${today}" required>
        </div>
      </form>
    `;
    showModal('Genera fattura dai DDT', body, [
      { label: 'Annulla', variant: 'ghost' },
      {
        label: 'Genera',
        variant: 'primary',
        closeOnClick: false,
        onClick: async (close) => {
          const num = document.getElementById('gen-number').value.trim();
          const dt = document.getElementById('gen-date').value;
          if (!num || !dt) {
            showToast('Numero fattura e data sono obbligatori', 'warn'); return;
          }
          const payload = {
            supplier_id: group.supplier.id,
            ddt_ids: group.ddts.map((d) => d.id),
            invoice_number: num,
            invoice_date: dt,
          };
          try {
            const res = await apiPost('/ddts/generate-invoice', payload);
            showToast('Fattura generata', 'success');
            close();
            navigate(`/fatture/${res.invoice_id}`);
          } catch (err) {
            let msg = err instanceof ApiError && err.message ? err.message : 'Errore generazione';
            if (err instanceof ApiError && err.status === 409) {
              msg = 'Esiste già una fattura con questo numero per questo fornitore.';
            }
            showToast(msg, 'danger', 5000);
          }
        },
      },
    ]);
  }
}

// ---------- helpers ----------

function fmt(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return '0,00';
  return n.toFixed(2).replace('.', ',');
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
