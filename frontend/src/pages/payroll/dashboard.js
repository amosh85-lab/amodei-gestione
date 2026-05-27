// /stipendi — monthly payroll dashboard (admin only).
//
// Disclaimer in alto: "stime operative, non busta reale".
// KPI mese + card per dipendente con bottone "Marca acconti saldati"
// che chiama POST /work-shifts/monthly-payroll/{user_id}/settle-advances.

import { apiGet, apiPost, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { icon } from '../../js/icons.js';
import { showModal, showToast, skeletonList } from '../../js/components.js';

export async function mountPayrollDashboard(container, _params, query) {
  setHeader({ title: 'Stipendi', brand: true, backHref: '/' });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(4)}</div>`;

  const now = new Date();
  const state = {
    year: parseInt(query.year, 10) || now.getFullYear(),
    month: parseInt(query.month, 10) || (now.getMonth() + 1),
    data: null,
  };

  await load();
  return () => {};

  async function load() {
    try {
      state.data = await apiGet(`/work-shifts/monthly-payroll?year=${state.year}&month=${state.month}`);
      render();
    } catch (err) {
      container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
        <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
          <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(err.message || '')}</p></div></div></div>`;
    }
  }

  function render() {
    const d = state.data;
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
        <div class="alert alert--warn" style="margin-bottom: var(--space-16);">
          <span class="alert__icon">${icon('warning', { size: 20 })}</span>
          <div class="alert__body"><p class="alert__text">
            <strong>Stime operative:</strong> ore × tariffa concordata, meno acconti. Il netto reale in busta è del commercialista (contributi, IRPEF, TFR esclusi qui).
          </p></div>
        </div>
        ${renderMonthNav()}
        ${renderKpi(d.totals)}
        ${renderUserList(d.by_user)}
      </section>
    `;
    wire();
  }

  function renderMonthNav() {
    const label = new Date(state.year, state.month - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
    return `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-12);">
        <button type="button" data-nav="prev" class="btn btn--ghost btn--icon" aria-label="Mese precedente">${icon('chevron-left', { size: 22 })}</button>
        <p style="margin:0; font-family: var(--font-display); font-size: var(--text-lg); text-transform: capitalize; font-weight: 500;">${escapeHtml(label)}</p>
        <button type="button" data-nav="next" class="btn btn--ghost btn--icon" aria-label="Mese successivo">${icon('chevron-right', { size: 22 })}</button>
      </div>
    `;
  }

  function renderKpi(t) {
    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-8); margin-bottom: var(--space-16);">
        <div class="card" style="padding: var(--space-12);">
          <p class="muted text-xs" style="margin:0; text-transform: uppercase;">Ore totali</p>
          <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 1.4rem; font-weight: 600;">${formatHours(t.total_hours)}</p>
        </div>
        <div class="card" style="padding: var(--space-12);">
          <p class="muted text-xs" style="margin:0; text-transform: uppercase;">Lordo totale</p>
          <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 1.4rem; font-weight: 600;">€ ${fmt(t.total_gross)}</p>
        </div>
        <div class="card" style="padding: var(--space-12);">
          <p class="muted text-xs" style="margin:0; text-transform: uppercase;">Acconti</p>
          <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 1.4rem; font-weight: 600; color: var(--terracotta-dark);">− € ${fmt(t.total_advances)}</p>
        </div>
        <div class="card" style="padding: var(--space-12); background: var(--ink); color: var(--off-white);">
          <p class="text-xs" style="margin:0; text-transform: uppercase; opacity: 0.7; color: inherit;">Da consegnare</p>
          <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 1.4rem; font-weight: 600; color: inherit;">€ ${fmt(t.total_net)}</p>
        </div>
      </div>
    `;
  }

  function renderUserList(rows) {
    if (rows.length === 0) {
      return `<p class="muted" style="text-align: center; padding: var(--space-20); background: var(--cream-soft); border-radius: var(--radius-md);">Nessun dipendente attivo.</p>`;
    }
    return rows.map(renderUserCard).join('');
  }

  function renderUserCard(r) {
    const u = r.user;
    const isFixed = u.pay_type === 'fixed';
    if (r.needs_configuration) {
      const configMsg = isFixed ? '⚠ Stipendio mensile non configurato' : '⚠ Tariffa oraria non configurata';
      return `
        <div class="card" style="padding: var(--space-16); margin-bottom: var(--space-12); border-left: 4px solid var(--warning, #c9942a);">
          <p style="margin: 0; font-weight: 600;">${escapeHtml(u.full_name)}</p>
          <p class="muted text-sm" style="margin: var(--space-8) 0;">${configMsg}</p>
          <p style="margin: 0;">Ore lavorate: <strong>${formatHours(r.total_hours)}</strong></p>
          <p class="muted text-sm" style="margin: var(--space-4) 0 var(--space-12) 0;">Lordo: non calcolabile</p>
          <button type="button" data-config="${u.id}" class="btn btn--secondary btn--sm">Configura compenso</button>
        </div>
      `;
    }
    const unsettledBadge = r.has_unsettled_advances && Number(r.advances_taken) > 0
      ? `<span class="badge" style="background: rgba(201,148,42,0.15); color: var(--warning, #c9942a); margin-left: var(--space-8);">⚠ NON saldati</span>`
      : Number(r.advances_settled_in_month) > 0
        ? `<span class="badge" style="background: rgba(79,142,58,0.15); color: var(--bottle-green, #4f8e3a); margin-left: var(--space-8);">✓ Saldati</span>`
        : '';
    const rateLabel = isFixed
      ? `Fisso mensile: € ${fmt(u.monthly_salary)}`
      : `Tariffa: € ${fmt(u.hourly_rate)}/h${u.weekly_hours_contract ? ` · Contratto: ${formatHours(u.weekly_hours_contract)}h/sett` : ''}`;
    const grossLabel = isFixed
      ? `Fisso mensile`
      : `Lordo (${formatHours(r.total_hours)} × ${fmt(u.hourly_rate)})`;
    return `
      <div class="card" style="padding: var(--space-16); margin-bottom: var(--space-12);">
        <p style="margin: 0; font-weight: 600;">${escapeHtml(u.full_name)}</p>
        <p class="muted text-xs" style="margin: 2px 0 var(--space-12) 0;">${rateLabel}</p>
        <div style="display: grid; gap: var(--space-4); font-size: var(--text-sm);">
          <div class="row" style="justify-content: space-between;"><span class="muted">Ore lavorate</span><span style="font-family: var(--font-display);">${formatHours(r.total_hours)} h</span></div>
          <div class="row" style="justify-content: space-between;"><span class="muted">${grossLabel}</span><span style="font-family: var(--font-display);">€ ${fmt(r.gross_amount)}</span></div>
          <div class="row" style="justify-content: space-between;"><span class="muted">Acconti del mese${unsettledBadge}</span><span style="font-family: var(--font-display); color: var(--terracotta-dark);">− € ${fmt(r.advances_taken)}</span></div>
        </div>
        <div style="border-top: 2px solid var(--ink); margin-top: var(--space-12); padding-top: var(--space-12);">
          <div class="row" style="justify-content: space-between; align-items: baseline;">
            <span style="font-weight: 600;">DA CONSEGNARE</span>
            <span style="font-family: var(--font-display); font-size: 2rem; color: var(--terracotta);">€ ${fmt(r.net_to_pay)}</span>
          </div>
        </div>
        <div class="row" style="gap: var(--space-8); margin-top: var(--space-12); flex-wrap: wrap;">
          ${r.has_unsettled_advances && Number(r.advances_taken) > 0
            ? `<button type="button" data-settle="${u.id}" class="btn btn--primary btn--sm">${icon('check', { size: 14 })} Marca acconti saldati</button>`
            : ''}
          <button type="button" data-detail="${u.id}" class="btn btn--ghost btn--sm">Vedi turni del mese</button>
        </div>
      </div>
    `;
  }

  function wire() {
    container.querySelectorAll('[data-nav]').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.dataset.nav === 'prev') {
          state.month -= 1;
          if (state.month < 1) { state.month = 12; state.year -= 1; }
        } else {
          state.month += 1;
          if (state.month > 12) { state.month = 1; state.year += 1; }
        }
        load();
      });
    });
    container.querySelectorAll('[data-settle]').forEach((b) => {
      b.addEventListener('click', () => openSettleModal(Number(b.dataset.settle)));
    });
    container.querySelectorAll('[data-detail]').forEach((b) => {
      b.addEventListener('click', () => navigate(`/stipendi/${b.dataset.detail}?year=${state.year}&month=${state.month}`));
    });
    container.querySelectorAll('[data-config]').forEach((b) => {
      b.addEventListener('click', () => {
        showToast('Configura tariffa da Impostazioni → Utenti', 'info', 4000);
        navigate('/impostazioni');
      });
    });
  }

  function openSettleModal(userId) {
    const r = state.data.by_user.find((x) => x.user.id === userId);
    if (!r) return;
    const monthLabel = state.data.month_label;
    showModal(
      'Conferma saldo acconti',
      `<p>Marcare i <strong>${countAdvances(r)}</strong> acconti di
       <strong>${escapeHtml(r.user.full_name)}</strong> per
       <strong>€ ${fmt(r.advances_taken)}</strong> come saldati nella busta paga
       di <strong>${escapeHtml(monthLabel)}</strong>?</p>
       <p class="muted text-sm">L'azione è reversibile dalla pagina acconti.</p>`,
      [
        { label: 'Annulla', variant: 'ghost' },
        {
          label: 'Conferma', variant: 'primary', closeOnClick: true,
          onClick: async () => {
            try {
              const res = await apiPost(`/work-shifts/monthly-payroll/${userId}/settle-advances?year=${state.year}&month=${state.month}`, {});
              showToast(`${res.settled_count} acconti saldati per € ${fmt(res.total_settled_amount)}`, 'success');
              await load();
            } catch (err) {
              const msg = err instanceof ApiError && err.message ? err.message : 'Errore';
              showToast(msg, 'danger', 5000);
            }
          },
        },
      ],
    );
  }
}

function countAdvances(r) {
  // Approssimazione: non abbiamo il count esatto qui, ma il backend ce lo
  // restituisce in settled_count nel response al POST.
  return r.has_unsettled_advances ? '' : '';
}

function fmt(v) { const n = Number(v); return Number.isNaN(n) ? '0,00' : n.toFixed(2).replace('.', ','); }
function formatHours(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return '0';
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
