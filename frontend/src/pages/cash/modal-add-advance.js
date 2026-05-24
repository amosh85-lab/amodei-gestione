// Modal "Aggiungi acconto dipendente".
//
// Asks for: dipendente (dropdown staff+manager attivi), importo (numpad),
// note (opzionale), foto ricevuta (opzionale). Service is pre-filled from
// the calling tab (lunch/dinner). Posts multipart/form-data to /advances.

import { apiGet, apiUpload, ApiError } from '../../js/api.js';
import { showModal, showToast } from '../../js/components.js';
import { icon } from '../../js/icons.js';
import { openNumpad } from './modal-close-pos.js';

/**
 * @param {Object} opts
 * @param {'lunch'|'dinner'} opts.service
 * @param {string} opts.date  YYYY-MM-DD
 * @param {() => Promise<void>} opts.onSaved
 */
export async function openAddAdvanceModal({ service, date, onSaved }) {
  // Load eligible users once (staff + manager, active).
  let users = [];
  try {
    const all = await apiGet('/users?include_inactive=false');
    users = all.filter((u) => u.role === 'staff' || u.role === 'manager');
  } catch (err) {
    showToast(err.message || 'Errore caricamento utenti', 'danger', 4000);
    return;
  }
  if (users.length === 0) {
    showToast('Nessun dipendente staff/manager. Crea prima un utente da Impostazioni.', 'warn', 5000);
    return;
  }

  let selectedUserId = '';
  let amount = 0;
  let notes = '';
  let photoFile = null;
  let photoPreviewUrl = null;

  const body = `
    <div style="display: grid; gap: var(--space-12);">
      <div>
        <label class="label" for="adv-user" style="margin:0;">Dipendente*</label>
        <select id="adv-user" class="input">
          <option value="">— seleziona —</option>
          ${users.map((u) => `<option value="${u.id}">${escapeHtml(u.full_name)} (${u.role})</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="label" style="margin:0;">Importo*</label>
        <button type="button" id="adv-amount" class="input" style="text-align: left; font-family: var(--font-display); font-size: var(--text-lg); cursor: pointer; padding: var(--space-12);">€ 0,00</button>
      </div>
      <div>
        <label class="label" for="adv-notes" style="margin:0;">Note (opzionale)</label>
        <textarea id="adv-notes" class="input" rows="2" maxlength="500" placeholder="Es. anticipo spesa urgente"></textarea>
      </div>
      <div>
        <label class="label" style="margin:0;">Foto ricevuta firmata (opzionale)</label>
        <label class="btn btn--secondary" style="display: inline-flex; cursor: pointer;">
          ${icon('camera', { size: 18 })}<span style="margin-left: var(--space-8);">Scegli foto</span>
          <input type="file" id="adv-photo" accept="image/*" style="display: none;">
        </label>
        <div id="adv-photo-info" class="muted text-xs" style="margin-top: var(--space-4);"></div>
      </div>
      <p class="muted text-xs" style="margin: var(--space-4) 0 0 0;">Servizio: <strong>${service === 'lunch' ? 'Pranzo' : 'Cena'}</strong> · Data: <strong>${escapeHtml(date)}</strong></p>
    </div>
  `;

  showModal('Aggiungi acconto', body, [
    { label: 'Annulla', variant: 'ghost' },
    {
      label: 'Conferma',
      variant: 'primary',
      closeOnClick: true,
      onClick: async () => {
        if (!selectedUserId) { showToast('Seleziona un dipendente', 'warn'); return; }
        if (!amount || amount <= 0) { showToast('Importo deve essere > 0', 'warn'); return; }
        try {
          const fd = new FormData();
          fd.append('user_id', String(selectedUserId));
          fd.append('amount', amount.toFixed(2));
          fd.append('service', service);
          fd.append('date', date);
          if (notes) fd.append('notes', notes);
          if (photoFile) fd.append('receipt_photo', photoFile);
          await apiUpload('/advances', fd);
          showToast(`Acconto € ${amount.toFixed(2).replace('.', ',')} registrato`, 'success');
          if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
          await onSaved();
        } catch (err) {
          const msg = err instanceof ApiError && err.message ? err.message : 'Errore salvataggio';
          showToast(msg, 'danger', 5000);
        }
      },
    },
  ]);

  // Wire fields
  document.getElementById('adv-user').addEventListener('change', (e) => {
    selectedUserId = e.target.value;
  });
  document.getElementById('adv-notes').addEventListener('input', (e) => {
    notes = e.target.value.trim();
  });
  document.getElementById('adv-photo').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    photoFile = f;
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    photoPreviewUrl = URL.createObjectURL(f);
    const info = document.getElementById('adv-photo-info');
    if (info) info.innerHTML = `📎 ${escapeHtml(f.name)} (${(f.size / 1024).toFixed(0)} KB)`;
  });
  document.getElementById('adv-amount').addEventListener('click', () => {
    openNumpad({
      title: 'Importo acconto',
      initial: amount > 0 ? amount.toFixed(2) : '',
      onConfirm: (n) => {
        amount = n;
        const btn = document.getElementById('adv-amount');
        if (btn) btn.textContent = `€ ${n.toFixed(2).replace('.', ',')}`;
      },
    });
  });
}


function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
