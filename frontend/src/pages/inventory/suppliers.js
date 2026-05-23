// /fornitori — admin/manager only. List + create + edit.

import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { icon } from '../../js/icons.js';
import { showToast, showModal, confirmDialog, skeletonList } from '../../js/components.js';

export function mountInventorySuppliers(container) {
  setHeader({
    title: 'Fornitori',
    brand: true,
    backHref: '/',
    actions: [{
      label: 'Nuovo',
      iconName: 'plus',
      onClick: () => openEditModal(null),
    }],
  });

  container.innerHTML = `
    <section class="container" style="padding-block: var(--space-20); padding-bottom: 96px;">
      <div class="input-group" style="margin-bottom: var(--space-16);">
        <span class="input-group__icon">${icon('search', { size: 18 })}</span>
        <input id="supp-search" class="input" type="search" placeholder="Cerca fornitore…" />
      </div>
      <div id="supp-list">${skeletonList(3)}</div>
    </section>
  `;

  const searchEl = container.querySelector('#supp-search');
  const listEl = container.querySelector('#supp-list');
  let suppliers = [];
  let search = '';

  let timer;
  searchEl.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      search = searchEl.value.trim().toLowerCase();
      renderList();
    }, 200);
  });

  refresh();

  return () => clearTimeout(timer);

  // -----------------------------------------------------------------

  async function refresh() {
    try {
      suppliers = await apiGet('/suppliers?include_inactive=true');
      renderList();
    } catch (err) {
      listEl.innerHTML = `<div class="alert alert--urgent">
        <span class="alert__icon">${icon('alert', { size: 22 })}</span>
        <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(err.message || '')}</p></div></div>`;
    }
  }

  function renderList() {
    let list = suppliers;
    if (search) list = list.filter((s) => (s.name || '').toLowerCase().includes(search));
    if (list.length === 0) {
      listEl.innerHTML = `<div class="card center-text" style="padding: var(--space-32);">
        <div style="color: var(--ink-soft); margin-bottom: var(--space-16);">${icon('phone', { size: 56 })}</div>
        <h3 class="font-display text-xl" style="margin: 0 0 var(--space-8) 0;">Nessun fornitore</h3>
        <p class="muted">Aggiungi il primo dal pulsante in alto a destra.</p></div>`;
      return;
    }
    listEl.innerHTML = `<div class="stack-12">${list.map(card).join('')}</div>`;

    listEl.querySelectorAll('[data-edit]').forEach((b) => {
      b.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-stop]')) return;
        const id = Number(b.dataset.edit);
        openEditModal(suppliers.find((s) => s.id === id));
      });
    });
    listEl.querySelectorAll('[data-wa]').forEach((a) => {
      a.addEventListener('click', (ev) => ev.stopPropagation());
    });
    listEl.querySelectorAll('[data-tel]').forEach((a) => {
      a.addEventListener('click', (ev) => ev.stopPropagation());
    });
  }

  function card(s) {
    const inactive = !s.active;
    const tel = s.phone ? `<a href="tel:${escapeAttr(s.phone.replace(/\s+/g, ''))}" data-tel data-stop class="btn btn--ghost btn--sm">${icon('phone', { size: 16 })}<span>${escapeHtml(s.phone)}</span></a>` : '';
    const waDigits = s.whatsapp ? s.whatsapp.replace(/\D/g, '') : '';
    const wa = waDigits ? `<a href="https://wa.me/${waDigits}" target="_blank" rel="noopener" data-wa data-stop class="btn btn--ghost btn--sm" style="color: var(--bottle-green);">${icon('whatsapp', { size: 16 })}<span>WhatsApp</span></a>` : '';
    return `
      <div class="card" data-edit="${s.id}" style="cursor: pointer; min-height: 56px;">
        <div class="row row--top" style="gap: var(--space-16); align-items: flex-start;">
          <div class="flex-1" style="min-width: 0;">
            <div class="row" style="gap: var(--space-8);">
              <p class="font-display text-lg" style="margin:0;">${escapeHtml(s.name)}</p>
              ${inactive ? `<span class="badge badge--danger">Disattivo</span>` : ''}
            </div>
            ${s.contact_name ? `<p class="muted text-xs" style="margin: var(--space-4) 0 0 0;">${escapeHtml(s.contact_name)}</p>` : ''}
            ${(tel || wa) ? `<div class="row" style="gap: var(--space-8); margin-top: var(--space-8);">${tel}${wa}</div>` : ''}
          </div>
          <div class="muted" style="margin-top: var(--space-4);">${icon('chevron-right', { size: 18 })}</div>
        </div>
      </div>`;
  }

  function openEditModal(supplier) {
    const isNew = !supplier;
    const s = supplier || { name: '', contact_name: '', phone: '', whatsapp: '', email: '', notes: '', active: true };
    const body = `
      <form id="supp-form" class="stack-12">
        <div class="form-row"><label class="label label--required" for="sf-name">Nome</label>
          <input id="sf-name" class="input" required maxlength="160" value="${escapeAttr(s.name)}"></div>
        <div class="form-row"><label class="label" for="sf-contact">Referente</label>
          <input id="sf-contact" class="input" maxlength="160" value="${escapeAttr(s.contact_name || '')}"></div>
        <div class="grid-2">
          <div class="form-row"><label class="label" for="sf-phone">Telefono</label>
            <input id="sf-phone" class="input" maxlength="40" value="${escapeAttr(s.phone || '')}"></div>
          <div class="form-row"><label class="label" for="sf-wa">WhatsApp E.164</label>
            <input id="sf-wa" class="input" maxlength="40" placeholder="+393331112233" value="${escapeAttr(s.whatsapp || '')}"></div>
        </div>
        <div class="form-row"><label class="label" for="sf-email">Email</label>
          <input id="sf-email" class="input" type="email" maxlength="255" value="${escapeAttr(s.email || '')}"></div>
        <div class="form-row"><label class="label" for="sf-notes">Note</label>
          <textarea id="sf-notes" class="textarea">${escapeHtml(s.notes || '')}</textarea></div>
      </form>
    `;
    const actions = [
      { label: 'Annulla', variant: 'ghost' },
      { label: isNew ? 'Crea' : 'Salva', variant: 'primary', closeOnClick: false, onClick: async (close) => {
        const payload = {
          name: document.getElementById('sf-name').value.trim(),
          contact_name: document.getElementById('sf-contact').value.trim() || null,
          phone: document.getElementById('sf-phone').value.trim() || null,
          whatsapp: document.getElementById('sf-wa').value.trim() || null,
          email: document.getElementById('sf-email').value.trim() || null,
          notes: document.getElementById('sf-notes').value.trim() || null,
        };
        if (!payload.name) { showToast('Il nome è obbligatorio.', 'warn'); return; }
        try {
          if (isNew) {
            await apiPost('/suppliers', payload);
            showToast('Fornitore creato', 'success');
          } else {
            await apiPatch(`/suppliers/${s.id}`, payload);
            showToast('Modifiche salvate', 'success');
          }
          close();
          refresh();
        } catch (err) {
          showToast(err.message || 'Errore salvataggio', 'danger', 5000);
        }
      } },
    ];
    if (!isNew && s.active) {
      actions.unshift({
        label: 'Disattiva',
        variant: 'danger',
        closeOnClick: false,
        onClick: async (close) => {
          const ok = await confirmDialog(
            `Disattivare "${s.name}"?`,
            'Il fornitore non sarà più selezionabile nei nuovi carichi. I lotti già caricati restano collegati.',
            { confirmLabel: 'Disattiva', cancelLabel: 'Annulla', danger: true },
          );
          if (!ok) return;
          try {
            await apiDelete(`/suppliers/${s.id}`);
            showToast('Fornitore disattivato', 'success');
            close();
            refresh();
          } catch (err) {
            showToast(err.message || 'Errore disattivazione', 'danger', 5000);
          }
        },
      });
    }
    showModal(isNew ? 'Nuovo fornitore' : `Modifica fornitore`, body, actions);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
