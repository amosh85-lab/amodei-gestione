// /consulenti — export mensile per la consulente del lavoro (solo admin).
//
// Due blocchi di testo copiabili:
//  - "PER CONSULENTE": per dipendente, giorni di ferie (solo se presenti),
//    mancia (sempre, dall'app), giorni di malattia (solo se presenti).
//  - "PER AMOS": per dipendente, Totale (lordo + mance, SENZA bonus) — Ben
//    (inserito a mano in Stipendi → Ben/Dan) — Mancia — Bonus (solo Marco,
//    voce assente per tutti gli altri) — Dan = Totale + Bonus − (Ben + Mancia).
//    Nota: le mance si sottraggono nel Dan perché vengono già girate ai
//    dipendenti durante il mese (non restano nella busta cash di fine mese).
//    Poi gli acconti già dati nel mese (bonifico → scalati dal Ben, contanti
//    → scalati dal Dan) e quindi quanto resta ancora da dare: Ben da dare /
//    Dan da dare.
//
// Dati da: /work-shifts/monthly-payroll (lordo, mance, acconti già presi
// nel mese per metodo), /payroll-splits (Ben), /day-leaves (ferie/
// malattia), bonus calcolato come in payroll/salary-table.js (vedi
// js/manager-bonus.js — unica fonte).

import { apiGet } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { icon } from '../../js/icons.js';
import { showToast, skeletonList } from '../../js/components.js';
import { isBonusEligible, managerBonus, summaryRevenue, monthIso } from '../../js/manager-bonus.js';

export async function mountConsulentiExport(container, _params, query) {
  setHeader({ title: 'Per Consulenti', brand: true, backHref: '/' });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(4)}</div>`;

  const now = new Date();
  const state = {
    year: parseInt(query.year, 10) || now.getFullYear(),
    month: parseInt(query.month, 10) || (now.getMonth() + 1),
    rows: [], monthLabel: '',
  };

  await load();
  return () => {};

  async function load() {
    try {
      const refMonth = `${state.year}-${String(state.month).padStart(2, '0')}`;
      const range = monthIso(state.year, state.month);
      const [payroll, splits, leaves, summaries] = await Promise.all([
        apiGet(`/work-shifts/monthly-payroll?year=${state.year}&month=${state.month}`),
        apiGet(`/payroll-splits?payroll_month=${refMonth}`).catch(() => []),
        apiGet(`/day-leaves?from_date=${range.from}&to_date=${range.to}`).catch(() => []),
        apiGet(`/daily-summary?from=${range.from}&to=${range.to}&limit=31`).catch(() => []),
      ]);
      state.monthLabel = payroll.month_label;
      const splitByUser = {};
      for (const s of splits) splitByUser[s.user_id] = s;
      const leavesByUser = {};
      for (const l of leaves) {
        const bucket = leavesByUser[l.user.id] || (leavesByUser[l.user.id] = { ferie: 0, malattia: 0 });
        if (l.kind === 'ferie') bucket.ferie += 1;
        if (l.kind === 'malattia') bucket.malattia += 1;
      }
      const monthlyRevenue = summaries.reduce((acc, s) => acc + (summaryRevenue(s) ?? 0), 0);
      const bonusAmount = managerBonus(monthlyRevenue);

      state.rows = payroll.by_user.map((r) => {
        const split = splitByUser[r.user.id];
        const ben = split ? Number(split.ben_amount) : 0;
        const tips = Number(r.tips_total) || 0;
        const bonus = isBonusEligible(r.user) && !r.needs_configuration ? bonusAmount : 0;
        const computable = !r.needs_configuration && r.gross_amount != null;
        // "Totale" qui = lordo + mance, SENZA bonus (il bonus è una voce a
        // parte, solo per Marco — vedi commento in testa al file).
        const totale = computable ? Number(r.gross_amount) + tips : null;
        const dan = computable ? (totale + bonus) - (ben + tips) : null;
        const accBonifico = Number(r.advances_bonifico) || 0;
        const accCash = Number(r.advances_cash) || 0;
        // Ben (manuale) e gli acconti non dipendono dalla tariffa configurata:
        // "Ben da dare" resta calcolabile anche se il dipendente non ha
        // hourly_rate/monthly_salary impostato (Dan invece sì, serve il lordo).
        const benDue = ben - accBonifico;
        const danDue = computable ? dan - accCash : null;
        const leave = leavesByUser[r.user.id] || { ferie: 0, malattia: 0 };
        return {
          name: r.user.full_name, computable,
          totale, ben, tips, bonus, dan,
          accBonifico, accCash, benDue, danDue,
          ferieCount: leave.ferie, malattiaCount: leave.malattia,
        };
      });
      render();
    } catch (err) {
      container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
        <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
          <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(err.message || '')}</p></div></div></div>`;
    }
  }

  function render() {
    const consulenteText = buildConsulenteText();
    const amosText = buildAmosText();
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
        ${renderMonthNav()}

        <h2 style="margin: var(--space-12) 0 var(--space-8) 0; font-family: var(--font-display); font-size: var(--text-lg);">Per consulente</h2>
        <p class="muted text-xs" style="margin: 0 0 var(--space-8) 0;">Ferie e malattia, solo se presenti nel mese — mance sempre.</p>
        <div class="card" style="padding: var(--space-12);">
          <pre id="consulente-text" style="margin:0; white-space: pre-wrap; font-size: var(--text-sm);">${escapeHtml(consulenteText)}</pre>
        </div>
        <button type="button" data-copy="consulente" class="btn btn--primary full-width" style="margin-top: var(--space-8);">
          ${icon('copy', { size: 16 })} Copia per consulente
        </button>

        <h2 style="margin: var(--space-24) 0 var(--space-8) 0; font-family: var(--font-display); font-size: var(--text-lg);">Per Amos</h2>
        <p class="muted text-xs" style="margin: 0 0 var(--space-8) 0;">
          Dan = Totale (lordo+mance) + Bonus − (Ben + Mancia): le mance escono dal Dan perché già girate ai dipendenti durante il mese.
          Acconti già dati nel mese scalati dal Ben (bonifico) o dal Dan (contanti) → "Ben/Dan da dare" è quanto resta ancora da versare.
          Controlla i numeri prima di usarli: se la logica non è quella che intendevi, dimmelo e la correggo.
        </p>
        <div class="card" style="padding: var(--space-12);">
          <pre id="amos-text" style="margin:0; white-space: pre-wrap; font-size: var(--text-sm);">${escapeHtml(amosText)}</pre>
        </div>
        <button type="button" data-copy="amos" class="btn btn--primary full-width" style="margin-top: var(--space-8);">
          ${icon('copy', { size: 16 })} Copia per Amos
        </button>
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

  function buildConsulenteText() {
    // Ferie/malattia/mancia non dipendono dalla tariffa configurata: si
    // mostrano sempre, anche per un dipendente senza hourly_rate/
    // monthly_salary impostato.
    const lines = [`PER CONSULENTE — ${state.monthLabel}`, ''];
    for (const r of state.rows) {
      const parts = [];
      if (r.ferieCount > 0) parts.push(`${r.ferieCount} ${r.ferieCount === 1 ? 'giorno' : 'giorni'} di ferie`);
      parts.push(`Mancia € ${fmt(r.tips)}`);
      if (r.malattiaCount > 0) parts.push(`${r.malattiaCount} ${r.malattiaCount === 1 ? 'giorno' : 'giorni'} di malattia`);
      lines.push(`${r.name}: ${parts.join(' - ')}`);
    }
    return lines.join('\n');
  }

  function buildAmosText() {
    const lines = [`PER AMOS — ${state.monthLabel}`, ''];
    for (const r of state.rows) {
      const parts = [
        r.computable ? `€ ${fmt(r.totale)} (comprensivo di mancia)` : 'tariffa non configurata (totale non calcolabile)',
        `Ben € ${fmt(r.ben)}`,
        `Mancia € ${fmt(r.tips)}`,
      ];
      if (r.bonus > 0) parts.push(`Bonus € ${fmt(r.bonus)}`);
      if (r.computable) parts.push(`Dan € ${fmt(r.dan)}`);
      if (r.accBonifico > 0) parts.push(`Acconto bonifico già dato € ${fmt(r.accBonifico)}`);
      if (r.accCash > 0) parts.push(`Acconto contanti già dato € ${fmt(r.accCash)}`);
      parts.push(`Ben da dare € ${fmt(r.benDue)}`);
      if (r.computable) parts.push(`Dan da dare € ${fmt(r.danDue)}`);
      lines.push(`${r.name}: ${parts.join(' - ')}`);
    }
    return lines.join('\n');
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
    container.querySelectorAll('[data-copy]').forEach((b) => {
      b.addEventListener('click', async () => {
        const text = b.dataset.copy === 'consulente' ? buildConsulenteText() : buildAmosText();
        try {
          await copyToClipboard(text);
          showToast('Testo copiato', 'success');
        } catch {
          showToast('Copia non riuscita: seleziona e copia il testo qui sopra', 'warn', 5000);
        }
      });
    });
  }
}

// ---------- helpers ----------

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('execCommand copy failed');
}

function fmt(v) { const n = Number(v); return Number.isNaN(n) ? '0,00' : n.toFixed(2).replace('.', ','); }
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
