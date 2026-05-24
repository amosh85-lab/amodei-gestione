// /stipendi/:user_id?year=YYYY&month=M — dettaglio mensile di un singolo dipendente (admin only).

import { apiGet, apiPost, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { icon } from '../../js/icons.js';
import { showModal, showToast, skeletonList } from '../../js/components.js';

export async function mountPayrollUserDetail(container, params, query) {
  const userId = Number(params.user_id);
  const now = new Date();
  const year = parseInt(query.year, 10) || now.getFullYear();
  const month = parseInt(query.month, 10) || (now.getMonth() + 1);

  setHeader({ title: 'Dettaglio stipendio', brand: true, backHref: '/stipendi' });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(4)}</div>`;

  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEnd = new Date(year, month, 0).toISOString().slice(0, 10);
  const payrollStr = `${year}-${String(month).padStart(2, '0')}`;

  let payroll, shifts, advances;
  try {
    [payroll, shifts, advances] = await Promise.all([
      apiGet(`/work-shifts/monthly-payroll?year=${year}&month=${month}`),
      apiGet(`/work-shifts?from_date=${monthStart}&to_date=${monthEnd}&user_id=${userId}`),
      apiGet(`/advances?user_id=${userId}&reference_month=${payrollStr}`),
    ]);
  } catch (err) {
    container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
      <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
        <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(err.message || '')}</p></div></div></div>`;
    return;
  }

  const r = payroll.by_user.find((x) => x.user.id === userId);
  if (!r) {
    container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
      <p class="muted">Dipendente non trovato nel mese ${escapeHtml(payroll.month_label)}.</p></div>`;
    return;
  }
  const u = r.user;
  const totalHours = Number(r.total_hours);

  container.innerHTML = `
    <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
      <div class="card" style="padding: var(--space-16); margin-bottom: var(--space-16);">
        <p style="margin: 0; font-weight: 600; font-size: 1.2rem;">${escapeHtml(u.full_name)}</p>
        <p class="muted text-xs" style="margin: 2px 0 0 0;">${escapeHtml(payroll.month_label)}</p>
        ${u.hourly_rate != null ? `<p class="muted text-sm" style="margin: var(--space-8) 0 0 0;">Tariffa: € ${fmt(u.hourly_rate)}/h${u.weekly_hours_contract ? ` · Contratto: ${formatHours(u.weekly_hours_contract)}h/sett` : ''}</p>` : '<p class="muted text-sm" style="margin: var(--space-8) 0 0 0;">⚠ Nessuna tariffa configurata</p>'}
      </div>

      <h2 style="margin: var(--space-12) 0 var(--space-8) 0; font-family: var(--font-display); font-size: var(--text-lg);">Calcolo</h2>
      <div class="card" style="padding: var(--space-16); margin-bottom: var(--space-16);">
        <div class="row" style="justify-content: space-between;"><span>Ore totali</span><span style="font-family: var(--font-display);">${formatHours(totalHours)} h</span></div>
        <div class="row" style="justify-content: space-between; margin-top: var(--space-4);"><span>Tariffa applicata</span><span style="font-family: var(--font-display);">€ ${fmt(u.hourly_rate)}/h</span></div>
        <div class="row" style="justify-content: space-between; margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--border-soft);"><span>Lordo</span><span style="font-family: var(--font-display);">€ ${fmt(r.gross_amount)}</span></div>
        <div class="row" style="justify-content: space-between; margin-top: var(--space-4);"><span>Acconti mese (ref ${escapeHtml(payrollStr)})</span><span style="font-family: var(--font-display); color: var(--terracotta-dark);">− € ${fmt(r.advances_taken)}</span></div>
        <div class="row" style="justify-content: space-between; margin-top: var(--space-12); padding-top: var(--space-12); border-top: 2px solid var(--ink); font-weight: 600;">
          <span>NETTO DA CONSEGNARE</span>
          <span style="font-family: var(--font-display); font-size: 1.6rem; color: var(--terracotta);">€ ${fmt(r.net_to_pay)}</span>
        </div>
        ${r.has_unsettled_advances && Number(r.advances_taken) > 0 ? `<button type="button" id="settle-btn" class="btn btn--primary full-width" style="margin-top: var(--space-12);">${icon('check', { size: 16 })}<span>Marca acconti saldati</span></button>` : ''}
      </div>

      <h2 style="margin: var(--space-20) 0 var(--space-8) 0; font-family: var(--font-display); font-size: var(--text-lg);">Riepilogo settimanale</h2>
      <div class="card" style="padding: var(--space-12); margin-bottom: var(--space-16);">
        ${r.weekly_breakdown.map((w) => `
          <div style="display: flex; justify-content: space-between; padding: var(--space-8) 0; ${Number(w.overtime) > 0 ? 'color: var(--warning, #c9942a);' : ''} ${w.week_start === r.weekly_breakdown[0].week_start ? '' : 'border-top: 1px solid var(--border-soft);'}">
            <span class="text-sm">${formatDateShort(w.week_start)} − ${formatDateShort(w.week_end)}</span>
            <span style="font-family: var(--font-display);">${formatHours(w.hours)}h ${Number(w.overtime) > 0 ? `· +${formatHours(w.overtime)}h ⚠` : ''}</span>
          </div>
        `).join('')}
      </div>

      <h2 style="margin: var(--space-20) 0 var(--space-8) 0; font-family: var(--font-display); font-size: var(--text-lg);">Turni del mese (${shifts.length})</h2>
      ${shifts.length === 0
        ? '<p class="muted" style="text-align: center; padding: var(--space-16); background: var(--cream-soft); border-radius: var(--radius-md);">Nessun turno.</p>'
        : `<div class="card" style="padding: 0; margin-bottom: var(--space-16);">${shifts.map((sh, i) => `
            <div style="padding: var(--space-12) var(--space-16); ${i > 0 ? 'border-top: 1px solid var(--border-soft);' : ''}">
              <div class="row" style="justify-content: space-between; align-items: baseline;">
                <span>${formatDate(sh.date)}</span>
                <span style="font-family: var(--font-display);">${formatHours(sh.hours)}h</span>
              </div>
              ${sh.notes ? `<p class="muted text-xs" style="margin: 2px 0 0 0;">${escapeHtml(sh.notes)}</p>` : ''}
            </div>
          `).join('')}</div>`}

      <h2 style="margin: var(--space-20) 0 var(--space-8) 0; font-family: var(--font-display); font-size: var(--text-lg);">Acconti del mese (${advances.length})</h2>
      ${advances.length === 0
        ? '<p class="muted" style="text-align: center; padding: var(--space-16); background: var(--cream-soft); border-radius: var(--radius-md);">Nessun acconto.</p>'
        : `<div class="card" style="padding: 0;">${advances.map((a, i) => `
            <div style="padding: var(--space-12) var(--space-16); ${i > 0 ? 'border-top: 1px solid var(--border-soft);' : ''}">
              <div class="row" style="justify-content: space-between; align-items: baseline;">
                <span>${formatDate(a.date)}${a.notes ? ' · ' + escapeHtml(a.notes) : ''}</span>
                <span style="font-family: var(--font-display);">€ ${fmt(a.amount)}</span>
              </div>
              <p class="muted text-xs" style="margin: 2px 0 0 0;">${a.settled_at ? `✓ Saldato in ${escapeHtml(a.settled_in_payroll_month)}` : 'Da saldare'}</p>
            </div>
          `).join('')}</div>`}
    </section>
  `;

  document.getElementById('settle-btn')?.addEventListener('click', () => {
    showModal(
      'Conferma saldo',
      `<p>Marcare gli acconti del mese di <strong>${escapeHtml(u.full_name)}</strong>
       (€ ${fmt(r.advances_taken)}) come saldati nella busta di <strong>${escapeHtml(payroll.month_label)}</strong>?</p>`,
      [
        { label: 'Annulla', variant: 'ghost' },
        {
          label: 'Conferma', variant: 'primary', closeOnClick: true,
          onClick: async () => {
            try {
              const res = await apiPost(`/work-shifts/monthly-payroll/${userId}/settle-advances?year=${year}&month=${month}`, {});
              showToast(`${res.settled_count} acconti saldati per € ${fmt(res.total_settled_amount)}`, 'success');
              navigate(`/stipendi/${userId}?year=${year}&month=${month}`);
            } catch (err) {
              showToast(err.message || 'Errore', 'danger', 5000);
            }
          },
        },
      ],
    );
  });
}

function fmt(v) { const n = Number(v); return Number.isNaN(n) ? '0,00' : n.toFixed(2).replace('.', ','); }
function formatHours(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return '0';
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
function formatDate(iso) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function formatDateShort(iso) { const [y, m, d] = iso.split('-'); return `${d}/${m}`; }
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
