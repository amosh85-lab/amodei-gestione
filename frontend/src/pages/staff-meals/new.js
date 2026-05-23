// /pasti-staff/nuovo — multi-step wizard.

import { apiGet, apiPost, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { getCurrentUser, userHasRole } from '../../js/auth.js';
import { icon } from '../../js/icons.js';
import { showToast, confirmDialog } from '../../js/components.js';
import { initials } from './list.js';

const STEPS = [
  { id: 1, title: 'Quando' },
  { id: 2, title: 'Chi mangia' },
  { id: 3, title: 'Cosa' },
  { id: 4, title: 'Note e conferma' },
];

export async function mountStaffMealsNew(container) {
  setHeader({
    title: 'Nuovo pasto',
    brand: true,
    backHref: '/pasti-staff',
  });

  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
    <div class="card stack-12"><div class="skeleton skeleton--title"></div><div class="skeleton skeleton--block"></div></div>
  </div>`;

  const me = getCurrentUser();
  const isManagerOrAdmin = userHasRole('admin', 'manager');

  let users = [], products = [];
  try {
    [users, products] = await Promise.all([
      apiGet('/users'),
      apiGet('/products?active=true'),
    ]);
  } catch (err) {
    container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
      <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
      <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(err.message || '')}</p></div></div></div>`;
    return;
  }

  const productsById = new Map(products.map((p) => [p.id, p]));
  const usersById = new Map(users.map((u) => [u.id, u]));

  const state = {
    step: 1,
    date: new Date().toISOString().slice(0, 10),
    service: 'lunch',
    participant_user_ids: isManagerOrAdmin ? [] : [me.id],
    items: [],   // [{product_id, qty}]
    notes: '',
  };

  render();
  return () => {};

  // -----------------------------------------------------------------

  function render() {
    const s = state.step;
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-20); padding-bottom: 140px;">
        <div class="row" style="gap: 4px;">
          ${STEPS.map((st) => `<div style="flex:1; height:4px; border-radius:2px; background:${st.id <= s ? 'var(--terracotta)' : 'var(--border-soft)'};"></div>`).join('')}
        </div>
        <p class="muted text-xs uppercase" style="margin-top: var(--space-12); letter-spacing: var(--letter-spacing-wide);">
          Passo ${s} / 4 · ${escapeHtml(STEPS[s - 1].title)}
        </p>
        <div id="body" class="card stack-16" style="margin-top: var(--space-16);">${stepBody(s)}</div>
        <div class="row" style="margin-top: var(--space-20); justify-content: space-between; gap: var(--space-12);">
          <button type="button" id="back" class="btn btn--ghost" ${s === 1 ? 'disabled' : ''}>${icon('chevron-left', { size: 18 })}<span>Indietro</span></button>
          ${s < 4
            ? `<button type="button" id="next" class="btn btn--primary">${icon('chevron-right', { size: 18 })}<span>Avanti</span></button>`
            : `<button type="button" id="submit" class="btn btn--primary btn--lg">${icon('check', { size: 18 })}<span>Registra pasto</span></button>`}
        </div>
      </section>
    `;
    wire();
  }

  function stepBody(s) {
    if (s === 1) return step1();
    if (s === 2) return step2();
    if (s === 3) return step3();
    if (s === 4) return step4();
    return '';
  }

  function step1() {
    return `
      <h3 class="card__title" style="margin:0;">Quando si è mangiato?</h3>
      <div class="form-row">
        <label class="label" for="d-date">Data</label>
        <input id="d-date" class="input" type="date" value="${escapeAttr(state.date)}" />
      </div>
      <div class="form-row">
        <label class="label">Servizio</label>
        <div class="row" style="gap: var(--space-8);">
          <button type="button" data-svc="lunch" class="pill ${state.service === 'lunch' ? 'pill--success' : ''}" style="cursor:pointer; border:none;">Pranzo</button>
          <button type="button" data-svc="dinner" class="pill ${state.service === 'dinner' ? 'pill--success' : ''}" style="cursor:pointer; border:none;">Cena</button>
        </div>
      </div>
    `;
  }

  function step2() {
    if (!isManagerOrAdmin) {
      return `
        <h3 class="card__title" style="margin:0;">Partecipanti</h3>
        <div class="card card--inset stack-8">
          <div class="row" style="gap: var(--space-12);">
            <span style="width:40px; height:40px; border-radius:50%; background: var(--terracotta); color: var(--off-white); display:inline-flex; align-items:center; justify-content:center; font-weight:600;">${escapeHtml(initials(me.full_name || me.email))}</span>
            <span>${escapeHtml(me.full_name || me.email)}</span>
          </div>
        </div>
        <p class="muted text-sm">Puoi registrare un pasto solo per te stesso. Per pasti di gruppo chiedi a un manager.</p>
      `;
    }
    const selected = new Set(state.participant_user_ids);
    return `
      <h3 class="card__title" style="margin:0;">Chi ha mangiato?</h3>
      <p class="muted text-sm">Tocca uno o più membri del team.</p>
      <div class="stack-8">${users.map((u) => `
        <button type="button" data-user="${u.id}" class="card" style="width:100%; text-align:left; cursor:pointer; padding: var(--space-12) var(--space-16); ${selected.has(u.id) ? 'border: 2px solid var(--terracotta);' : ''}">
          <div class="row" style="gap: var(--space-12);">
            <span style="width:36px; height:36px; border-radius:50%; background:${selected.has(u.id) ? 'var(--terracotta)' : 'var(--ink-muted)'}; color: var(--off-white); display:inline-flex; align-items:center; justify-content:center; font-weight:600;">${escapeHtml(initials(u.full_name))}</span>
            <span class="flex-1">${escapeHtml(u.full_name)} <span class="muted text-xs">(${u.role})</span></span>
            ${selected.has(u.id) ? icon('check', { size: 18 }) : ''}
          </div>
        </button>
      `).join('')}</div>
      <p class="muted text-sm">Selezionati: <strong>${selected.size}</strong></p>
    `;
  }

  function step3() {
    return `
      <h3 class="card__title" style="margin:0;">Cosa è stato consumato?</h3>
      <div class="form-row">
        <label class="label" for="add-prod">Aggiungi prodotto</label>
        <div class="input-group">
          <span class="input-group__icon">${icon('search', { size: 18 })}</span>
          <input id="add-prod" class="input" placeholder="Cerca prodotto…" list="products-dl" />
          <datalist id="products-dl">
            ${products.map((p) => `<option value="${escapeAttr(p.name)}" data-id="${p.id}"></option>`).join('')}
          </datalist>
        </div>
      </div>
      <h4 class="muted text-xs uppercase" style="letter-spacing: var(--letter-spacing-wide); margin: var(--space-8) 0 0 0;">Prodotti aggiunti</h4>
      <div id="items-list" class="stack-8">${itemsList()}</div>
      ${isManagerOrAdmin ? previewCost() : ''}
    `;
  }

  function itemsList() {
    if (state.items.length === 0) {
      return `<p class="muted text-sm">Nessun prodotto ancora.</p>`;
    }
    return state.items.map((it, i) => {
      const p = productsById.get(it.product_id);
      if (!p) return '';
      return `<div class="card" data-item="${i}">
        <div class="row" style="gap: var(--space-12); align-items: flex-end;">
          <div class="flex-1" style="min-width:0;">
            <p class="font-display text-base" style="margin:0;">${escapeHtml(p.name)}</p>
            <p class="muted text-xs" style="margin:0;">${escapeHtml(p.unit)} · scorta ${formatQty(p.qty_total)}</p>
          </div>
          <input class="input" type="number" min="0.01" step="0.01" inputmode="decimal" value="${escapeAttr(it.qty)}" data-qty="${i}" style="width: 88px; text-align: right; font-family: var(--font-display);" />
          <span class="muted text-xs" style="min-width: 24px;">${escapeHtml(p.unit)}</span>
          <button type="button" class="btn btn--ghost btn--icon" data-remove="${i}" aria-label="Rimuovi">${icon('trash', { size: 16 })}</button>
        </div>
      </div>`;
    }).join('');
  }

  function previewCost() {
    let cost = 0;
    let costKnown = true;
    for (const it of state.items) {
      const p = productsById.get(it.product_id);
      if (!p) continue;
      if (p.last_purchase_price == null) { costKnown = false; continue; }
      cost += Number(p.last_purchase_price) * Number(it.qty);
    }
    const display = costKnown && state.items.length > 0
      ? `€ ${cost.toFixed(2)}`
      : (state.items.length === 0 ? '—' : '€ — (qualche prodotto non ha last_purchase_price)');
    return `<div class="card card--inset" style="margin-top: var(--space-12);">
      <p class="muted text-xs uppercase" style="margin:0; letter-spacing: var(--letter-spacing-wide);">Costo stimato</p>
      <p class="font-display text-2xl" style="margin: var(--space-4) 0 0 0;">${display}</p>
    </div>`;
  }

  function step4() {
    const svc = state.service === 'lunch' ? 'Pranzo' : 'Cena';
    const userNames = state.participant_user_ids.map((id) => usersById.get(id)?.full_name || `#${id}`).join(', ');
    const itemsStr = state.items.map((it) => {
      const p = productsById.get(it.product_id);
      return `${it.qty} ${p?.unit || ''} ${p?.name || `#${it.product_id}`}`;
    }).join(', ');
    return `
      <h3 class="card__title" style="margin:0;">Riepilogo</h3>
      <div class="stack-8">
        ${recapRow('Quando', `${state.date} · ${svc}`)}
        ${recapRow('Chi', userNames)}
        ${recapRow('Cosa', itemsStr || '—')}
      </div>
      <div class="form-row">
        <label class="label" for="d-notes">Note (facoltativo)</label>
        <textarea id="d-notes" class="textarea" maxlength="500">${escapeHtml(state.notes)}</textarea>
      </div>
      ${isManagerOrAdmin ? previewCost() : ''}
    `;
  }

  function recapRow(label, value) {
    return `<div class="row" style="gap: var(--space-12); padding: var(--space-8) 0; border-top: 1px solid var(--border-soft);">
      <span class="muted text-xs uppercase" style="min-width: 80px; letter-spacing: var(--letter-spacing-wide);">${escapeHtml(label)}</span>
      <span class="flex-1 text-sm">${escapeHtml(value)}</span>
    </div>`;
  }

  function wire() {
    const back = container.querySelector('#back');
    if (back) back.addEventListener('click', () => { if (state.step > 1) { state.step--; render(); } });
    const next = container.querySelector('#next');
    if (next) next.addEventListener('click', () => { if (validateStep()) { state.step++; render(); } });
    const submit = container.querySelector('#submit');
    if (submit) submit.addEventListener('click', doSubmit);

    const dateEl = container.querySelector('#d-date');
    if (dateEl) dateEl.addEventListener('change', (e) => { state.date = e.target.value; });
    container.querySelectorAll('[data-svc]').forEach((b) => {
      b.addEventListener('click', () => { state.service = b.dataset.svc; render(); });
    });
    container.querySelectorAll('[data-user]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = Number(b.dataset.user);
        const set = new Set(state.participant_user_ids);
        if (set.has(id)) set.delete(id); else set.add(id);
        state.participant_user_ids = [...set];
        render();
      });
    });
    const addProd = container.querySelector('#add-prod');
    if (addProd) addProd.addEventListener('change', (e) => {
      const opt = document.querySelector(`#products-dl option[value="${cssEscape(e.target.value)}"]`);
      if (!opt) return;
      const pid = Number(opt.dataset.id);
      if (state.items.find((x) => x.product_id === pid)) {
        showToast('Prodotto già aggiunto', 'warn');
        e.target.value = '';
        return;
      }
      state.items.push({ product_id: pid, qty: '1' });
      e.target.value = '';
      render();
    });
    container.querySelectorAll('[data-qty]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const i = Number(e.target.dataset.qty);
        state.items[i].qty = e.target.value;
        const previewEl = container.querySelector('.card--inset');
        if (previewEl) previewEl.outerHTML = previewCost();
      });
    });
    container.querySelectorAll('[data-remove]').forEach((b) => {
      b.addEventListener('click', () => {
        const i = Number(b.dataset.remove);
        state.items.splice(i, 1);
        render();
      });
    });
    const notesEl = container.querySelector('#d-notes');
    if (notesEl) notesEl.addEventListener('input', (e) => { state.notes = e.target.value; });
  }

  function validateStep() {
    if (state.step === 1 && !state.date) {
      showToast('Inserisci una data', 'warn'); return false;
    }
    if (state.step === 2) {
      if (state.participant_user_ids.length === 0) {
        showToast('Seleziona almeno un partecipante', 'warn'); return false;
      }
    }
    if (state.step === 3) {
      if (state.items.length === 0) {
        showToast('Aggiungi almeno un prodotto', 'warn'); return false;
      }
      for (const it of state.items) {
        if (!(parseFloat(it.qty) > 0)) {
          showToast('Quantità non valida', 'warn'); return false;
        }
      }
    }
    return true;
  }

  async function doSubmit() {
    if (!validateStep()) return;
    const ok = await confirmDialog(
      'Confermi la registrazione?',
      `Saranno scaricate le quantità dei prodotti dal magazzino.`,
      { confirmLabel: 'Registra', cancelLabel: 'Annulla' },
    );
    if (!ok) return;

    const btn = container.querySelector('#submit');
    btn.disabled = true;
    const lbl = btn.querySelector('span');
    const orig = lbl.textContent;
    lbl.textContent = 'Registrazione…';

    try {
      const payload = {
        date: state.date,
        service: state.service,
        participant_user_ids: state.participant_user_ids,
        items: state.items.map((it) => ({ product_id: it.product_id, qty: Number(it.qty) })),
        notes: state.notes || null,
      };
      await apiPost('/staff-meals', payload, { timeoutMs: 30000 });
      showToast('Pasto registrato', 'success');
      navigate('/pasti-staff', { replace: true });
    } catch (err) {
      btn.disabled = false;
      lbl.textContent = orig;
      showToast(err.message || 'Errore registrazione', 'danger', 6000);
    }
  }
}

function formatQty(qty) {
  const n = Number(qty);
  if (Number.isNaN(n)) return '—';
  return Number.isInteger(n) ? n.toString() : n.toFixed(2);
}
function cssEscape(s) {
  return String(s).replace(/(["\\])/g, '\\$1');
}
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
