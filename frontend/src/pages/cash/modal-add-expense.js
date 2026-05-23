// Add-expense modal — amount via shared numpad, category chips,
// optional receipt photo (multipart upload).

import { apiGet, apiUpload } from '../../js/api.js';
import { showModal, showToast } from '../../js/components.js';
import { icon } from '../../js/icons.js';
import { openNumpad } from './modal-close-pos.js';

/**
 * @param {Object} opts
 * @param {'lunch'|'dinner'} opts.service - pre-selected service from caller
 * @param {string} opts.date              - ISO date for the expense
 * @param {() => void} opts.onCreated     - callback after successful POST
 */
export async function openAddExpenseModal({ service, date, onCreated }) {
  let categories = [];
  try {
    categories = await apiGet('/expense-categories');
  } catch (err) {
    showToast(err.message || 'Errore caricamento categorie', 'danger');
    return;
  }
  if (categories.length === 0) {
    showToast('Nessuna categoria di spesa configurata. Chiedi all\'admin di aggiungerle.', 'warn', 5000);
    return;
  }

  const state = {
    amount: 0,
    description: '',
    category_id: categories[0]?.id ?? null,
    service,
    file: null,
    previewUrl: null,
  };

  let close = null;

  function render() {
    const body = `
      <form id="ae-form" class="stack-16" onsubmit="return false">
        <!-- Amount field (opens numpad on tap) -->
        <div>
          <label class="muted text-xs uppercase" style="display:block; margin-bottom: var(--space-4); letter-spacing: var(--letter-spacing-wide);">Importo</label>
          <button type="button" id="ae-amount-btn" style="
            width: 100%; text-align: left; padding: var(--space-16);
            background: var(--cream-soft); border: 1px solid var(--border-soft);
            border-radius: var(--radius-md); font-family: var(--font-display);
            font-size: 2rem; color: var(--ink); cursor: pointer;">
            € ${fmt(state.amount)}
          </button>
        </div>

        <!-- Description -->
        <div class="form-row">
          <label class="label label--required" for="ae-desc">Descrizione</label>
          <input id="ae-desc" class="input" required maxlength="255" value="${escapeAttr(state.description)}" placeholder="es. Spesa frutta" />
        </div>

        <!-- Category chips -->
        <div>
          <label class="muted text-xs uppercase" style="display:block; margin-bottom: var(--space-8); letter-spacing: var(--letter-spacing-wide);">Categoria</label>
          <div id="ae-cats" style="display: flex; gap: var(--space-8); overflow-x: auto; padding-bottom: var(--space-4);">
            ${categories.map((c) => `
              <button type="button" data-cat="${c.id}" class="pill ${state.category_id === c.id ? 'pill--success' : ''}"
                style="cursor:pointer; border:none; white-space:nowrap; ${c.color ? `background: ${c.color}22; color: ${c.color};` : ''}">
                ${escapeHtml(c.name)}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Service chips -->
        <div>
          <label class="muted text-xs uppercase" style="display:block; margin-bottom: var(--space-8); letter-spacing: var(--letter-spacing-wide);">Servizio</label>
          <div style="display:flex; gap: var(--space-8);">
            <button type="button" data-svc="lunch" class="pill ${state.service === 'lunch' ? 'pill--success' : ''}" style="cursor:pointer; border:none;">Pranzo</button>
            <button type="button" data-svc="dinner" class="pill ${state.service === 'dinner' ? 'pill--success' : ''}" style="cursor:pointer; border:none;">Cena</button>
          </div>
        </div>

        <!-- Photo -->
        <div>
          <label class="muted text-xs uppercase" style="display:block; margin-bottom: var(--space-8); letter-spacing: var(--letter-spacing-wide);">Foto scontrino (opzionale)</label>
          ${state.previewUrl ? `
            <div style="display:flex; align-items:center; gap: var(--space-12);">
              <img src="${escapeAttr(state.previewUrl)}" alt="anteprima" style="width: 72px; height: 72px; object-fit: cover; border-radius: var(--radius-md); border: 1px solid var(--border-soft);">
              <button type="button" id="ae-clear" class="btn btn--ghost btn--sm">Rimuovi</button>
            </div>` : `
            <label class="btn btn--secondary full-width" style="cursor:pointer; display:inline-flex;">
              ${icon('camera', { size: 18 })}<span>Scegli foto</span>
              <input id="ae-file" type="file" accept="image/*" capture="environment" style="display:none;" />
            </label>
          `}
        </div>
      </form>
    `;
    close = showModal('Nuova spesa', body, [
      { label: 'Annulla', variant: 'ghost' },
      {
        label: 'Aggiungi',
        variant: 'primary',
        closeOnClick: false,
        onClick: submit,
      },
    ]);
    wire();
  }

  function wire() {
    document.getElementById('ae-amount-btn')?.addEventListener('click', () => {
      openNumpad({
        title: 'Importo spesa',
        initial: state.amount > 0 ? state.amount.toFixed(2) : '',
        onConfirm: (n) => {
          state.amount = n;
          const btn = document.getElementById('ae-amount-btn');
          if (btn) btn.textContent = `€ ${fmt(state.amount)}`;
        },
      });
    });
    document.getElementById('ae-desc')?.addEventListener('input', (e) => {
      state.description = e.target.value;
    });
    document.querySelectorAll('#ae-cats [data-cat]').forEach((b) => {
      b.addEventListener('click', () => {
        state.category_id = Number(b.dataset.cat);
        render();
      });
    });
    document.querySelectorAll('[data-svc]').forEach((b) => {
      b.addEventListener('click', () => {
        state.service = b.dataset.svc;
        render();
      });
    });
    const fileEl = document.getElementById('ae-file');
    if (fileEl) {
      fileEl.addEventListener('change', (e) => {
        const f = e.target.files[0];
        if (!f) return;
        if (f.size > 5 * 1024 * 1024) {
          showToast('Foto troppo grande (max 5 MB).', 'warn');
          return;
        }
        if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
        state.file = f;
        state.previewUrl = URL.createObjectURL(f);
        render();
      });
    }
    document.getElementById('ae-clear')?.addEventListener('click', () => {
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      state.file = null;
      state.previewUrl = null;
      render();
    });
  }

  async function submit() {
    if (!(state.amount > 0)) { showToast('Importo non valido', 'warn'); return; }
    if (!state.description.trim()) { showToast('Descrizione obbligatoria', 'warn'); return; }
    if (!state.category_id) { showToast('Seleziona una categoria', 'warn'); return; }

    const fd = new FormData();
    fd.append('category_id', String(state.category_id));
    fd.append('description', state.description.trim());
    fd.append('amount', state.amount.toFixed(2));
    fd.append('service', state.service);
    fd.append('date', date);
    if (state.file) fd.append('receipt_photo', state.file, state.file.name);

    try {
      await apiUpload('/expenses', fd, { timeoutMs: 30000 });
      showToast('Spesa aggiunta', 'success');
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      if (close) close();
      onCreated?.();
    } catch (err) {
      showToast(err.message || 'Errore salvataggio', 'danger', 5000);
    }
  }

  render();
}

function fmt(n) {
  const v = Number(n);
  if (Number.isNaN(v)) return '0,00';
  return v.toFixed(2).replace('.', ',');
}
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
