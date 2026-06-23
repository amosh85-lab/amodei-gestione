// /ddt/nuovo — registra un nuovo DDT (manager/admin).
//
// Stessa struttura del form fattura: form a pagina singola, campi compatti
// su mobile. DDT = testata + importo (numero, data, fornitore, importo, note, foto).

import { apiGet, apiUpload, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { icon } from '../../js/icons.js';
import { showToast, skeletonList, parseNumberInput } from '../../js/components.js';
import { todayLocalIso } from '../../js/dates.js';

const CAT_LABEL = { food: '🍖 Food', beverage: '🍷 Beverage', consumo: '🧴 Consumo' };

export async function mountDdtNew(container, _params, _query) {
  setHeader({ title: 'Nuovo DDT', brand: true, backHref: '/ddt' });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(3)}</div>`;

  let suppliers = [];
  try {
    suppliers = (await apiGet('/suppliers?active=true')) || [];
  } catch (err) {
    showToast(err.message || 'Errore caricamento fornitori', 'danger', 5000);
    container.innerHTML = '';
    return;
  }
  if (suppliers.length === 0) {
    container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
      <div class="alert alert--warn"><span class="alert__icon">${icon('warning', { size: 22 })}</span>
        <div class="alert__body"><strong>Nessun fornitore</strong>
          <p class="alert__text">Aggiungi prima un fornitore da Fornitori.</p>
          <button type="button" class="btn btn--secondary btn--sm" style="margin-top: var(--space-8);" onclick="location.hash='/fornitori'">Vai a Fornitori</button>
        </div></div></div>`;
    return;
  }

  let photoFile = null;
  let photoPreview = null;

  const today = todayLocalIso();
  container.innerHTML = `
    <section class="container" style="padding-block: var(--space-20); padding-bottom: 96px;">
      <form id="ddt-form" class="stack-12" novalidate>
        <div class="form-row">
          <label class="label label--required" for="ddt-supplier">Fornitore</label>
          <select id="ddt-supplier" class="input" required>
            <option value="">— seleziona —</option>
            ${suppliers.map((s) => `<option value="${s.id}" data-cat="${s.category}">${escapeHtml(s.name)} · ${CAT_LABEL[s.category] || s.category}</option>`).join('')}
          </select>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-8);">
          <div class="form-row">
            <label class="label label--required" for="ddt-number">Numero DDT</label>
            <input id="ddt-number" class="input" type="text" maxlength="50" required placeholder="Es. DDT/2026/123">
          </div>
          <div class="form-row">
            <label class="label label--required" for="ddt-date">Data</label>
            <input id="ddt-date" class="input" type="date" value="${today}" required>
          </div>
        </div>
        <div class="form-row">
          <label class="label label--required" for="ddt-amount">Importo totale (€)</label>
          <input id="ddt-amount" class="input" type="number" step="0.01" min="0.01" required placeholder="0,00">
        </div>
        <div class="form-row">
          <label class="label" for="ddt-notes">Note (opzionale)</label>
          <textarea id="ddt-notes" class="textarea" maxlength="1000" placeholder="Es. consegna parziale, merce specifica…"></textarea>
        </div>
        <div class="form-row">
          <label class="label">Foto DDT (opzionale)</label>
          <label class="btn btn--secondary" style="display: inline-flex; cursor: pointer;">
            ${icon('camera', { size: 18 })}<span style="margin-left: var(--space-8);">Scegli foto</span>
            <input type="file" id="ddt-photo" accept="image/*" style="display: none;">
          </label>
          <div id="ddt-photo-info" class="muted text-xs" style="margin-top: var(--space-4);"></div>
        </div>
        <div class="row" style="gap: var(--space-12); margin-top: var(--space-12);">
          <button type="button" id="ddt-cancel" class="btn btn--ghost flex-1">Annulla</button>
          <button type="submit" id="ddt-submit" class="btn btn--primary flex-1">Registra DDT</button>
        </div>
      </form>
    </section>
  `;

  const form = document.getElementById('ddt-form');
  document.getElementById('ddt-cancel').addEventListener('click', () => navigate('/ddt'));
  document.getElementById('ddt-photo').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    photoFile = f;
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    photoPreview = URL.createObjectURL(f);
    document.getElementById('ddt-photo-info').innerHTML = `📎 ${escapeHtml(f.name)} (${(f.size / 1024).toFixed(0)} KB)`;
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const supId = document.getElementById('ddt-supplier').value;
    const num = document.getElementById('ddt-number').value.trim();
    const dt = document.getElementById('ddt-date').value;
    const amount = parseNumberInput(document.getElementById('ddt-amount').value);
    const notes = document.getElementById('ddt-notes').value.trim();
    if (!supId || !num || !dt || !Number.isFinite(amount) || amount <= 0) {
      showToast('Compila tutti i campi obbligatori (prezzo valido es. 12.50)', 'warn'); return;
    }
    const fd = new FormData();
    fd.append('supplier_id', supId);
    fd.append('ddt_number', num);
    fd.append('ddt_date', dt);
    fd.append('amount_total', amount.toFixed(2));
    if (notes) fd.append('notes', notes);
    if (photoFile) fd.append('photo', photoFile);
    const submitBtn = document.getElementById('ddt-submit');
    submitBtn.disabled = true;
    try {
      await apiUpload('/ddts', fd);
      showToast('DDT registrato', 'success');
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      navigate('/ddt');
    } catch (err) {
      submitBtn.disabled = false;
      let msg = err instanceof ApiError && err.message ? err.message : 'Errore salvataggio';
      if (err instanceof ApiError && err.status === 409) {
        msg = 'Esiste già un DDT con questo numero per questo fornitore.';
      }
      showToast(msg, 'danger', 5000);
    }
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
