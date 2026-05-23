// /pasti-staff/:id — meal detail.

import { apiGet, apiDelete, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { userHasRole } from '../../js/auth.js';
import { icon } from '../../js/icons.js';
import { showToast, confirmDialog } from '../../js/components.js';
import { initials, humanDate } from './list.js';

export async function mountStaffMealsDetail(container, params) {
  const isManagerOrAdmin = userHasRole('admin', 'manager');
  const isAdmin = userHasRole('admin');

  setHeader({
    title: 'Pasto',
    brand: true,
    backHref: '/pasti-staff',
  });

  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
    <div class="card stack-12"><div class="skeleton skeleton--title"></div><div class="skeleton skeleton--block"></div></div></div>`;

  let m;
  try {
    m = await apiGet(`/staff-meals/${params.id}`);
  } catch (err) {
    container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
      <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
      <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(err.message || '')}</p></div></div></div>`;
    return;
  }

  setHeader({
    title: humanDate(m.date),
    brand: true,
    backHref: '/pasti-staff',
  });

  render(m);

  function render(m) {
    const svc = m.service === 'lunch' ? 'Pranzo' : 'Cena';
    const cancelled = m.cancelled_at
      ? `<div class="alert alert--urgent" style="margin-bottom: var(--space-16);">
          <span class="alert__icon">${icon('alert', { size: 22 })}</span>
          <div class="alert__body"><strong>Pasto annullato</strong>
            <p class="alert__text">Il ${escapeHtml(new Date(m.cancelled_at).toLocaleString('it-IT'))} le scorte sono state ripristinate.</p></div>
        </div>`
      : '';

    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-20); padding-bottom: 100px;">
        ${cancelled}

        <div class="card stack-12">
          <div class="row" style="gap: var(--space-8); flex-wrap: wrap;">
            <span class="badge ${m.service === 'lunch' ? 'badge--warn' : 'badge--success'}">${escapeHtml(svc)}</span>
            <span class="muted text-sm">Creato da ${escapeHtml(m.created_by_name || '—')}</span>
          </div>
          <p class="muted text-xs uppercase" style="margin:0; letter-spacing: var(--letter-spacing-wide);">Partecipanti</p>
          <div class="row" style="gap: var(--space-8); flex-wrap: wrap;">
            ${(m.participants || []).map((u) => `
              <span class="pill" style="background: var(--color-info-bg); color: var(--ink);">
                <span style="width:22px; height:22px; border-radius:50%; background:var(--terracotta); color:var(--off-white); display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:600;">${escapeHtml(initials(u.full_name))}</span>
                <span>${escapeHtml(u.full_name)}</span>
              </span>
            `).join('')}
          </div>
        </div>

        <h3 class="font-display text-xl" style="margin: var(--space-24) 0 var(--space-12) 0;">Prodotti consumati</h3>
        <div class="stack-8">
          ${(m.items || []).map((it) => `
            <div class="card">
              <div class="row" style="gap: var(--space-12);">
                <div class="flex-1"><p style="margin:0;"><strong>${escapeHtml(it.product_name)}</strong></p>
                  <p class="muted text-xs" style="margin: var(--space-4) 0 0 0;">${formatQty(it.qty)} ${escapeHtml(it.product_unit)}</p></div>
                ${isManagerOrAdmin ? `<span class="badge">€ ${Number(it.cost_total).toFixed(2)}</span>` : ''}
              </div>
            </div>
          `).join('')}
        </div>

        ${isManagerOrAdmin ? `
          <div class="card card--inset" style="margin-top: var(--space-20);">
            <p class="muted text-xs uppercase" style="margin:0; letter-spacing: var(--letter-spacing-wide);">Costo totale</p>
            <p class="font-display text-3xl" style="margin: var(--space-8) 0 0 0; color: var(--terracotta);">€ ${Number(m.cost_total).toFixed(2)}</p>
          </div>
        ` : ''}

        ${m.notes ? `<div class="card" style="margin-top: var(--space-16); font-style: italic;">${escapeHtml(m.notes)}</div>` : ''}

        ${isAdmin && !m.cancelled_at ? `
          <div class="row" style="margin-top: var(--space-32); justify-content: flex-end;">
            <button type="button" id="del-btn" class="btn btn--danger">${icon('trash', { size: 18 })}<span>Annulla pasto</span></button>
          </div>
        ` : ''}
      </section>
    `;

    const del = container.querySelector('#del-btn');
    if (del) del.addEventListener('click', cancel);
  }

  async function cancel() {
    const ok = await confirmDialog(
      'Annullare il pasto?',
      'Le scorte verranno ripristinate. L\'annullamento resta nello storico per audit.',
      { confirmLabel: 'Annulla pasto', cancelLabel: 'No', danger: true },
    );
    if (!ok) return;
    try {
      const updated = await apiDelete(`/staff-meals/${m.id}`);
      m = updated;
      showToast('Pasto annullato. Scorte ripristinate.', 'success', 4000);
      render(m);
    } catch (err) {
      showToast(err.message || 'Errore annullamento', 'danger', 5000);
    }
  }
}

function formatQty(qty) {
  const n = Number(qty);
  if (Number.isNaN(n)) return '—';
  return Number.isInteger(n) ? n.toString() : n.toFixed(2);
}
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
