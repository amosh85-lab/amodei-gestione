// /ddt/:id — dettaglio di un DDT.
//
// Se il DDT è già fatturato mostra il badge "Fatturato" + link alla fattura
// e NON permette modifica/eliminazione (sola lettura). Altrimenti:
//   - "Modifica DDT" (manager solo mese corrente, admin sempre)
//   - "Elimina DDT" (solo admin)

import { apiGet, apiPatch, apiDelete, absoluteUrl, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { userHasRole } from '../../js/auth.js';
import { icon } from '../../js/icons.js';
import { showModal, showToast, confirmDialog, skeletonList, parseNumberInput } from '../../js/components.js';
import { todayLocalIso } from '../../js/dates.js';

const CAT_LABEL = { food: '🍖 Food', beverage: '🍷 Beverage', consumo: '🧴 Consumo' };

export async function mountDdtDetail(container, params, _query) {
  const id = params.id;
  setHeader({ title: 'DDT', brand: true, backHref: '/ddt' });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(3)}</div>`;

  const isAdmin = userHasRole('admin');
  let ddt = null;
  try {
    ddt = await apiGet(`/ddts/${id}`);
  } catch (err) {
    container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
      <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
        <div class="alert__body"><strong>Errore</strong>
          <p class="alert__text">${escapeHtml(err.message || '')}</p></div></div></div>`;
    return;
  }

  render();
  return () => {};

  // Modificabile solo se NON fatturato e (admin sempre | manager solo mese corrente).
  function canEdit() {
    if (ddt.is_billed) return false;
    if (isAdmin) return true;
    return ddt.ddt_date.slice(0, 7) === todayLocalIso().slice(0, 7);
  }

  function render() {
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-20); padding-bottom: 96px;">
        <div class="card" style="padding: var(--space-16);">
          <div style="display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-8); flex-wrap: wrap;">
            <div>
              <p style="margin:0; font-size: 1.4rem; font-weight: 600;">${escapeHtml(ddt.supplier.name)}</p>
              <p class="muted text-xs" style="margin: 2px 0 0 0;">${CAT_LABEL[ddt.supplier.category] || ddt.supplier.category}</p>
            </div>
            <p style="margin:0; font-family: var(--font-display); font-size: 2rem;">€ ${fmt(ddt.amount_total)}</p>
          </div>
          <div style="margin-top: var(--space-16); padding-top: var(--space-12); border-top: 1px solid var(--border-soft); display: grid; gap: var(--space-8);">
            <div class="row" style="justify-content: space-between;"><span class="muted">Numero DDT</span><span style="font-family: var(--font-display);">${escapeHtml(ddt.ddt_number)}</span></div>
            <div class="row" style="justify-content: space-between;"><span class="muted">Data DDT</span><span>${formatDate(ddt.ddt_date)}</span></div>
            <div class="row" style="justify-content: space-between;"><span class="muted">Registrato da</span><span>${escapeHtml(ddt.created_by.full_name)}</span></div>
          </div>
          ${ddt.notes ? `<p style="margin: var(--space-12) 0 0 0;" class="muted text-sm">${escapeHtml(ddt.notes)}</p>` : ''}
        </div>

        ${ddt.photo_url ? `
          <button type="button" id="view-photo" class="card" style="width: 100%; margin-top: var(--space-12); padding: var(--space-12); cursor: pointer; text-align: left; border: 1px solid var(--border-soft);">
            ${icon('image', { size: 18 })} <span style="margin-left: var(--space-8);">Vedi foto DDT</span>
          </button>` : ''}

        ${ddt.is_billed ? `
          <div class="card" style="padding: var(--space-16); margin-top: var(--space-16); background: rgba(79,142,58,0.06); border: 1px solid rgba(79,142,58,0.25);">
            <p style="margin:0; font-weight: 600; color: var(--bottle-green, #4f8e3a);">✓ Fatturato</p>
            <p class="muted text-sm" style="margin: var(--space-4) 0 0 0;">Confluito nella fattura ${ddt.invoice ? `#${escapeHtml(ddt.invoice.invoice_number)} del ${formatDate(ddt.invoice.invoice_date)}` : ''}. Per modificarlo, annulla prima la fattura.</p>
            ${ddt.invoice ? `<button type="button" id="goto-invoice" class="btn btn--ghost full-width" style="margin-top: var(--space-12);">${icon('eye', { size: 16 })}<span>Vai alla fattura</span></button>` : ''}
          </div>` : ''}

        ${canEdit() ? `
          <button type="button" id="edit" class="btn btn--secondary full-width" style="margin-top: var(--space-16);">
            ${icon('edit', { size: 16 })}<span>Modifica DDT</span>
          </button>` : ''}

        ${isAdmin && !ddt.is_billed ? `
          <button type="button" id="del" class="btn btn--ghost full-width" style="margin-top: var(--space-12); color: var(--terracotta-dark);">
            ${icon('trash', { size: 16 })}<span>Elimina DDT</span>
          </button>` : ''}
      </section>
    `;
    wire();
  }

  function wire() {
    const viewPhoto = document.getElementById('view-photo');
    if (viewPhoto) viewPhoto.addEventListener('click', () => {
      showModal('Foto DDT', `<div class="center"><img src="${absoluteUrl(ddt.photo_url)}" alt="DDT" style="max-width: 100%; max-height: 70vh; border-radius: var(--radius-md);"></div>`, []);
    });
    const gotoInv = document.getElementById('goto-invoice');
    if (gotoInv) gotoInv.addEventListener('click', () => navigate(`/fatture/${ddt.invoice.id}`));
    const edit = document.getElementById('edit');
    if (edit) edit.addEventListener('click', openEditModal);
    const del = document.getElementById('del');
    if (del) del.addEventListener('click', async () => {
      const ok = await confirmDialog('Eliminare il DDT?', "L'azione è irreversibile.",
                                       { confirmLabel: 'Elimina', danger: true });
      if (!ok) return;
      try {
        await apiDelete(`/ddts/${id}`);
        showToast('DDT eliminato', 'success');
        navigate('/ddt');
      } catch (err) {
        const msg = err instanceof ApiError && err.message ? err.message : 'Errore';
        showToast(msg, 'danger', 5000);
      }
    });
  }

  function openEditModal() {
    const body = `
      <form id="edit-form" class="stack-12" novalidate>
        <div class="form-row">
          <label class="label" for="ed-supplier">Fornitore</label>
          <input id="ed-supplier" class="input" type="text" value="${escapeHtml(ddt.supplier.name)}" disabled>
          <p class="muted text-xs" style="margin: var(--space-4) 0 0 0;">Il fornitore non si modifica da qui.</p>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-8);">
          <div class="form-row">
            <label class="label label--required" for="ed-number">Numero DDT</label>
            <input id="ed-number" class="input" type="text" maxlength="50" required value="${escapeHtml(ddt.ddt_number)}">
          </div>
          <div class="form-row">
            <label class="label label--required" for="ed-date">Data</label>
            <input id="ed-date" class="input" type="date" required value="${escapeHtml(ddt.ddt_date)}">
          </div>
        </div>
        <div class="form-row">
          <label class="label label--required" for="ed-amount">Importo totale (€)</label>
          <input id="ed-amount" class="input" type="number" step="0.01" min="0.01" required value="${escapeHtml(ddt.amount_total)}">
        </div>
        <div class="form-row">
          <label class="label" for="ed-notes">Note (opzionale)</label>
          <textarea id="ed-notes" class="textarea" maxlength="1000">${escapeHtml(ddt.notes || '')}</textarea>
        </div>
      </form>
    `;
    showModal('Modifica DDT', body, [
      { label: 'Annulla', variant: 'ghost' },
      {
        label: 'Salva',
        variant: 'primary',
        closeOnClick: false,
        onClick: async (close) => {
          const num = document.getElementById('ed-number').value.trim();
          const dt = document.getElementById('ed-date').value;
          const notes = document.getElementById('ed-notes').value.trim();
          const amount = parseNumberInput(document.getElementById('ed-amount').value);
          if (!num || !dt) {
            showToast('Numero e data sono obbligatori', 'warn'); return;
          }
          if (!Number.isFinite(amount) || amount <= 0) {
            showToast('Importo non valido (es. 12.50)', 'warn'); return;
          }
          const payload = {
            ddt_number: num, ddt_date: dt,
            amount_total: amount.toFixed(2), notes: notes || null,
          };
          try {
            await apiPatch(`/ddts/${id}`, payload);
            showToast('DDT aggiornato', 'success');
            ddt = await apiGet(`/ddts/${id}`);
            render();
            close();
          } catch (err) {
            let msg = err instanceof ApiError && err.message ? err.message : 'Errore salvataggio';
            if (err instanceof ApiError && err.status === 409) {
              msg = 'Esiste già un DDT con questo numero per questo fornitore.';
            }
            showToast(msg, 'danger', 5000);
          }
        },
      },
    ]);
  }
}

function fmt(v) { const n = Number(v); return Number.isNaN(n) ? '0,00' : n.toFixed(2).replace('.', ','); }
function formatDate(iso) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
