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
import { showToast, showModal, confirmDialog, skeletonList } from '../../js/components.js';
import { openNumpad } from '../cash/modal-close-pos.js';

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
    categories: [],
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
      const [floatResp, cats] = await Promise.all([
        apiGet('/settings/cash-float'),
        apiGet('/expense-categories'),
      ]);
      state.cashFloat = floatResp.value;
      state.categories = cats;
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
        ${renderCashFloatCard()}
        ${renderCategoriesCard()}
        ${renderAlertsThresholdsCard()}
      </section>
    `;
    wire();
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
