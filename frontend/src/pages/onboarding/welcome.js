// /benvenuto — admin onboarding wizard: 3 step (fornitore, prodotto, utente).
//
// Auto-triggered from home.js the first time an admin lands on an empty
// database. Also reachable via direct URL at any time (idempotent: it just
// creates one of each entity per step, then sends the user to /).
//
// Each step can be skipped: skipping persists "onboarding_skipped" in
// localStorage so the admin isn't nagged again.

import { apiPost, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { userHasRole } from '../../js/auth.js';
import { icon } from '../../js/icons.js';
import { showToast } from '../../js/components.js';

const SKIP_KEY = 'amodei.onboarding_skipped';

export function markOnboardingSkipped() {
  try { localStorage.setItem(SKIP_KEY, '1'); } catch (_) {}
}

export function isOnboardingSkipped() {
  try { return localStorage.getItem(SKIP_KEY) === '1'; } catch (_) { return false; }
}

export async function mountOnboardingWelcome(container, _params, _query) {
  if (!userHasRole('admin')) {
    navigate('/');
    return () => {};
  }

  setHeader({ title: 'Benvenuto', brand: true, backHref: '/' });

  const state = { step: 1 };

  render();
  return () => {};

  function render() {
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-20); padding-bottom: 96px;">
        ${intro()}
        ${stepIndicator(state.step)}
        <div id="step-body" style="margin-top: var(--space-16);">${stepBody(state.step)}</div>
      </section>
    `;
    wire();
  }

  function intro() {
    return `
      <div style="margin-bottom: var(--space-16);">
        <h1 style="margin: 0 0 var(--space-8) 0; font-family: var(--font-display); font-size: 1.6rem;">Configurazione iniziale</h1>
        <p class="muted text-sm" style="margin: 0;">3 passi per iniziare. Puoi saltare un passo e tornarci dopo dalle Impostazioni o dal magazzino.</p>
      </div>
    `;
  }

  function stepIndicator(current) {
    return `
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-8); margin-bottom: var(--space-16);">
        ${pill(1, 'Fornitore', current)}
        ${pill(2, 'Prodotto',  current)}
        ${pill(3, 'Utente',    current)}
      </div>
    `;
  }

  function pill(n, label, current) {
    const done = n < current;
    const active = n === current;
    const bg = done ? 'var(--success, #4f8e3a)'
              : active ? 'var(--terracotta)' : 'var(--cream-soft)';
    const color = done || active ? 'var(--off-white)' : 'var(--ink-muted)';
    return `<div style="display: flex; align-items: center; justify-content: center; gap: var(--space-4); padding: var(--space-8); border-radius: var(--radius-md); background: ${bg}; color: ${color};">
      <span style="font-family: var(--font-display); font-weight: 600;">${done ? '✓' : n}</span>
      <span style="font-size: var(--text-sm);">${label}</span>
    </div>`;
  }

  function stepBody(step) {
    if (step === 1) return stepSupplier();
    if (step === 2) return stepProduct();
    if (step === 3) return stepUser();
    return '';
  }

  function stepSupplier() {
    return `
      <div class="card" style="padding: var(--space-16);">
        <h2 style="margin: 0 0 var(--space-4) 0; font-family: var(--font-display); font-size: var(--text-lg);">Aggiungi il primo fornitore</h2>
        <p class="muted text-sm" style="margin: 0 0 var(--space-12) 0;">Esempio: il caseificio, il vinaio, il fruttivendolo. Servirà per assegnare un fornitore preferito a ogni prodotto e generare gli ordini.</p>
        <div style="display: grid; gap: var(--space-12);">
          <div>
            <label class="label" for="s-name">Nome*</label>
            <input id="s-name" class="input" type="text" maxlength="160" placeholder="Es. Caseificio Bella" autofocus>
          </div>
          <div>
            <label class="label" for="s-phone">Telefono (opzionale)</label>
            <input id="s-phone" class="input" type="tel" maxlength="40" placeholder="+39 …">
          </div>
          <div>
            <label class="label" for="s-whatsapp">WhatsApp (opzionale)</label>
            <input id="s-whatsapp" class="input" type="tel" maxlength="40" placeholder="+39 …">
          </div>
        </div>
        ${actions(1)}
      </div>
    `;
  }

  function stepProduct() {
    return `
      <div class="card" style="padding: var(--space-16);">
        <h2 style="margin: 0 0 var(--space-4) 0; font-family: var(--font-display); font-size: var(--text-lg);">Aggiungi il primo prodotto</h2>
        <p class="muted text-sm" style="margin: 0 0 var(--space-12) 0;">Un prodotto da magazzino. Potrai aggiungerne altri da Magazzino → +.</p>
        <div style="display: grid; gap: var(--space-12);">
          <div>
            <label class="label" for="p-name">Nome*</label>
            <input id="p-name" class="input" type="text" maxlength="200" placeholder="Es. Mozzarella di bufala" autofocus>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-8);">
            <div>
              <label class="label" for="p-unit">Unità*</label>
              <input id="p-unit" class="input" type="text" maxlength="32" placeholder="kg, pz, l">
            </div>
            <div>
              <label class="label" for="p-price">Prezzo vendita</label>
              <input id="p-price" class="input" type="number" step="0.01" min="0" placeholder="0,00">
            </div>
          </div>
          <div>
            <label class="label" for="p-category">Categoria (opzionale)</label>
            <input id="p-category" class="input" type="text" maxlength="80" placeholder="Es. Latticini">
          </div>
        </div>
        ${actions(2)}
      </div>
    `;
  }

  function stepUser() {
    return `
      <div class="card" style="padding: var(--space-16);">
        <h2 style="margin: 0 0 var(--space-4) 0; font-family: var(--font-display); font-size: var(--text-lg);">Aggiungi un utente</h2>
        <p class="muted text-sm" style="margin: 0 0 var(--space-12) 0;">Crea un account per uno dei tuoi collaboratori. Il manager può accedere a quasi tutto; lo staff può segnalare scorte e registrare spese/POS.</p>
        <div style="display: grid; gap: var(--space-12);">
          <div>
            <label class="label" for="u-email">Email*</label>
            <input id="u-email" class="input" type="email" maxlength="255" placeholder="nome@example.it" autofocus>
          </div>
          <div>
            <label class="label" for="u-name">Nome completo*</label>
            <input id="u-name" class="input" type="text" maxlength="160" placeholder="Mario Rossi">
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-8);">
            <div>
              <label class="label" for="u-role">Ruolo*</label>
              <select id="u-role" class="input">
                <option value="staff">Staff</option>
                <option value="manager">Manager</option>
              </select>
            </div>
            <div>
              <label class="label" for="u-password">Password*</label>
              <input id="u-password" class="input" type="text" minlength="8" placeholder="min. 8 caratteri">
            </div>
          </div>
        </div>
        ${actions(3)}
      </div>
    `;
  }

  function actions(step) {
    const last = step === 3;
    return `
      <div class="row" style="gap: var(--space-12); margin-top: var(--space-16);">
        <button type="button" data-skip class="btn btn--ghost flex-1">Salta</button>
        <button type="button" data-confirm class="btn btn--primary flex-1">${last ? 'Termina' : 'Avanti'}</button>
      </div>
    `;
  }

  function wire() {
    const skipBtn = container.querySelector('[data-skip]');
    const okBtn = container.querySelector('[data-confirm]');
    if (skipBtn) skipBtn.addEventListener('click', () => onSkip());
    if (okBtn) okBtn.addEventListener('click', () => onConfirm());
  }

  function onSkip() {
    if (state.step === 3) finishWizard();
    else { state.step += 1; render(); }
  }

  async function onConfirm() {
    try {
      if (state.step === 1) await saveSupplier();
      else if (state.step === 2) await saveProduct();
      else if (state.step === 3) await saveUser();
    } catch (err) {
      const msg = err instanceof ApiError && err.message ? err.message : 'Errore salvataggio';
      showToast(msg, 'danger', 5000);
      return;
    }
    if (state.step === 3) finishWizard();
    else { state.step += 1; render(); }
  }

  async function saveSupplier() {
    const name = val('s-name'); const phone = val('s-phone'); const whatsapp = val('s-whatsapp');
    if (!name) { showToast('Il nome è obbligatorio', 'warn'); throw new Error('skip');  /* handled */ }
    const body = { name };
    if (phone) body.phone = phone;
    if (whatsapp) body.whatsapp = whatsapp;
    await apiPost('/suppliers', body);
    showToast('Fornitore creato', 'success');
  }

  async function saveProduct() {
    const name = val('p-name'); const unit = val('p-unit');
    if (!name || !unit) { showToast('Nome e unità sono obbligatori', 'warn'); throw new Error('skip'); }
    const body = { name, unit };
    const price = val('p-price'); if (price) body.sale_price = price;
    const cat = val('p-category'); if (cat) body.category = cat;
    await apiPost('/products', body);
    showToast('Prodotto creato', 'success');
  }

  async function saveUser() {
    const email = val('u-email'); const fullName = val('u-name');
    const role = val('u-role'); const password = val('u-password');
    if (!email || !fullName || !password) { showToast('Email, nome e password obbligatori', 'warn'); throw new Error('skip'); }
    if (password.length < 8) { showToast('Password almeno 8 caratteri', 'warn'); throw new Error('skip'); }
    await apiPost('/users', { email, full_name: fullName, role, password });
    showToast('Utente creato', 'success');
  }

  function finishWizard() {
    markOnboardingSkipped();
    showToast('Configurazione completata. Inizia a usare Amodei!', 'success', 4000);
    navigate('/');
  }

  function val(id) {
    const el = document.getElementById(id);
    return el ? (el.value || '').trim() : '';
  }
}
