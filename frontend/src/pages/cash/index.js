// /cassa — daily cash dashboard (manager/admin).
//
// Three segmented tabs: Pranzo / Cena / Totale. Each tab reads from
// /daily-summary/{date} (auto-created server-side) and the per-service
// /pos-sessions + /expenses endpoints. Edits route through PATCH/POST.

import { apiGet, apiPost, apiPatch, apiDelete, absoluteUrl, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { userHasRole } from '../../js/auth.js';
import { icon } from '../../js/icons.js';
import { showToast, showModal, confirmDialog, skeletonList } from '../../js/components.js';
import { openClosePosModal, openNumpad } from './modal-close-pos.js';
import { openAddExpenseModal } from './modal-add-expense.js';
import { openAddAdvanceModal } from './modal-add-advance.js';

const WARN_THRESHOLD = 5;     // |delta| in €
const DANGER_THRESHOLD = 20;

export async function mountCashPage(container, _params, query) {
  // "Giornata operativa": tra mezzanotte e le 6:00 → giorno precedente.
  // Vedi businessDayIso() in fondo al file.
  const date = query.date || businessDayIso();
  const isAdmin = userHasRole('admin');

  setHeader({
    title: 'Cassa',
    brand: true,
    backHref: '/',
    actions: [
      { label: 'Storico', iconName: 'calendar', onClick: () => navigate('/cassa/storico') },
      { label: 'Riepilogo', iconName: 'inventory', onClick: () => navigate('/cassa/riepilogo') },
      { label: 'Statistiche', iconName: 'bar-chart', onClick: () => navigate('/cassa/statistiche') },
      { label: 'Acconti', iconName: 'users', onClick: () => navigate('/acconti') },
    ],
  });

  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(3)}</div>`;

  const state = {
    date,
    tab: query.tab || 'lunch',   // 'lunch' | 'dinner' | 'total'
    summary: null,
    posLunch: null,
    posDinner: null,
    expenses: [],
    advances: [],
    loading: true,
  };

  await load();
  return () => {};

  // -----------------------------------------------------------------

  async function load() {
    try {
      const canSeeAdvances = userHasRole('admin', 'manager');
      const [summary, posList, expensesList, advancesList] = await Promise.all([
        apiGet(`/daily-summary/${state.date === todayIso() ? 'today' : state.date}`).catch(async (err) => {
          // GET /{date} returns 404 for past days with no row — fall back to PATCH to seed
          if (err.status === 404) {
            const created = await apiPatch(`/daily-summary/${state.date}`, {});
            return created;
          }
          throw err;
        }),
        apiGet(`/pos-sessions?date=${state.date}`),
        apiGet(`/expenses?date=${state.date}`),
        canSeeAdvances
          ? apiGet(`/advances?from_date=${state.date}&to_date=${state.date}`).catch(() => [])
          : Promise.resolve([]),
      ]);
      state.summary = summary;
      state.posLunch = posList.find((s) => s.service === 'lunch') || null;
      state.posDinner = posList.find((s) => s.service === 'dinner') || null;
      state.expenses = expensesList;
      state.advances = advancesList;
      render();
    } catch (err) {
      container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
        <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
        <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(err.message || '')}</p></div></div></div>`;
    }
  }

  function render() {
    const dateLabel = humanDate(state.date);
    const isToday = state.date === todayIso();
    // Banner "giorno passato" SOLO se è stato l'utente a navigare indietro
    // dal date picker (state.date != giornata operativa corrente).
    const pastBanner = isToday ? '' : `
      <div class="alert alert--info" style="margin-bottom: var(--space-12);">
        <span class="alert__icon">${icon('calendar', { size: 22 })}</span>
        <div class="alert__body" style="display: flex; justify-content: space-between; align-items: center; gap: var(--space-8); flex-wrap: wrap;">
          <span class="alert__text">Stai visualizzando un giorno passato.</span>
          <a href="#/cassa" class="btn btn--ghost btn--sm" data-back-today>← Torna a oggi</a>
        </div>
      </div>`;
    // Banner "siamo dopo mezzanotte, stai chiudendo la giornata di ieri":
    // appare quando la giornata operativa NON coincide col giorno reale
    // (es. sono le 1:30 del 25 ma stiamo chiudendo il 24).
    const isOvernight = isToday && state.date !== realTodayIso();
    const overnightBanner = isOvernight ? `
      <div class="alert alert--info" style="margin-bottom: var(--space-12);">
        <span class="alert__icon">${icon('clock', { size: 22 })}</span>
        <div class="alert__body"><p class="alert__text">Sei nella notte dopo il servizio: ti stiamo mostrando la giornata operativa <strong>${escapeHtml(humanDate(state.date))}</strong> che si sta chiudendo.</p></div>
      </div>` : '';
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
        ${pastBanner}
        ${overnightBanner}

        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-12);">
          <button type="button" id="date-prev" class="btn btn--ghost btn--icon" aria-label="Giorno precedente">${icon('chevron-left', { size: 22 })}</button>
          <button type="button" id="date-pick" style="background: none; border: none; cursor: pointer; padding: var(--space-4) var(--space-12);">
            <p style="margin:0; font-family: var(--font-display); font-size: var(--text-lg); text-transform: capitalize; font-weight: 500;">${escapeHtml(dateLabel)}</p>
          </button>
          <button type="button" id="date-next" class="btn btn--ghost btn--icon" aria-label="Giorno successivo" ${isToday ? 'disabled' : ''}>${icon('chevron-right', { size: 22 })}</button>
        </div>
        <input type="date" id="date-input" style="display:none;" value="${state.date}" max="${businessDayIso()}" />

        ${renderTabs()}

        <div id="cash-body" style="margin-top: var(--space-16);">${renderBody()}</div>
      </section>
    `;
    wire();
  }

  function renderTabs() {
    // Mostra il PARZIALE del servizio (POS + cash netto + spese reincorporate),
    // non solo il POS. Se il cash non è ancora stato compilato, partial_* è null
    // e il tab mostra "—".
    const partialLunch  = state.summary?.partial_lunch  != null ? Number(state.summary.partial_lunch)  : null;
    const partialDinner = state.summary?.partial_dinner != null ? Number(state.summary.partial_dinner) : null;
    const total = state.summary?.computed_total != null ? Number(state.summary.computed_total) : null;
    return `<div class="row" style="gap: var(--space-8);">
      ${tab('lunch', 'Pranzo', partialLunch)}
      ${tab('dinner', 'Cena', partialDinner)}
      ${tab('total', 'Totale', total)}
    </div>`;
  }

  function tab(id, label, amount) {
    const active = state.tab === id;
    const value = amount == null ? '—' : `€ ${amount.toFixed(2).replace('.', ',')}`;
    return `<button type="button" data-tab="${id}" style="
      flex: 1; padding: var(--space-12) var(--space-8); border-radius: var(--radius-md);
      border: 1px solid ${active ? 'var(--terracotta)' : 'var(--border-soft)'};
      background: ${active ? 'var(--terracotta)' : 'var(--off-white)'};
      color: ${active ? 'var(--off-white)' : 'var(--ink)'};
      cursor: pointer; text-align: center;">
      <p style="margin: 0; font-size: var(--text-sm); font-weight: 500;">${escapeHtml(label)}</p>
      <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: var(--text-lg);">${value}</p>
    </button>`;
  }

  function renderBody() {
    if (state.tab === 'total') return renderTotale();
    return renderService(state.tab);
  }

  function renderService(service) {
    const pos = service === 'lunch' ? state.posLunch : state.posDinner;
    const label = service === 'lunch' ? 'Pranzo' : 'Cena';
    const expensesForService = state.expenses.filter((e) => e.service === service);
    const expensesTotal = expensesForService.reduce((s, e) => s + Number(e.amount), 0);
    const canSeeAdvances = userHasRole('admin', 'manager');
    const s = state.summary || {};

    // Cash input + partial config per service
    const isLunch = service === 'lunch';
    const cashField     = isLunch ? 'cash_lunch_above_float' : 'cash_dinner_above_float';
    const cashLabel     = isLunch ? 'Cash extra fondo a fine pranzo' : 'Cash extra fondo a fine serata';
    const cashSub       = isLunch
      ? 'Tutto il contante presente in cassa MENO il fondo, a fine servizio pranzo.'
      : 'Tutto il contante presente in cassa MENO il fondo, a fine serata (include già quello del pranzo).';
    const cashValue     = s[cashField];
    const partialField  = isLunch ? 'partial_lunch' : 'partial_dinner';
    const partialValue  = s[partialField];
    const cashIncassato = isLunch ? s.cash_lunch_incassato : s.cash_dinner_incassato;

    const partialCard = partialValue != null ? `
        <div class="card card--inset" style="background: var(--cream-soft); border: 2px solid var(--terracotta);">
          <p class="muted text-xs uppercase" style="margin:0; letter-spacing: var(--letter-spacing-wide);">Parziale ${escapeHtml(label.toLowerCase())}</p>
          <p class="font-display" style="margin: var(--space-8) 0 0 0; font-size: 2.5rem; color: var(--terracotta); line-height: 1;">€ ${formatMoney(partialValue)}</p>
          <p class="muted text-xs" style="margin: var(--space-8) 0 0 0;">
            POS € ${formatMoney(pos ? pos.closing_amount : 0)}
            + cash netto ${escapeHtml(label.toLowerCase())} € ${formatMoney(cashIncassato || 0)}
            ${isLunch
              ? `<em>(spese pranzo reincorporate)</em>`
              : `<em>(cash fine serata − cash fine pranzo + spese cena reincorporate)</em>`}
          </p>
        </div>
      ` : `
        <div class="card card--inset" style="background: var(--cream-soft); border: 2px dashed var(--border-strong);">
          <p class="muted text-xs uppercase" style="margin:0; letter-spacing: var(--letter-spacing-wide);">Parziale ${escapeHtml(label.toLowerCase())}</p>
          <p class="font-display" style="margin: var(--space-8) 0 0 0; font-size: 2.5rem; color: var(--ink-muted); line-height: 1; opacity: 0.55;">€ —</p>
          <p class="muted text-xs" style="margin: var(--space-8) 0 0 0;">Compila il cash extra fondo per calcolare il totale.</p>
        </div>
      `;

    return `
      <!-- Partial summary on top -->
      ${partialCard}

      <!-- POS card -->
      <div class="card stack-12" style="margin-top: var(--space-16);">
        <div class="row" style="justify-content: space-between;">
          <p class="card__meta" style="margin:0;">POS ${escapeHtml(label)}</p>
          <span class="pill ${pos ? 'pill--success' : ''}" style="white-space:nowrap;">
            ${pos ? 'chiusa' : 'aperta'}
          </span>
        </div>
        <p class="font-display" style="margin:0; font-size: 2rem; line-height: 1;">${pos ? `€ ${formatMoney(pos.closing_amount)}` : '€ 0,00'}</p>
        ${pos
          ? `<div class="row" style="gap: var(--space-8);">
              <p class="muted text-xs" style="margin:0; flex:1;">Chiusa da ${escapeHtml(pos.closed_by_name || '—')} alle ${formatTime(pos.closed_at)}</p>
              <button type="button" id="pos-edit" class="btn btn--ghost btn--sm">${icon('edit', { size: 14 })}<span>Modifica</span></button>
            </div>`
          : `<button type="button" id="pos-close" class="btn btn--primary btn--lg full-width">${icon('check', { size: 18 })}<span>Chiudi sessione POS</span></button>`
        }
      </div>

      <!-- Expenses card -->
      <div class="card stack-12" style="margin-top: var(--space-16);">
        <div class="row" style="justify-content: space-between;">
          <p class="card__meta" style="margin:0;">Spese ${escapeHtml(label)}</p>
          <p class="font-display" style="margin:0; color: var(--terracotta-dark); font-size: var(--text-xl);">
            ${expensesForService.length === 0 ? '€ 0,00' : `− € ${expensesTotal.toFixed(2).replace('.', ',')}`}
          </p>
        </div>
        <p class="muted text-xs" style="margin:0;">${expensesForService.length} voci registrate</p>

        <div class="stack-8">
          ${expensesForService.map(expenseRow).join('') || '<p class="muted text-sm">Nessuna spesa registrata per questo servizio.</p>'}
        </div>

        <button type="button" id="exp-add" class="btn btn--ghost full-width"
                style="border: 2px dashed var(--border-strong); padding: var(--space-12);">
          ${icon('plus', { size: 18 })}<span>Aggiungi spesa</span>
        </button>
      </div>

      ${canSeeAdvances ? renderAdvancesCard(service, label) : ''}

      <!-- Cash input card -->
      <div class="card stack-12" style="margin-top: var(--space-16);">
        <p class="card__meta" style="margin:0;">${escapeHtml(cashLabel)}</p>
        <p class="muted text-xs" style="margin:0;">${escapeHtml(cashSub)}</p>
        <button type="button" data-summary-field="${cashField}"
                style="width: 100%; padding: var(--space-16); border: 1px solid var(--border-soft); border-radius: var(--radius-md); background: var(--cream-soft); cursor: pointer; text-align: left; font-family: var(--font-display); font-size: 2rem; color: var(--ink);">
          ${cashValue != null ? `€ ${formatMoney(cashValue)}` : '<span style="opacity: 0.55; font-style: italic; font-size: 1.2rem;">tap per inserire</span>'}
        </button>
      </div>
    `;
  }

  function expenseRow(e) {
    const catColor = e.category?.color || 'var(--ink-muted)';
    const catName = e.category?.name || `#${e.category_id}`;
    const hasPhoto = !!e.receipt_photo_url;
    return `
      <div class="row" data-exp="${e.id}" style="gap: var(--space-12); padding: var(--space-12) 0; border-top: 1px solid var(--border-soft);">
        <span style="width: 36px; height: 36px; border-radius: 50%; background: ${catColor}22; display: inline-flex; align-items: center; justify-content: center; color: ${catColor}; flex-shrink: 0;">${icon('cash', { size: 18 })}</span>
        <div class="flex-1" style="min-width:0;">
          <p style="margin:0; font-weight: 500;">${escapeHtml(e.description)}</p>
          <p class="muted text-xs" style="margin: var(--space-4) 0 0 0;">${escapeHtml(catName)} ${hasPhoto ? '· 📎 scontrino' : ''}</p>
        </div>
        ${hasPhoto ? `<button type="button" data-photo="${escapeAttr(absoluteUrl(e.receipt_photo_url))}" class="btn btn--ghost btn--icon" aria-label="Vedi scontrino">${icon('eye', { size: 16 })}</button>` : ''}
        <p style="margin:0; font-family: var(--font-display); font-size: var(--text-lg); color: var(--terracotta-dark);">− € ${formatMoney(e.amount)}</p>
        <button type="button" data-exp-del="${e.id}" class="btn btn--ghost btn--icon" aria-label="Elimina">${icon('trash', { size: 14 })}</button>
      </div>
    `;
  }

  function renderAdvancesCard(service, label) {
    const advancesForService = state.advances.filter((a) => a.service === service);
    const advancesTotal = advancesForService.reduce((s, a) => s + Number(a.amount), 0);
    return `
      <div class="card stack-12" style="margin-top: var(--space-16); border-left: 4px solid var(--ink-muted);">
        <div class="row" style="gap: var(--space-12); align-items: baseline;">
          <p class="card__meta" style="margin:0;">Acconti dipendenti ${escapeHtml(label.toLowerCase())}</p>
          <p class="font-display" style="margin:0; color: var(--ink); font-size: var(--text-xl); margin-left: auto;">
            ${advancesForService.length === 0 ? '€ 0,00' : `− € ${advancesTotal.toFixed(2).replace('.', ',')}`}
          </p>
        </div>
        <p class="muted text-xs" style="margin:0;">${advancesForService.length} ${advancesForService.length === 1 ? 'acconto' : 'acconti'} · da detrarre da busta paga</p>

        <div class="stack-8">
          ${advancesForService.map(advanceRow).join('') || '<p class="muted text-sm">Nessun acconto registrato per questo servizio.</p>'}
        </div>

        <button type="button" data-add-advance="${service}" class="btn btn--ghost full-width"
                style="border: 2px dashed var(--border-strong); padding: var(--space-12);">
          ${icon('plus', { size: 18 })}<span>Aggiungi acconto</span>
        </button>
      </div>
    `;
  }

  function advanceRow(a) {
    const settled = !!a.settled_at;
    // Warning se reference_month diverso dal mese di "oggi" (data della cassa)
    const todayMonth = state.date.slice(0, 7);   // 'YYYY-MM'
    const isOtherMonth = a.reference_month && a.reference_month !== todayMonth;
    const refLabel = a.reference_month_label || a.reference_month || '—';
    const refBadge = isOtherMonth
      ? `<span style="display: inline-flex; align-items: center; gap: 2px; padding: 1px var(--space-4); border-radius: 4px; background: rgba(201,148,42,0.18); color: var(--warning, #c9942a); font-size: var(--text-xs);" title="Acconto dato ora ma riferito alla busta di ${escapeHtml(refLabel)}">⚠ ${escapeHtml(refLabel)}</span>`
      : `<span style="color: var(--ink-muted); font-size: var(--text-xs);">${escapeHtml(refLabel)}</span>`;
    return `
      <div class="row" data-adv="${a.id}" style="gap: var(--space-12); padding: var(--space-12) 0; border-top: 1px solid var(--border-soft);">
        <span style="width: 36px; height: 36px; border-radius: 50%; background: var(--cream-soft); display: inline-flex; align-items: center; justify-content: center; color: var(--ink-muted); flex-shrink: 0;">👤</span>
        <div class="flex-1" style="min-width:0;">
          <p style="margin:0; font-weight: 500;">${escapeHtml(a.user?.full_name || `#${a.user?.id}`)}</p>
          <p class="muted text-xs" style="margin: var(--space-4) 0 0 0;">Per stipendio: ${refBadge}${a.notes ? ' · ' + escapeHtml(a.notes) : (settled ? ' · saldato in ' + escapeHtml(a.settled_in_payroll_month) : '')}</p>
        </div>
        <p style="margin:0; font-family: var(--font-display); font-size: var(--text-lg); color: var(--ink);">− € ${formatMoney(a.amount)}</p>
      </div>
    `;
  }

  function renderTotale() {
    const s = state.summary;
    if (!s) return '<p class="muted">Caricamento…</p>';

    const closedBanner = s.status === 'closed'
      ? `<div class="alert alert--info" style="margin-bottom: var(--space-16);">
          <span class="alert__icon">${icon('check', { size: 22 })}</span>
          <div class="alert__body"><strong>Giornata chiusa</strong>
            <p class="alert__text">${s.closed_at ? `Chiusa il ${formatDateTime(s.closed_at)}${s.closed_by_name ? ` da ${escapeHtml(s.closed_by_name)}` : ''}` : ''}</p></div>
        </div>`
      : '';

    const lunchHint = s.partial_lunch == null
      ? '<span style="opacity: 0.6; font-style: italic;">non ancora compilato</span>'
      : `€ ${formatMoney(s.partial_lunch)}`;
    const dinnerHint = s.partial_dinner == null
      ? '<span style="opacity: 0.6; font-style: italic;">non ancora compilato</span>'
      : `€ ${formatMoney(s.partial_dinner)}`;

    return `
      ${closedBanner}

      <!-- Dark summary card -->
      <div style="background: var(--ink); color: var(--off-white); border-radius: var(--radius-xl); padding: var(--space-24); box-shadow: var(--shadow-lg);">
        <p style="margin:0; font-family: var(--font-body); font-size: var(--text-xs); opacity: 0.7; text-transform: uppercase; letter-spacing: var(--letter-spacing-wide); color: inherit;">Totale calcolato</p>
        <p style="margin: var(--space-8) 0 0 0; font-family: var(--font-display); font-size: 3.5rem; font-weight: 600; line-height: 1; color: inherit;">${s.computed_total != null ? `€ ${formatMoney(s.computed_total)}` : '€ —'}</p>

        <!-- Read-only breakdown by service -->
        <div style="margin-top: var(--space-20); padding-top: var(--space-20); border-top: 1px solid rgba(255,255,255,0.15);">
          ${darkRow('Parziale pranzo', lunchHint, 'inserito nel tab Pranzo')}
          ${darkRow('Parziale cena', dinnerHint, 'inserito nel tab Cena')}
          ${Number(s.advances_total || 0) > 0
            ? darkRow('di cui acconti dipendenti', `€ ${formatMoney(s.advances_total)}`, 'da detrarre da busta paga')
            : ''}
          ${s.cash_incassato != null ? `
            <div style="display: flex; justify-content: space-between; padding: var(--space-8) 0; opacity: 0.85; color: inherit;">
              <span style="font-style: italic; color: inherit;">→ Cash incassato (totale)</span>
              <span style="font-style: italic; font-family: var(--font-display); color: inherit;">€ ${formatMoney(s.cash_incassato)}</span>
            </div>` : ''}
          ${darkRow('Fondo cassa', `€ ${formatMoney(s.cash_float)}`, 'snapshot informativo, non entra nei calcoli')}
        </div>

        ${renderDarkExpensesDetail(state.expenses)}

        <div style="margin-top: var(--space-16); padding-top: var(--space-16); border-top: 1px solid rgba(255,255,255,0.15);">
          ${darkCheckRow('Totale fiscale', s.fiscal_total, s.delta_fiscal, 'fiscal_total', 'fiscal')}
          ${darkCheckRow('Totale Ipratico', s.ipratico_total, s.delta_ipratico, 'ipratico_total', 'ipratico')}
        </div>
      </div>
    `;
  }

  function renderDarkExpensesDetail(expenses) {
    if (!expenses || expenses.length === 0) return '';
    const lunchList  = expenses.filter((e) => e.service === 'lunch');
    const dinnerList = expenses.filter((e) => e.service === 'dinner');
    const lunchTot   = lunchList.reduce((acc, e) => acc + Number(e.amount), 0);
    const dinnerTot  = dinnerList.reduce((acc, e) => acc + Number(e.amount), 0);
    const total      = lunchTot + dinnerTot;

    const groupBlock = (title, list, tot) => list.length === 0 ? '' : `
      <div style="margin-top: var(--space-12);">
        <div style="display: flex; justify-content: space-between; align-items: baseline; padding-bottom: var(--space-4); border-bottom: 1px dashed rgba(255,255,255,0.12);">
          <span style="font-size: var(--text-xs); text-transform: uppercase; letter-spacing: var(--letter-spacing-wide); opacity: 0.75;">${escapeHtml(title)} (${list.length})</span>
          <span style="font-family: var(--font-display); color: inherit;">− € ${formatMoney(tot)}</span>
        </div>
        ${list.map(darkExpenseLine).join('')}
      </div>
    `;

    return `
      <div style="margin-top: var(--space-16); padding-top: var(--space-16); border-top: 1px solid rgba(255,255,255,0.15);">
        <div style="display: flex; justify-content: space-between; align-items: baseline;">
          <span style="font-size: var(--text-xs); text-transform: uppercase; letter-spacing: var(--letter-spacing-wide); opacity: 0.75;">Dettaglio spese (${expenses.length})</span>
          <span style="font-family: var(--font-display); color: inherit;">− € ${formatMoney(total)}</span>
        </div>
        ${groupBlock('Pranzo', lunchList, lunchTot)}
        ${groupBlock('Cena', dinnerList, dinnerTot)}
      </div>
    `;
  }

  function darkExpenseLine(e) {
    const cat = e.category?.name ? `<span style="opacity: 0.6;"> · ${escapeHtml(e.category.name)}</span>` : '';
    return `
      <div style="display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-12); padding: var(--space-4) 0; font-size: var(--text-sm);">
        <span style="min-width: 0; flex: 1 1 auto; color: inherit; opacity: 0.95;">${escapeHtml(e.description)}${cat}</span>
        <span style="font-family: var(--font-display); color: inherit; white-space: nowrap; font-variant-numeric: tabular-nums;">− € ${formatMoney(e.amount)}</span>
      </div>
    `;
  }

  function darkRow(label, value, sub = null) {
    return `<div style="display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-12); padding: var(--space-8) 0; color: inherit;">
      <div style="min-width: 0; flex: 1 1 auto;">
        <span style="color: inherit;">${escapeHtml(label)}</span>
        ${sub ? `<p class="text-xs" style="margin: 2px 0 0 0; opacity: 0.6; color: inherit;">${escapeHtml(sub)}</p>` : ''}
      </div>
      <span style="font-family: var(--font-display); color: inherit; white-space: nowrap; flex-shrink: 0;">${value}</span>
    </div>`;
  }

  function darkInputRow(label, value, field, idSuffix) {
    const display = value != null ? `€ ${formatMoney(value)}` : 'tap per inserire';
    return `<button type="button" data-summary-field="${field}" data-summary-id="${idSuffix}"
      style="display: flex; justify-content: space-between; width: 100%; padding: var(--space-12); margin: var(--space-4) 0;
             background: rgba(255,255,255,0.08); border: none; border-radius: var(--radius-md); cursor: pointer; color: inherit;">
      <span>${escapeHtml(label)}</span>
      <span style="font-family: var(--font-display); ${value == null ? 'opacity: 0.6; font-style: italic;' : ''}">${display}</span>
    </button>`;
  }

  function darkCheckRow(label, value, delta, field, idSuffix) {
    const badge = delta == null
      ? '<span style="font-size: var(--text-xs); opacity: 0.6;">—</span>'
      : badgeForDelta(delta);
    const display = value != null ? `€ ${formatMoney(value)}` : 'tap per inserire';
    return `<button type="button" data-summary-field="${field}" data-summary-id="${idSuffix}"
      style="display: flex; align-items: center; gap: var(--space-12); width: 100%; padding: var(--space-12); margin: var(--space-4) 0;
             background: rgba(255,255,255,0.08); border: none; border-radius: var(--radius-md); cursor: pointer; color: inherit;">
      <span style="flex: 1; text-align: left;">${escapeHtml(label)}</span>
      <span style="font-family: var(--font-display); ${value == null ? 'opacity: 0.6; font-style: italic;' : ''}">${display}</span>
      <span>${badge}</span>
    </button>`;
  }

  function badgeForDelta(delta) {
    const abs = Math.abs(Number(delta));
    if (abs < 0.01) return `<span class="badge badge--success">${icon('check', { size: 12 })}<span>match</span></span>`;
    const sign = Number(delta) > 0 ? '+' : '−';
    const formatted = `${sign}€ ${abs.toFixed(2).replace('.', ',')}`;
    if (abs > DANGER_THRESHOLD) return `<span class="badge badge--danger">${formatted}</span>`;
    if (abs > WARN_THRESHOLD) return `<span class="badge badge--warn">${formatted}</span>`;
    return `<span class="badge">${formatted}</span>`;
  }

  // -----------------------------------------------------------------

  function wire() {
    // Date navigation
    container.querySelector('#date-prev')?.addEventListener('click', () => {
      const d = new Date(state.date);
      d.setDate(d.getDate() - 1);
      navigate(`/cassa?date=${d.toISOString().slice(0, 10)}&tab=${state.tab}`, { replace: true });
    });
    container.querySelector('#date-next')?.addEventListener('click', () => {
      const d = new Date(state.date);
      d.setDate(d.getDate() + 1);
      const target = d.toISOString().slice(0, 10);
      if (target <= businessDayIso()) {
        navigate(`/cassa?date=${target}&tab=${state.tab}`, { replace: true });
      }
    });
    const dateInput = container.querySelector('#date-input');
    container.querySelector('#date-pick')?.addEventListener('click', () => {
      dateInput.showPicker?.() || dateInput.click();
    });
    dateInput?.addEventListener('change', () => {
      if (dateInput.value && dateInput.value <= businessDayIso()) {
        navigate(`/cassa?date=${dateInput.value}&tab=${state.tab}`, { replace: true });
      }
    });
    container.querySelector('[data-back-today]')?.addEventListener('click', (e) => {
      e.preventDefault();
      navigate('/cassa', { replace: true });
    });

    container.querySelectorAll('[data-tab]').forEach((b) => {
      b.addEventListener('click', () => {
        state.tab = b.dataset.tab;
        render();
      });
    });

    container.querySelector('#pos-close')?.addEventListener('click', () => {
      const service = state.tab;
      openClosePosModal({
        service,
        currentAmount: 0,
        onSave: async (amount) => {
          await apiPost('/pos-sessions', { date: state.date, service, closing_amount: amount.toFixed(2) });
          showToast(`POS ${service === 'lunch' ? 'pranzo' : 'cena'} chiuso`, 'success');
          await load();
        },
      });
    });
    container.querySelector('#pos-edit')?.addEventListener('click', () => {
      const pos = state.tab === 'lunch' ? state.posLunch : state.posDinner;
      if (!pos) return;
      openClosePosModal({
        service: state.tab,
        currentAmount: Number(pos.closing_amount),
        onSave: async (amount) => {
          try {
            await apiPatch(`/pos-sessions/${pos.id}`, { closing_amount: amount.toFixed(2) });
            showToast('Importo aggiornato', 'success');
            await load();
          } catch (err) {
            if (err instanceof ApiError && err.status === 403) {
              showToast('Solo admin può modificare giorni passati', 'warn');
            } else {
              showToast(err.message || 'Errore', 'danger');
            }
          }
        },
      });
    });

    container.querySelector('#exp-add')?.addEventListener('click', () => {
      openAddExpenseModal({
        service: state.tab,
        date: state.date,
        onCreated: () => load(),
      });
    });
    container.querySelectorAll('[data-add-advance]').forEach((b) => {
      b.addEventListener('click', () => {
        openAddAdvanceModal({
          service: b.dataset.addAdvance,
          date: state.date,
          onSaved: () => load(),
        });
      });
    });
    container.querySelectorAll('[data-exp-del]').forEach((b) => {
      b.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const id = Number(b.dataset.expDel);
        const ok = await confirmDialog('Eliminare la spesa?', 'L\'azione è irreversibile.', { confirmLabel: 'Elimina', danger: true });
        if (!ok) return;
        try {
          await apiDelete(`/expenses/${id}`);
          showToast('Spesa eliminata', 'success');
          await load();
        } catch (err) {
          showToast(err.message || 'Errore', 'danger');
        }
      });
    });
    container.querySelectorAll('[data-photo]').forEach((b) => {
      b.addEventListener('click', () => {
        const url = b.dataset.photo;
        showModal('Foto scontrino', `<div class="center"><img src="${escapeAttr(url)}" alt="Scontrino" style="max-width: 100%; max-height: 70vh; border-radius: var(--radius-md);"></div>`, []);
      });
    });

    // Summary inputs — open a numpad with the right title.
    // Buttons live in both the per-service tabs and the Totale tab.
    const SUMMARY_LABELS = {
      cash_lunch_above_float:  'Cash extra fondo a fine pranzo',
      cash_dinner_above_float: 'Cash extra fondo a fine serata',
      fiscal_total:            'Totale fiscale',
      ipratico_total:          'Totale Ipratico',
    };
    container.querySelectorAll('[data-summary-field]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const field = btn.dataset.summaryField;
        const current = state.summary?.[field];
        openNumpad({
          title: SUMMARY_LABELS[field] || 'Importo',
          initial: current ? Number(current).toFixed(2) : '',
          onConfirm: async (n) => {
            try {
              await apiPatch(`/daily-summary/${state.date}`, { [field]: n.toFixed(2) });
              showToast(`${SUMMARY_LABELS[field]} salvato`, 'success');
              await load();
            } catch (err) {
              showToast(err.message || 'Errore', 'danger', 5000);
            }
          },
        });
      });
    });
  }
}

// ---------- helpers ----------

// "Giornata operativa" del bar: dopo mezzanotte e prima delle 6:00 il bar
// sta ancora chiudendo la serata precedente. Quindi se sono le 1:30 del
// 25 maggio, la cassa che il manager vuole chiudere è quella del 24.
const BUSINESS_DAY_THRESHOLD_HOUR = 6;

function realTodayIso() {
  return new Date().toISOString().slice(0, 10);
}

function businessDayIso() {
  const now = new Date();
  if (now.getHours() < BUSINESS_DAY_THRESHOLD_HOUR) {
    // Backshift di un giorno
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  return realTodayIso();
}

// Alias retro-compatibile per il resto del file: ovunque facciamo confronto
// "stai visualizzando oggi?" intendiamo in realtà "stai visualizzando la
// giornata operativa corrente?".
function todayIso() {
  return businessDayIso();
}
function humanDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function formatMoney(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return n.toFixed(2).replace('.', ',');
}
function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}
function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
