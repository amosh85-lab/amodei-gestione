// /riordini/nuovo (create from supplier + alerts) and /riordini/:id (edit).
//
// Live WhatsApp preview computed client-side using the same template
// algorithm as backend services/whatsapp.py — keeps the form snappy.

import { apiGet, apiPost, apiPatch, apiDelete, absoluteUrl, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { icon } from '../../js/icons.js';
import { showToast, showModal, confirmDialog } from '../../js/components.js';

const DEFAULT_TEMPLATE =
  'Ciao {supplier_name}, ordine per Amodei Wine Bar:\n\n{lines}\n\nGrazie!';

export async function mountReorderEdit(container, params, query) {
  const isNew = !params.id || params.id === 'nuovo';
  const orderId = isNew ? null : Number(params.id);

  setHeader({
    title: isNew ? 'Nuovo ordine' : `Ordine #${orderId}`,
    brand: true,
    backHref: '/riordini?tab=bozze',
  });

  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
    <div class="card stack-12"><div class="skeleton skeleton--title"></div><div class="skeleton skeleton--line"></div><div class="skeleton skeleton--block"></div></div>
  </div>`;

  // Preload everything we might need
  let suppliers = [];
  let products = [];
  let openAlerts = [];
  let order = null;
  try {
    [suppliers, products, openAlerts] = await Promise.all([
      apiGet('/suppliers'),
      apiGet('/products?active=true'),
      apiGet('/alerts?status=open&limit=500'),
    ]);
    if (!isNew) {
      order = await apiGet(`/supplier-orders/${orderId}`);
    }
  } catch (err) {
    container.innerHTML = errorCard(err.message || 'Errore di rete');
    return;
  }

  const suppliersById = new Map(suppliers.map((s) => [s.id, s]));
  const productsById = new Map(products.map((p) => [p.id, p]));

  // ---- build initial state ----
  let supplierId = null;
  let lines = [];  // [{product_id, qty, alert_id|null}]
  let notes = '';

  if (!isNew && order) {
    supplierId = order.supplier_id;
    lines = order.lines.map((l) => ({
      product_id: l.product_id,
      qty: String(l.qty),
      alert_id: l.alert_id,
    }));
    notes = order.notes || '';
  } else if (query.supplier_id) {
    supplierId = Number(query.supplier_id);
    if (query.from_alerts) {
      const ids = query.from_alerts.split(',').map(Number).filter(Boolean);
      const wanted = new Set(ids);
      const matching = openAlerts.filter((a) => wanted.has(a.id));
      for (const a of matching) {
        lines.push({
          product_id: a.product_id,
          qty: String(a.suggested_qty || 1),
          alert_id: a.id,
        });
      }
    }
  }

  const state = {
    supplierId, lines, notes,
    saving: false,
  };

  render();
  return () => {};

  // -----------------------------------------------------------------

  function render() {
    const supplier = state.supplierId ? suppliersById.get(state.supplierId) : null;
    const editable = isNew || order?.status === 'draft';
    const readOnly = !editable;
    const statusInfo = order
      ? `<span class="badge ${order.status === 'draft' ? '' : order.status === 'received' ? 'badge--success' : order.status === 'cancelled' ? 'badge--danger' : 'badge--warn'}">${escapeHtml(order.status)}</span>`
      : '';

    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-20); padding-bottom: 200px;">

        <!-- Supplier picker / display -->
        <div class="card stack-12">
          <div class="row" style="gap: var(--space-8);">
            <p class="muted text-xs uppercase" style="margin:0; letter-spacing: var(--letter-spacing-wide); flex:1;">Fornitore</p>
            ${statusInfo}
          </div>
          ${supplier
            ? `<p class="font-display text-xl" style="margin:0;">${escapeHtml(supplier.name)}</p>
               <p class="muted text-sm" style="margin:0;">${supplier.whatsapp ? `WhatsApp: ${escapeHtml(supplier.whatsapp)}` : (supplier.phone ? `Tel: ${escapeHtml(supplier.phone)}` : '<em>nessun numero registrato</em>')}</p>`
            : `<select id="rr-supplier" class="select" ${readOnly ? 'disabled' : ''}>
                 <option value="">— scegli fornitore —</option>
                 ${suppliers.map((s) => `<option value="${s.id}" ${s.id === state.supplierId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
               </select>`}
        </div>

        <!-- Lines -->
        <h3 class="font-display text-xl" style="margin: var(--space-24) 0 var(--space-12) 0;">Righe ordine</h3>
        <div id="rr-lines" class="stack-8">${state.lines.map(lineRow).join('') || '<p class="muted text-sm">Nessuna riga ancora.</p>'}</div>

        ${editable ? `
          <div class="row" style="gap: var(--space-8); margin-top: var(--space-12); align-items: center;">
            <select id="rr-add-prod" class="select flex-1">
              <option value="">+ Aggiungi prodotto…</option>
              ${products.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(p.unit)})</option>`).join('')}
            </select>
          </div>
        ` : ''}

        <!-- Notes -->
        <h3 class="font-display text-xl" style="margin: var(--space-24) 0 var(--space-12) 0;">Note ordine</h3>
        <textarea id="rr-notes" class="textarea" ${readOnly ? 'disabled' : ''} maxlength="1000" placeholder="Note libere (opzionale)">${escapeHtml(state.notes)}</textarea>

        <!-- WhatsApp preview -->
        <h3 class="font-display text-xl" style="margin: var(--space-24) 0 var(--space-12) 0;">Anteprima WhatsApp</h3>
        <div class="card card--inset">
          <pre id="rr-preview" style="margin:0; white-space: pre-wrap; font-family: var(--font-body); font-size: var(--text-sm); color: var(--ink);">${escapeHtml(buildPreview())}</pre>
        </div>

        <!-- Read-only action (received / cancelled) -->
        ${order && order.status === 'sent' ? `
          <div class="row" style="gap: var(--space-12); margin-top: var(--space-16);">
            <button type="button" id="rr-received" class="btn btn--success-ish btn--secondary flex-1" style="border-color: var(--bottle-green); color: var(--bottle-green);">${icon('check', { size: 18 })}<span>Segna come ricevuto</span></button>
            <button type="button" id="rr-cancel" class="btn btn--danger flex-1">${icon('x', { size: 18 })}<span>Annulla ordine</span></button>
          </div>
        ` : ''}
      </section>

      <!-- Sticky bottom (only when editable) -->
      ${editable ? `
        <div style="position: fixed; left: 0; right: 0; bottom: calc(72px + env(safe-area-inset-bottom, 0px)); z-index: 9; padding: var(--space-12) var(--space-20); background: var(--off-white); border-top: 1px solid var(--border-soft); box-shadow: 0 -2px 12px rgba(120,30,20,0.06);">
          <div class="container" style="padding: 0;">
            <div class="row" style="gap: var(--space-12);">
              <button type="button" id="rr-save" class="btn btn--secondary flex-1">${icon('check', { size: 18 })}<span>Salva bozza</span></button>
              <button type="button" id="rr-wa" class="btn btn--primary btn--lg flex-1" style="background: #25D366; border-color: #25D366;">
                ${icon('whatsapp', { size: 20 })}<span>Apri WhatsApp</span>
              </button>
            </div>
            ${!isNew ? `<div class="row" style="margin-top: var(--space-8);"><button type="button" id="rr-cancel-draft" class="btn btn--ghost full-width" style="color: var(--terracotta-dark);">${icon('trash', { size: 16 })}<span>Annulla ordine</span></button></div>` : ''}
          </div>
        </div>
      ` : ''}
    `;

    wire();
  }

  function lineRow(line, idx) {
    const p = productsById.get(line.product_id);
    const linkedAlert = line.alert_id
      ? `<span class="badge badge--warn">${icon('alert', { size: 12 })}<span>alert #${line.alert_id}</span></span>`
      : '';
    const editable = isNew || order?.status === 'draft';
    return `
      <div class="card" data-line="${idx}">
        <div class="row" style="gap: var(--space-12); align-items: flex-end;">
          <div class="flex-1" style="min-width: 0;">
            <p class="font-display text-base" style="margin:0;">${escapeHtml(p?.name || `#${line.product_id}`)}</p>
            <div class="row" style="gap: var(--space-8); margin-top: var(--space-4);">
              <p class="muted text-xs" style="margin:0;">${escapeHtml(p?.unit || '')}</p>
              ${linkedAlert}
            </div>
          </div>
          <input class="input" data-qty="${idx}" type="number" min="0.01" step="0.01" inputmode="decimal"
                 value="${escapeAttr(line.qty)}" ${editable ? '' : 'disabled'}
                 style="width: 96px; text-align: right; font-family: var(--font-display); font-size: var(--text-lg);" />
          <span class="muted text-xs" style="min-width: 24px;">${escapeHtml(p?.unit || '')}</span>
          ${editable ? `<button type="button" class="btn btn--ghost btn--icon" data-rm="${idx}" aria-label="Rimuovi">${icon('trash', { size: 16 })}</button>` : ''}
        </div>
      </div>`;
  }

  function buildPreview() {
    const supplier = state.supplierId ? suppliersById.get(state.supplierId) : null;
    if (!supplier) return '(scegli un fornitore per vedere l\'anteprima)';
    if (state.lines.length === 0) return '(nessuna riga ancora)';
    const linesStr = state.lines.map((l) => {
      const p = productsById.get(l.product_id);
      const qty = formatQty(l.qty);
      return `- ${qty} ${p?.unit || ''} ${p?.name || `#${l.product_id}`}`;
    }).join('\n');
    const tpl = supplier.message_template || DEFAULT_TEMPLATE;
    const today = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    try {
      return tpl
        .replace(/\{supplier_name\}/g, supplier.name)
        .replace(/\{lines\}/g, linesStr)
        .replace(/\{date\}/g, today);
    } catch {
      return DEFAULT_TEMPLATE
        .replace(/\{supplier_name\}/g, supplier.name)
        .replace(/\{lines\}/g, linesStr);
    }
  }

  function refreshPreview() {
    const el = container.querySelector('#rr-preview');
    if (el) el.textContent = buildPreview();
  }

  function wire() {
    const supSel = container.querySelector('#rr-supplier');
    if (supSel) supSel.addEventListener('change', (e) => {
      state.supplierId = e.target.value ? Number(e.target.value) : null;
      render();
    });

    container.querySelectorAll('[data-qty]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const i = Number(e.target.dataset.qty);
        state.lines[i].qty = e.target.value;
        refreshPreview();
      });
    });
    container.querySelectorAll('[data-rm]').forEach((b) => {
      b.addEventListener('click', () => {
        const i = Number(b.dataset.rm);
        state.lines.splice(i, 1);
        render();
      });
    });
    const addSel = container.querySelector('#rr-add-prod');
    if (addSel) addSel.addEventListener('change', (e) => {
      const pid = Number(e.target.value);
      if (!pid) return;
      if (state.lines.find((l) => l.product_id === pid)) {
        showToast('Prodotto già in lista', 'warn');
        e.target.value = '';
        return;
      }
      state.lines.push({ product_id: pid, qty: '1', alert_id: null });
      e.target.value = '';
      render();
    });

    const notesEl = container.querySelector('#rr-notes');
    if (notesEl) notesEl.addEventListener('input', (e) => { state.notes = e.target.value; });

    const saveBtn = container.querySelector('#rr-save');
    if (saveBtn) saveBtn.addEventListener('click', () => doSave({ markSentAfter: false }));

    const waBtn = container.querySelector('#rr-wa');
    if (waBtn) waBtn.addEventListener('click', sendWhatsApp);

    const cancelBtn = container.querySelector('#rr-cancel-draft');
    if (cancelBtn) cancelBtn.addEventListener('click', cancelDraft);

    const recBtn = container.querySelector('#rr-received');
    if (recBtn) recBtn.addEventListener('click', markReceived);
    const cancelOrderBtn = container.querySelector('#rr-cancel');
    if (cancelOrderBtn) cancelOrderBtn.addEventListener('click', cancelOrder);
  }

  function buildPayload() {
    if (!state.supplierId) throw new Error('Scegli un fornitore prima di salvare.');
    if (state.lines.length === 0) throw new Error('Aggiungi almeno una riga.');
    const linesOut = state.lines.map((l) => {
      const qty = Number(l.qty);
      if (!(qty > 0)) throw new Error(`Quantità non valida (${l.qty}) per una riga.`);
      const obj = { product_id: l.product_id, qty };
      if (l.alert_id) obj.alert_id = l.alert_id;
      return obj;
    });
    return {
      supplier_id: state.supplierId,
      lines: linesOut,
      notes: state.notes || null,
    };
  }

  async function doSave({ markSentAfter } = {}) {
    let payload;
    try { payload = buildPayload(); }
    catch (e) { showToast(e.message, 'warn'); return null; }

    state.saving = true;
    try {
      const saved = isNew
        ? await apiPost('/supplier-orders', payload)
        : await apiPatch(`/supplier-orders/${orderId}`, payload);
      showToast(isNew ? 'Bozza creata' : 'Modifiche salvate', 'success', 2500);
      if (!markSentAfter) {
        navigate(`/riordini/${saved.id}`, { replace: true });
      }
      return saved;
    } catch (err) {
      showToast(err.message || 'Errore salvataggio', 'danger', 5000);
      return null;
    } finally {
      state.saving = false;
    }
  }

  async function sendWhatsApp() {
    // Open a blank window FIRST while we're still in the user gesture stack
    // (so popup blockers don't trip). We'll set its URL right after the save.
    const newWin = window.open('about:blank', '_blank');
    try {
      const saved = await doSave({ markSentAfter: true });
      if (!saved) {
        if (newWin) newWin.close();
        return;
      }
      const url = saved.whatsapp_url;
      if (!url) {
        if (newWin) newWin.close();
        showToast('Fornitore senza numero WhatsApp/telefono. Aggiungilo dalla scheda fornitore.', 'warn', 6000);
        return;
      }
      if (newWin && !newWin.closed) {
        newWin.location.href = url;
      } else {
        showToast('Popup bloccato. Copia il link:\n' + url, 'warn', 10000);
      }
      // After opening WhatsApp, ask user if they actually sent it
      showModal(
        'Hai inviato l\'ordine?',
        `<p>Conferma per spostare l'ordine nello stato <strong>"Inviato"</strong> e snapshottare il messaggio.</p>`,
        [
          { label: 'Non ancora', variant: 'ghost' },
          { label: 'Sì, segna come inviato', variant: 'primary', closeOnClick: false, onClick: async (close) => {
            try {
              await apiPost(`/supplier-orders/${saved.id}/mark-sent`);
              showToast('Ordine inviato', 'success');
              close();
              navigate('/riordini?tab=inviati');
            } catch (err) {
              showToast(err.message || 'Errore mark-sent', 'danger', 5000);
            }
          }},
        ],
      );
    } catch (err) {
      if (newWin) newWin.close();
      showToast(err.message || 'Errore', 'danger');
    }
  }

  async function cancelDraft() {
    const ok = await confirmDialog(
      'Annullare l\'ordine?',
      'L\'ordine sarà marcato come "cancelled" e le segnalazioni collegate torneranno aperte.',
      { confirmLabel: 'Annulla ordine', cancelLabel: 'No', danger: true },
    );
    if (!ok) return;
    try {
      await apiPost(`/supplier-orders/${orderId}/cancel`);
      showToast('Ordine annullato', 'success');
      navigate('/riordini?tab=bozze');
    } catch (err) {
      showToast(err.message || 'Errore', 'danger', 5000);
    }
  }

  async function markReceived() {
    const ok = await confirmDialog(
      'Segnare come ricevuto?',
      'Confermi che la merce è arrivata? Ricorda di caricare i lotti dal Magazzino.',
      { confirmLabel: 'Sì, ricevuto', cancelLabel: 'No' },
    );
    if (!ok) return;
    try {
      await apiPost(`/supplier-orders/${orderId}/mark-received`);
      showToast('Ordine segnato come ricevuto', 'success');
      navigate('/riordini?tab=inviati');
    } catch (err) {
      showToast(err.message || 'Errore', 'danger', 5000);
    }
  }

  async function cancelOrder() {
    const ok = await confirmDialog(
      'Annullare l\'ordine?',
      'Le segnalazioni collegate torneranno aperte.',
      { confirmLabel: 'Annulla', cancelLabel: 'No', danger: true },
    );
    if (!ok) return;
    try {
      await apiPost(`/supplier-orders/${orderId}/cancel`);
      showToast('Ordine annullato', 'success');
      navigate('/riordini?tab=inviati');
    } catch (err) {
      showToast(err.message || 'Errore', 'danger', 5000);
    }
  }
}

// -------------------- Helpers --------------------

function errorCard(msg) {
  return `<div class="container" style="padding-top: var(--space-20);">
    <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
    <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(msg)}</p></div></div></div>`;
}

function formatQty(qty) {
  const n = Number(qty);
  if (Number.isNaN(n)) return '—';
  return Number.isInteger(n) ? n.toString() : n.toFixed(2);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
