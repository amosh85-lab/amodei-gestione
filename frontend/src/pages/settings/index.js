// /impostazioni — admin-only settings dashboard.
//
// Three cards:
//   1. Fondo cassa (cash_float setting). Changing it affects only NEXT
//      daily summaries; existing snapshots stay frozen by design.
//   2. Categorie spese: CRUD (add / edit / archive). Categories in use can
//      be deactivated but not deleted (FK from expenses).
//   3. Soglie alert: placeholder for future per-category thresholds.

import { apiGet, apiPatch, apiPost, apiDelete, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { icon } from '../../js/icons.js';
import { userHasRole } from '../../js/auth.js';
import { showToast, showModal, confirmDialog, skeletonList, parseNumberInput } from '../../js/components.js';
import { openNumpad } from '../cash/modal-close-pos.js';
import {
  isPushSupported,
  isSubscribed as isPushSubscribed,
  pushPermission,
  reconcilePushSubscription,
  subscribePush,
  unsubscribePush,
} from '../../js/push.js';

export async function mountSettings(container, _params, _query) {
  if (!userHasRole('admin')) {
    container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
      <div class="alert alert--warn">
        <span class="alert__icon">${icon('warning', { size: 22 })}</span>
        <div class="alert__body"><strong>Solo amministratore</strong>
          <p class="alert__text">Le impostazioni sono accessibili solo dall'utente admin.</p></div>
      </div>
    </div>`;
    setHeader({ title: 'Impostazioni', brand: true, backHref: '/' });
    return () => {};
  }

  setHeader({ title: 'Impostazioni', brand: true, backHref: '/' });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(3)}</div>`;

  const state = {
    cashFloat: null,        // string number
    foodCostThreshold: null, // string number (%)
    categories: [],
    users: [],
    loading: true,
    error: null,
  };

  await load();
  return () => {};

  // -----------------------------------------------------------------

  async function load() {
    state.loading = true;
    state.error = null;
    try {
      const [floatResp, cats, users, thr] = await Promise.all([
        apiGet('/settings/cash-float'),
        apiGet('/expense-categories'),
        apiGet('/users?include_inactive=true'),
        apiGet('/settings/food_cost_threshold').catch(() => ({ value: '32.00' })),
      ]);
      state.cashFloat = floatResp.value;
      state.categories = cats;
      state.users = users;
      state.foodCostThreshold = thr.value;
      state.loading = false;
      render();
    } catch (err) {
      state.loading = false;
      state.error = err.message || 'Errore di rete';
      render();
    }
  }

  function render() {
    if (state.error) {
      container.innerHTML = errorBlock(state.error, load);
      return;
    }
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
        ${renderPushCard()}
        ${renderCashFloatCard()}
        ${renderUsersCard()}
        ${renderCategoriesCard()}
        ${renderFoodCostThresholdCard()}
        ${renderAlertsThresholdsCard()}
      </section>
    `;
    wire();
    // La card push aggiorna il proprio stato in background (legge il
    // permission + la subscription PushManager).
    refreshPushCard();
  }

  function renderPushCard() {
    const supported = isPushSupported();
    const subTitle = supported
      ? 'Ricevi un avviso quando viene inserito il parziale pranzo o chiusa la cassa serale.'
      : 'Il tuo browser non supporta le push notifications. Su iPhone serve installare la PWA dalla schermata Home (iOS 16.4+).';
    return `
      <div class="card" style="padding: var(--space-16); margin-bottom: var(--space-16);">
        <p class="muted text-xs" style="margin:0; text-transform: uppercase; letter-spacing: var(--letter-spacing-wide);">Notifiche push</p>
        <p class="muted text-sm" style="margin: var(--space-8) 0 var(--space-12) 0;">${escapeHtml(subTitle)}</p>
        <div id="push-status" style="display: flex; justify-content: space-between; align-items: center; gap: var(--space-12);">
          <span class="muted text-sm">Stato: <em>caricamento…</em></span>
          <button type="button" id="push-toggle" class="btn btn--secondary btn--sm" disabled>…</button>
        </div>
      </div>
    `;
  }

  async function refreshPushCard() {
    const wrap = container.querySelector('#push-status');
    const btn  = container.querySelector('#push-toggle');
    if (!wrap || !btn) return;

    if (!isPushSupported()) {
      wrap.innerHTML = `<span class="muted text-sm">Non disponibile su questo browser/dispositivo.</span>`;
      btn.remove();
      return;
    }
    const perm = pushPermission();
    if (perm === 'denied') {
      wrap.innerHTML = `<span class="muted text-sm">Permesso <strong>negato</strong> dal browser. Riattivalo dalle impostazioni del browser/iOS.</span>`;
      btn.remove();
      return;
    }
    const active = await isPushSubscribed().catch(() => false);
    // Auto-heal: se il browser dice "attive" ma il backend potrebbe non
    // averla (es. POST fallito al primo subscribe), ri-registriamo in
    // silenzio. Idempotente lato backend (upsert per endpoint).
    if (active) reconcilePushSubscription();
    wrap.querySelector('span').innerHTML = active
      ? `Attive ✓ <span class="muted text-xs">su questo dispositivo</span>`
      : `Non attive su questo dispositivo`;
    btn.disabled = false;
    btn.textContent = active ? 'Disattiva' : 'Attiva';
    btn.className   = active ? 'btn btn--ghost btn--sm' : 'btn btn--primary btn--sm';
    btn.dataset.action = active ? 'unsubscribe' : 'subscribe';
  }

  function renderUsersCard() {
    return `
      <div class="card" style="padding: var(--space-16); margin-bottom: var(--space-16);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-12);">
          <p class="muted text-xs" style="margin:0; text-transform: uppercase; letter-spacing: var(--letter-spacing-wide);">Utenti</p>
          <button type="button" id="add-user" class="btn btn--primary btn--sm">${icon('plus', { size: 16 })} Nuovo</button>
        </div>
        ${state.users.length === 0
          ? '<p class="muted text-sm" style="text-align: center; padding: var(--space-12) 0;">Nessun utente.</p>'
          : `<div>${state.users.map((u, i) => userRow(u, i)).join('')}</div>`}
      </div>
    `;
  }

  function userRow(u, i) {
    const roleBadgeColor = u.role === 'admin' ? 'var(--terracotta-dark)'
                         : u.role === 'manager' ? 'var(--warning, #c9942a)'
                         : 'var(--ink-muted)';
    return `
      <div style="display: flex; align-items: center; gap: var(--space-12); padding: var(--space-8) 0; ${i > 0 ? 'border-top: 1px solid var(--border-soft);' : ''}">
        <div style="flex: 1; min-width: 0; ${u.active ? '' : 'opacity: 0.5;'}">
          <p style="margin: 0; font-weight: 500;">${escapeHtml(u.full_name)}</p>
          <p class="muted text-xs" style="margin: 2px 0 0 0;">${escapeHtml(u.email)}${u.active ? '' : ' · disattivato'}</p>
        </div>
        <span class="badge" style="background: ${roleBadgeColor}; color: var(--off-white); font-size: var(--text-xs); white-space: nowrap;">${u.role}</span>
        <button type="button" data-user-edit="${u.id}" class="btn btn--ghost btn--icon" aria-label="Modifica">${icon('edit', { size: 16 })}</button>
      </div>
    `;
  }

  function renderCashFloatCard() {
    return `
      <div class="card" style="padding: var(--space-16); margin-bottom: var(--space-16);">
        <p class="muted text-xs" style="margin:0; text-transform: uppercase; letter-spacing: var(--letter-spacing-wide);">Fondo cassa</p>
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: var(--space-8); gap: var(--space-8);">
          <span style="font-family: var(--font-display); font-size: 2rem; font-weight: 600; color: var(--ink);">€ ${formatMoney(state.cashFloat)}</span>
          <button type="button" id="edit-float" class="btn btn--secondary btn--sm">Modifica</button>
        </div>
        <p class="muted text-xs" style="margin: var(--space-8) 0 0 0;">
          Il fondo cassa è il contante che resta in cassa a fine giornata. È solo informativo: non entra nei calcoli di parziale/totale. Cambiandolo, le giornate già aperte mantengono lo snapshot del fondo precedente; il nuovo valore vale dalle prossime giornate.
        </p>
      </div>
    `;
  }

  function renderCategoriesCard() {
    return `
      <div class="card" style="padding: var(--space-16); margin-bottom: var(--space-16);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-12);">
          <p class="muted text-xs" style="margin:0; text-transform: uppercase; letter-spacing: var(--letter-spacing-wide);">Categorie spese</p>
          <button type="button" id="add-cat" class="btn btn--primary btn--sm">${icon('plus', { size: 16 })} Nuova</button>
        </div>
        ${state.categories.length === 0
          ? '<p class="muted text-sm" style="text-align: center; padding: var(--space-12) 0;">Nessuna categoria. Aggiungi la prima per categorizzare le spese.</p>'
          : `<div>${state.categories.map((c, i) => categoryRow(c, i)).join('')}</div>`}
      </div>
    `;
  }

  function categoryRow(c, i) {
    return `
      <div style="display: flex; align-items: center; gap: var(--space-12); padding: var(--space-8) 0; ${i > 0 ? 'border-top: 1px solid var(--border-soft);' : ''}">
        <span style="width: 16px; height: 16px; border-radius: 4px; background: ${c.color || 'var(--ink-muted)'}; flex-shrink: 0;"></span>
        <span style="flex: 1; ${c.active ? '' : 'opacity: 0.5; text-decoration: line-through;'}">${escapeHtml(c.name)}</span>
        ${!c.active ? '<span class="badge" style="background: var(--cream-soft); color: var(--ink-muted);">archiviata</span>' : ''}
        <button type="button" data-cat-edit="${c.id}" class="btn btn--ghost btn--icon" aria-label="Modifica">${icon('edit', { size: 16 })}</button>
        ${c.active ? `<button type="button" data-cat-archive="${c.id}" class="btn btn--ghost btn--icon" aria-label="Archivia">${icon('trash', { size: 16 })}</button>` : ''}
      </div>
    `;
  }

  function renderFoodCostThresholdCard() {
    return `
      <div class="card" style="padding: var(--space-16); margin-bottom: var(--space-16);">
        <p class="muted text-xs" style="margin:0; text-transform: uppercase; letter-spacing: var(--letter-spacing-wide);">Soglia food cost</p>
        <div style="display: flex; gap: var(--space-8); align-items: end; margin-top: var(--space-8);">
          <div style="flex: 1;">
            <input type="number" id="fc-threshold" class="input" step="0.01" min="0" max="100" value="${formatMoney(state.foodCostThreshold || 32)}">
          </div>
          <span style="font-family: var(--font-display); padding-bottom: var(--space-8);">%</span>
          <button type="button" id="fc-save" class="btn btn--secondary btn--sm">Salva</button>
        </div>
        <p class="muted text-xs" style="margin: var(--space-8) 0 0 0;">
          Anteprima: avvisi su categorie sopra il <strong>${formatMoney(state.foodCostThreshold || 32)}%</strong> del fatturato fiscale mensile.
        </p>
      </div>
    `;
  }

  function renderAlertsThresholdsCard() {
    return `
      <div class="card" style="padding: var(--space-16); margin-bottom: var(--space-16); opacity: 0.7;">
        <p class="muted text-xs" style="margin:0; text-transform: uppercase; letter-spacing: var(--letter-spacing-wide);">Soglie alert scadenze</p>
        <p class="muted text-sm" style="margin: var(--space-8) 0 0 0;">
          Funzionalità in arrivo: permetterà di impostare per ogni categoria di prodotti quanti giorni prima della scadenza segnalare.
        </p>
      </div>
    `;
  }

  function wire() {
    const pushBtn = container.querySelector('#push-toggle');
    if (pushBtn) pushBtn.addEventListener('click', async () => {
      const action = pushBtn.dataset.action;
      pushBtn.disabled = true;
      try {
        if (action === 'subscribe') {
          await subscribePush();
          showToast('Notifiche push attivate', 'success');
        } else if (action === 'unsubscribe') {
          await unsubscribePush();
          showToast('Notifiche push disattivate', 'info');
        }
      } catch (err) {
        showToast(err.message || 'Errore', 'danger', 5000);
      } finally {
        await refreshPushCard();
      }
    });

    const floatBtn = container.querySelector('#edit-float');
    if (floatBtn) floatBtn.addEventListener('click', openEditFloat);

    const addCatBtn = container.querySelector('#add-cat');
    if (addCatBtn) addCatBtn.addEventListener('click', () => openCategoryEditor(null));

    container.querySelectorAll('[data-cat-edit]').forEach((b) => {
      b.addEventListener('click', () => {
        const cat = state.categories.find((c) => c.id === Number(b.dataset.catEdit));
        if (cat) openCategoryEditor(cat);
      });
    });
    container.querySelectorAll('[data-cat-archive]').forEach((b) => {
      b.addEventListener('click', () => archiveCategory(Number(b.dataset.catArchive)));
    });

    const fcSave = container.querySelector('#fc-save');
    if (fcSave) fcSave.addEventListener('click', async () => {
      const v = parseNumberInput(container.querySelector('#fc-threshold').value);
      if (Number.isNaN(v) || v < 0 || v > 100) { showToast('Valore non valido (0-100)', 'warn'); return; }
      try {
        await apiPatch('/settings/food_cost_threshold', { value: v.toFixed(2) });
        showToast(`Soglia food cost aggiornata a ${v.toFixed(1)}%`, 'success');
        await load();
      } catch (err) {
        showToast(err.message || 'Errore', 'danger', 5000);
      }
    });

    const addUserBtn = container.querySelector('#add-user');
    if (addUserBtn) addUserBtn.addEventListener('click', () => openUserEditor(null));

    container.querySelectorAll('[data-user-edit]').forEach((b) => {
      b.addEventListener('click', () => {
        const u = state.users.find((x) => x.id === Number(b.dataset.userEdit));
        if (u) openUserEditor(u);
      });
    });
  }

  function openUserEditor(user) {
    const isNew = !user;
    const body = `
      <div style="display: grid; gap: var(--space-12);">
        <div>
          <label class="label" for="u-email" style="margin:0;">Email${isNew ? '*' : ' (non modificabile)'}</label>
          <input type="email" id="u-email" class="input" value="${user ? escapeAttr(user.email) : ''}" maxlength="255" ${isNew ? 'autofocus required' : 'disabled'}>
        </div>
        <div>
          <label class="label" for="u-name" style="margin:0;">Nome completo*</label>
          <input type="text" id="u-name" class="input" value="${user ? escapeAttr(user.full_name) : ''}" maxlength="160" ${!isNew ? 'autofocus' : ''}>
        </div>
        <div>
          <label class="label" for="u-role" style="margin:0;">Ruolo*</label>
          <select id="u-role" class="input">
            <option value="staff"   ${user?.role === 'staff'   ? 'selected' : ''}>Staff</option>
            <option value="manager" ${user?.role === 'manager' ? 'selected' : ''}>Manager</option>
            <option value="admin"   ${user?.role === 'admin'   ? 'selected' : ''}>Admin</option>
          </select>
        </div>
        <div>
          <label class="label" for="u-password" style="margin:0;">Password${isNew ? '*' : ' (lascia vuoto per non cambiare)'}</label>
          <input type="text" id="u-password" class="input" minlength="8" placeholder="min. 8 caratteri">
        </div>
        ${!isNew ? `
          <label style="display: flex; align-items: center; gap: var(--space-8);">
            <input type="checkbox" id="u-active" ${user.active ? 'checked' : ''}>
            <span>Account attivo</span>
          </label>
        ` : ''}

        <hr style="border: none; border-top: 1px solid var(--border-soft); margin: var(--space-8) 0;">
        <p class="muted text-xs" style="margin: 0 0 var(--space-4) 0; text-transform: uppercase; letter-spacing: var(--letter-spacing-wide);">Compenso (admin)</p>
        <p class="muted text-xs" style="margin: 0 0 var(--space-8) 0;">Visibile solo agli admin, usato per il calcolo dello stipendio mensile.</p>
        <div>
          <label class="label" style="margin:0;">Tipo compenso</label>
          <div style="display: flex; gap: var(--space-8); margin-top: var(--space-4);">
            <label style="display: flex; align-items: center; gap: var(--space-4); cursor: pointer;">
              <input type="radio" name="u-paytype" value="hourly" ${(user?.pay_type || 'hourly') === 'hourly' ? 'checked' : ''}>
              <span>A ore</span>
            </label>
            <label style="display: flex; align-items: center; gap: var(--space-4); cursor: pointer;">
              <input type="radio" name="u-paytype" value="fixed" ${user?.pay_type === 'fixed' ? 'checked' : ''}>
              <span>Fisso mensile</span>
            </label>
          </div>
        </div>
        <div id="u-hourly-fields" style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-8); ${user?.pay_type === 'fixed' ? 'display:none;' : ''}">
          <div>
            <label class="label" for="u-rate" style="margin:0;">Tariffa €/h</label>
            <input type="number" id="u-rate" class="input" step="0.01" min="0" placeholder="es. 10,00" value="${user?.hourly_rate != null ? Number(user.hourly_rate).toFixed(2) : ''}">
          </div>
          <div>
            <label class="label" for="u-contract" style="margin:0;">Ore/sett. contratto</label>
            <input type="number" id="u-contract" class="input" step="0.25" min="0" max="168" placeholder="es. 40" value="${user?.weekly_hours_contract != null ? Number(user.weekly_hours_contract) : ''}">
          </div>
        </div>
        <div id="u-fixed-fields" style="${user?.pay_type === 'fixed' ? '' : 'display:none;'}">
          <label class="label" for="u-salary" style="margin:0;">Stipendio mensile €</label>
          <input type="number" id="u-salary" class="input" step="0.01" min="0" placeholder="es. 1200,00" value="${user?.monthly_salary != null ? Number(user.monthly_salary).toFixed(2) : ''}">
        </div>
      </div>
    `;
    showModal(
      isNew ? 'Nuovo utente' : 'Modifica utente',
      body,
      [
        { label: 'Annulla', variant: 'ghost' },
        {
          label: isNew ? 'Crea' : 'Salva',
          variant: 'primary',
          closeOnClick: true,
          onClick: async () => {
            const fullName = document.getElementById('u-name').value.trim();
            const role = document.getElementById('u-role').value;
            const password = document.getElementById('u-password').value;
            if (!fullName || !role) { showToast('Nome e ruolo obbligatori', 'warn'); return; }
            try {
              const payType = document.querySelector('input[name="u-paytype"]:checked')?.value || 'hourly';
              const rateRaw = document.getElementById('u-rate').value.trim();
              const contractRaw = document.getElementById('u-contract').value.trim();
              const salaryRaw = document.getElementById('u-salary').value.trim();
              const hourlyRate = rateRaw === '' ? null : parseNumberInput(rateRaw);
              const weeklyHoursContract = contractRaw === '' ? null : parseNumberInput(contractRaw);
              const monthlySalary = salaryRaw === '' ? null : parseNumberInput(salaryRaw);
              if (isNew) {
                const email = document.getElementById('u-email').value.trim().toLowerCase();
                if (!email) { showToast('Email obbligatoria', 'warn'); return; }
                if (!password || password.length < 8) { showToast('Password min. 8 caratteri', 'warn'); return; }
                const payload = { email, full_name: fullName, role, password, pay_type: payType };
                if (hourlyRate !== null) payload.hourly_rate = hourlyRate.toFixed(2);
                if (monthlySalary !== null) payload.monthly_salary = monthlySalary.toFixed(2);
                if (weeklyHoursContract !== null) payload.weekly_hours_contract = weeklyHoursContract.toFixed(2);
                await apiPost('/users', payload);
                showToast('Utente creato', 'success');
              } else {
                const active = document.getElementById('u-active').checked;
                const body = { full_name: fullName, role, active, pay_type: payType,
                                hourly_rate: hourlyRate !== null ? hourlyRate.toFixed(2) : null,
                                monthly_salary: monthlySalary !== null ? monthlySalary.toFixed(2) : null,
                                weekly_hours_contract: weeklyHoursContract !== null ? weeklyHoursContract.toFixed(2) : null };
                if (password) {
                  if (password.length < 8) { showToast('Password min. 8 caratteri', 'warn'); return; }
                  body.password = password;
                }
                await apiPatch(`/users/${user.id}`, body);
                showToast('Utente aggiornato', 'success');
              }
              await load();
            } catch (err) {
              const msg = err instanceof ApiError && err.message ? err.message : 'Errore salvataggio';
              showToast(msg, 'danger', 5000);
            }
          },
        },
      ],
    );
    // Wire pay-type radio toggle
    document.querySelectorAll('input[name="u-paytype"]').forEach((r) => {
      r.addEventListener('change', () => {
        const isFixed = r.value === 'fixed';
        const hourlyEl = document.getElementById('u-hourly-fields');
        const fixedEl = document.getElementById('u-fixed-fields');
        if (hourlyEl) hourlyEl.style.display = isFixed ? 'none' : 'grid';
        if (fixedEl) fixedEl.style.display = isFixed ? '' : 'none';
      });
    });
  }

  function openEditFloat() {
    openNumpad({
      title: 'Modifica fondo cassa',
      initial: Number(state.cashFloat || 0).toFixed(2),
      onConfirm: async (n) => {
        try {
          await apiPatch('/settings/cash_float', { value: n.toFixed(2) });
          showToast(`Fondo cassa aggiornato a € ${formatMoney(n)}`, 'success');
          await load();
        } catch (err) {
          showToast(err.message || 'Errore', 'danger', 5000);
        }
      },
    });
  }

  function openCategoryEditor(cat) {
    const isNew = !cat;
    const body = `
      <div style="display: grid; gap: var(--space-12);">
        <div>
          <label class="label" for="cat-name" style="margin:0;">Nome</label>
          <input type="text" id="cat-name" class="input" value="${cat ? escapeAttr(cat.name) : ''}" placeholder="Es. Frutta e verdura" maxlength="120" autofocus>
        </div>
        <div>
          <label class="label" for="cat-color" style="margin:0;">Colore (opzionale)</label>
          <input type="color" id="cat-color" class="input" value="${cat?.color || '#B5391F'}" style="height: 44px; padding: 4px;">
        </div>
      </div>
    `;
    showModal(
      isNew ? 'Nuova categoria' : 'Modifica categoria',
      body,
      [
        { label: 'Annulla', variant: 'ghost' },
        {
          label: isNew ? 'Crea' : 'Salva', variant: 'primary', closeOnClick: true,
          onClick: async () => {
            const name = document.getElementById('cat-name').value.trim();
            const color = document.getElementById('cat-color').value;
            if (!name) { showToast('Il nome è obbligatorio', 'warn'); return; }
            try {
              if (isNew) {
                await apiPost('/expense-categories', { name, color });
                showToast('Categoria creata', 'success');
              } else {
                await apiPatch(`/expense-categories/${cat.id}`, { name, color });
                showToast('Categoria aggiornata', 'success');
              }
              await load();
            } catch (err) {
              const msg = err instanceof ApiError && err.message ? err.message : 'Errore salvataggio';
              showToast(msg, 'danger', 5000);
            }
          },
        },
      ],
    );
  }

  async function archiveCategory(id) {
    const cat = state.categories.find((c) => c.id === id);
    if (!cat) return;
    const ok = await confirmDialog(
      `Archiviare "${cat.name}"?`,
      'La categoria verrà nascosta dai menu di selezione. Le spese già registrate con questa categoria restano.',
      { confirmLabel: 'Archivia', cancelLabel: 'Annulla', danger: true },
    );
    if (!ok) return;
    try {
      await apiDelete(`/expense-categories/${id}`);
      showToast('Categoria archiviata', 'success');
      await load();
    } catch (err) {
      const msg = err instanceof ApiError && err.message ? err.message : 'Errore';
      showToast(msg, 'danger', 5000);
    }
  }
}

// ---------- helpers ----------

function formatMoney(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return '0,00';
  return n.toFixed(2).replace('.', ',');
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function errorBlock(msg, onRetry) {
  setTimeout(() => {
    const btn = document.getElementById('retry-load');
    if (btn) btn.addEventListener('click', onRetry);
  }, 0);
  return `<div class="container" style="padding-top: var(--space-20);">
    <div class="alert alert--urgent">
      <span class="alert__icon">${icon('alert', { size: 22 })}</span>
      <div class="alert__body"><strong>Errore di rete</strong>
        <p class="alert__text">${escapeHtml(msg)}</p>
        <button type="button" id="retry-load" class="btn btn--secondary btn--sm" style="margin-top: var(--space-8);">Riprova</button>
      </div>
    </div>
  </div>`;
}
