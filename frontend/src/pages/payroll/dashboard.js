// /stipendi — monthly payroll dashboard (admin only).
//
// Disclaimer in alto: "stime operative, non busta reale".
// KPI mese + card per dipendente con bottone "Marca acconti saldati"
// che chiama POST /work-shifts/monthly-payroll/{user_id}/settle-advances.

import { apiGet, apiPost, apiUpload, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { icon } from '../../js/icons.js';
import { showModal, showToast, skeletonList, parseNumberInput } from '../../js/components.js';

export async function mountPayrollDashboard(container, _params, query) {
  setHeader({
    title: 'Stipendi',
    brand: true,
    backHref: '/',
    actions: [
      { label: 'Ben / Dan', iconName: 'bar-chart', onClick: () => navigate(`/stipendi/ripartizione?year=${state.year}&month=${state.month}`) },
    ],
  });
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
      const monthlyRange = monthIso(state.year, state.month);
      const [payroll, summaries] = await Promise.all([
        apiGet(`/work-shifts/monthly-payroll?year=${state.year}&month=${state.month}`),
        apiGet(`/daily-summary?from=${monthlyRange.from}&to=${monthlyRange.to}&limit=365`).catch(() => []),
      ]);
      const monthlyRevenue = summaries.reduce((acc, s) => acc + (summaryRevenue(s) ?? 0), 0);
      applyManagerBonus(payroll, monthlyRevenue);
      state.data = payroll;
      state.monthlyRevenue = monthlyRevenue;
      render();
    } catch (err) {
      container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
        <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
          <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(err.message || '')}</p></div></div></div>`;
    }
  }

  // Bonus manager: dopo i 40.000 € di incasso mensile, +250 €. Ogni 5.000 €
  // sopra la soglia, altri 250 €. Applicato SOLO a Marco (identificato per
  // email): gli altri manager in organico non hanno questo bonus.
  function applyManagerBonus(payroll, monthlyRevenue) {
    const bonus = managerBonus(monthlyRevenue);
    let bonusAdded = 0;
    for (const r of payroll.by_user) {
      r.bonus_amount = 0;
      if (!isBonusEligible(r.user) || r.needs_configuration) continue;
      r.bonus_amount = bonus;
      if (bonus > 0 && r.net_to_pay != null) {
        r.net_to_pay = Number(r.net_to_pay) + bonus;
        r.gross_amount = (Number(r.gross_amount) || 0) + bonus;
        bonusAdded += bonus;
      }
    }
    if (bonusAdded > 0) {
      payroll.totals.total_gross = Number(payroll.totals.total_gross || 0) + bonusAdded;
      payroll.totals.total_net   = Number(payroll.totals.total_net   || 0) + bonusAdded;
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
    // Bonus manager: la voce "Lordo (X h × Y)" mostra il lordo CON bonus
    // incluso (vedi applyManagerBonus); separiamo la riga bonus per chiarezza.
    const hasBonus = Number(r.bonus_amount) > 0;
    const bonusLine = hasBonus ? `
      <div class="row" style="justify-content: space-between;">
        <span class="muted">Bonus incasso <span class="text-xs">(${managerBonusLabel(state.monthlyRevenue)})</span></span>
        <span style="font-family: var(--font-display); color: var(--bottle-green, #4f8e3a);">+ € ${fmt(r.bonus_amount)}</span>
      </div>` : '';
    // Quando c'è il bonus, mostro il lordo base (senza bonus) accanto, così
    // l'utente vede da dove parte e cosa si aggiunge.
    const baseGross = hasBonus ? Number(r.gross_amount) - Number(r.bonus_amount) : Number(r.gross_amount);
    return `
      <div class="card" style="padding: var(--space-16); margin-bottom: var(--space-12);">
        <p style="margin: 0; font-weight: 600;">${escapeHtml(u.full_name)}</p>
        <p class="muted text-xs" style="margin: 2px 0 var(--space-12) 0;">${rateLabel}</p>
        <div style="display: grid; gap: var(--space-4); font-size: var(--text-sm);">
          <div class="row" style="justify-content: space-between;"><span class="muted">Ore lavorate</span><span style="font-family: var(--font-display);">${formatHours(r.total_hours)} h</span></div>
          <div class="row" style="justify-content: space-between;"><span class="muted">${grossLabel}</span><span style="font-family: var(--font-display);">€ ${fmt(baseGross)}</span></div>
          ${bonusLine}
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
          <button type="button" data-addadv="${u.id}" class="btn btn--secondary btn--sm">${icon('cash', { size: 14 })} Aggiungi acconto</button>
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
    container.querySelectorAll('[data-addadv]').forEach((b) => {
      b.addEventListener('click', () => openAdvanceModal(Number(b.dataset.addadv)));
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

  // -----------------------------------------------------------------
  // Aggiungi acconto manuale (cash o bonifico)

  function openAdvanceModal(userId) {
    const r = state.data.by_user.find((x) => x.user.id === userId);
    if (!r) return;
    const refMonth = `${state.year}-${String(state.month).padStart(2, '0')}`;
    const today = new Date().toISOString().slice(0, 10);
    const body = `
      <form id="adv-form" class="stack-12">
        <p class="muted text-sm" style="margin:0;">Acconto per <strong>${escapeHtml(r.user.full_name)}</strong>, riferito allo stipendio di <strong>${escapeHtml(state.data.month_label)}</strong>.</p>
        <div class="form-row">
          <label class="label label--required">Metodo</label>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap: var(--space-8);">
            <label style="display:flex;align-items:center;gap:var(--space-4);padding:var(--space-8);border:1px solid var(--border-soft);border-radius:var(--radius-md);cursor:pointer;">
              <input type="radio" name="adv-method" value="cash" checked> Contanti
            </label>
            <label style="display:flex;align-items:center;gap:var(--space-4);padding:var(--space-8);border:1px solid var(--border-soft);border-radius:var(--radius-md);cursor:pointer;">
              <input type="radio" name="adv-method" value="bonifico"> Bonifico
            </label>
          </div>
        </div>
        <div class="form-row">
          <label class="label label--required" for="adv-amount">Importo (€)</label>
          <input id="adv-amount" class="input" type="number" min="0.01" step="0.01" inputmode="decimal" required placeholder="es. 200,00" />
        </div>
        <div class="form-row">
          <label class="label label--required" for="adv-date">Data</label>
          <input id="adv-date" class="input" type="date" value="${today}" required />
        </div>
        <div class="form-row">
          <label class="label" for="adv-notes">Note (opzionale)</label>
          <textarea id="adv-notes" class="textarea" rows="2" maxlength="500"></textarea>
        </div>
      </form>
    `;
    showModal('Aggiungi acconto', body, [
      { label: 'Annulla', variant: 'ghost' },
      {
        label: 'Salva',
        variant: 'primary',
        closeOnClick: false,
        onClick: async () => {
          const method = document.querySelector('input[name="adv-method"]:checked')?.value;
          const amount = document.getElementById('adv-amount').value;
          const datePaid = document.getElementById('adv-date').value;
          const notes = document.getElementById('adv-notes').value.trim();
          if (!method) { showToast('Seleziona il metodo', 'warn'); return; }
          if (!(Number(amount) > 0)) { showToast('Importo non valido', 'warn'); return; }
          if (!datePaid) { showToast('Inserisci la data', 'warn'); return; }
          const fd = new FormData();
          fd.append('user_id', String(userId));
          fd.append('amount', amount);
          fd.append('service', 'lunch'); // richiesto NOT NULL, irrilevante per il calcolo Ben/Dan
          fd.append('date', datePaid);
          fd.append('reference_month', refMonth);
          fd.append('payment_method', method);
          if (notes) fd.append('notes', notes);
          try {
            await apiUpload('/advances', fd);
            showToast('Acconto registrato', 'success');
            document.querySelectorAll('.modal-backdrop').forEach((bd) => bd.remove());
            await load();
          } catch (err) {
            const msg = err instanceof ApiError && err.message ? err.message : 'Errore';
            showToast(msg, 'danger', 5000);
          }
        },
      },
    ]);
  }

  // Ben/Dan è su /stipendi/ripartizione — vedi pages/payroll/ben-dan.js
}

function countAdvances(r) {
  // Approssimazione: non abbiamo il count esatto qui, ma il backend ce lo
  // restituisce in settled_count nel response al POST.
  return r.has_unsettled_advances ? '' : '';
}

// ---- Manager bonus -----------------------------------------------------
// Soglia 40.000 €/mese: scatta 250 €. Ogni 5.000 € sopra soglia: altri 250 €.
// Solo per Marco (gli altri manager in organico non hanno questo accordo).
const BONUS_THRESHOLD = 40000;
const BONUS_STEP      = 5000;
const BONUS_PER_TIER  = 250;
const BONUS_ELIGIBLE_EMAILS = new Set([
  'marco.sanarighi86@icloud.com',
]);

function isBonusEligible(user) {
  return !!user && BONUS_ELIGIBLE_EMAILS.has((user.email || '').toLowerCase());
}

function managerBonus(monthlyRevenue) {
  const rev = Number(monthlyRevenue) || 0;
  if (rev < BONUS_THRESHOLD) return 0;
  const tiers = Math.floor((rev - BONUS_THRESHOLD) / BONUS_STEP) + 1;
  return tiers * BONUS_PER_TIER;
}

function managerBonusLabel(monthlyRevenue) {
  const rev = Number(monthlyRevenue) || 0;
  if (rev < BONUS_THRESHOLD) return `sotto soglia 40k`;
  const tiers = Math.floor((rev - BONUS_THRESHOLD) / BONUS_STEP) + 1;
  return `${tiers} × 250 € · incassi € ${fmt(rev)}`;
}

function summaryRevenue(s) {
  if (!s) return null;
  const v = s.computed_total ?? s.fiscal_total ?? (Number(s.pos_total) > 0 ? s.pos_total : null);
  return v != null ? Number(v) : null;
}

function monthIso(year, month /* 1-indexed */) {
  const first = new Date(year, month - 1, 1);
  const last  = new Date(year, month, 0);
  const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: f(first), to: f(last) };
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
