// /riordini — 3 tab Aperte / Bozze / Inviati (manager/admin).

import { apiGet } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { icon } from '../../js/icons.js';
import { showToast, skeletonList } from '../../js/components.js';

const STATUS_LABEL = {
  draft:     { label: 'Bozza',     cls: 'badge' },
  sent:      { label: 'Inviato',   cls: 'badge badge--warn' },
  received:  { label: 'Ricevuto',  cls: 'badge badge--success' },
  cancelled: { label: 'Annullato', cls: 'badge badge--danger' },
};

export function mountReordersList(container, _params, query) {
  const tab = ['aperte', 'bozze', 'inviati'].includes(query.tab) ? query.tab : 'aperte';

  setHeader({
    title: 'Riordini',
    brand: true,
    backHref: '/',
    actions: [
      { label: 'Previsti', iconName: 'bar-chart', onClick: () => navigate('/riordini-previsti') },
    ],
  });

  container.innerHTML = `
    <section class="container" style="padding-block: var(--space-20); padding-bottom: 96px;">
      <div class="row" style="gap: var(--space-8); margin-bottom: var(--space-20); flex-wrap: wrap;">
        ${tabPill('aperte', 'Aperte', tab === 'aperte')}
        ${tabPill('bozze', 'Bozze', tab === 'bozze')}
        ${tabPill('inviati', 'Inviati', tab === 'inviati')}
      </div>
      <div id="rr-results">${skeletonList(3)}</div>
    </section>
  `;

  container.querySelectorAll('[data-tab]').forEach((b) => {
    b.addEventListener('click', () => navigate(`/riordini?tab=${b.dataset.tab}`, { replace: true }));
  });

  const resultsEl = container.querySelector('#rr-results');
  load();
  return () => {};

  // -----------------------------------------------------------------

  async function load() {
    try {
      if (tab === 'aperte') {
        const groups = await apiGet('/alerts/open');
        renderAperte(groups);
      } else if (tab === 'bozze') {
        const orders = await apiGet('/supplier-orders?status=draft&limit=200');
        renderOrders(orders, 'Nessun ordine in bozza.');
      } else {
        // inviati: sent + received + cancelled (in one chronological feed)
        const [sent, recv, can] = await Promise.all([
          apiGet('/supplier-orders?status=sent&limit=200'),
          apiGet('/supplier-orders?status=received&limit=200'),
          apiGet('/supplier-orders?status=cancelled&limit=200'),
        ]);
        const all = [...sent, ...recv, ...can]
          .sort((a, b) => (b.sent_at || b.created_at).localeCompare(a.sent_at || a.created_at));
        renderOrders(all, 'Nessun ordine ancora inviato.');
      }
    } catch (err) {
      showToast(err.message || 'Errore caricamento', 'danger', 4000);
      resultsEl.innerHTML = errorCard(err.message || '');
    }
  }

  function renderAperte(groups) {
    const groupsWithAlerts = groups.filter((g) => (g.alerts || []).length > 0);
    if (groupsWithAlerts.length === 0) {
      resultsEl.innerHTML = emptyState('Nessuna segnalazione aperta',
        'Quando lo staff segnalerà scorte scarse o finite, le troverai qui raggruppate per fornitore.');
      return;
    }
    resultsEl.innerHTML = `<div class="stack-16">${groupsWithAlerts.map(groupCard).join('')}</div>`;
    resultsEl.querySelectorAll('[data-prepare]').forEach((b) => {
      b.addEventListener('click', () => {
        const sid = b.dataset.supplierId;
        const alertIds = b.dataset.alertIds;
        const target = sid
          ? `/riordini/nuovo?supplier_id=${sid}&from_alerts=${alertIds}`
          : `/riordini/nuovo?from_alerts=${alertIds}`;
        navigate(target);
      });
    });
  }

  function groupCard(g) {
    const supName = g.supplier ? g.supplier.name : 'Senza fornitore preferito';
    const alertIds = g.alerts.map((a) => a.id).join(',');
    const supplierIdAttr = g.supplier ? g.supplier.id : '';
    const items = g.alerts.map((a) => {
      const sev = a.status_signaled === 'out' ? 'badge--danger' : 'badge--warn';
      const sevLabel = a.status_signaled === 'out' ? 'Finito' : 'Scarso';
      const qtyTotal = a.product?.qty_total != null
        ? `${formatQty(a.product.qty_total)} ${a.product?.unit || ''}`
        : '—';
      const suggested = a.suggested_qty
        ? `<span class="muted text-xs">richiesti ${formatQty(a.suggested_qty)}</span>`
        : '';
      const systemBadge = a.source === 'system'
        ? `<span class="badge" style="background: var(--cream-soft); color: var(--ink-muted); white-space: nowrap;" title="${escapeHtml(a.notes || 'Generato dal sistema')}">🤖 sistema</span>`
        : '';
      const noteHtml = a.notes && a.source !== 'system'
        ? `<p class="muted text-xs" style="margin: var(--space-4) 0 0 0; font-style: italic;">📝 ${escapeHtml(a.notes)}${a.signaled_by_name ? ` — ${escapeHtml(a.signaled_by_name)}` : ''}</p>`
        : '';
      return `<div style="padding: var(--space-8) 0; border-top: 1px solid var(--border-soft);">
        <div class="row" style="gap: var(--space-8); align-items: center; flex-wrap: wrap;">
          <span class="badge ${sev}">${sevLabel}</span>
          ${systemBadge}
          <span class="flex-1 text-sm" style="min-width: 0;"><strong>${escapeHtml(a.product?.name || `#${a.product_id}`)}</strong></span>
        </div>
        <div class="row" style="gap: var(--space-8); align-items: baseline; margin-top: var(--space-4);">
          <span class="muted text-xs" style="white-space:nowrap;">stock ${qtyTotal}</span>
          ${suggested}
        </div>
        ${noteHtml}
      </div>`;
    }).join('');
    const cta = g.supplier
      ? `<button type="button" data-prepare data-supplier-id="${supplierIdAttr}" data-alert-ids="${alertIds}" class="btn btn--primary">${icon('plus', { size: 18 })}<span>Prepara ordine</span></button>`
      : `<p class="muted text-sm" style="margin:0;">Imposta un fornitore preferito su questi prodotti per generare l'ordine.</p>`;
    return `
      <div class="card stack-12">
        <div class="row" style="gap: var(--space-8);">
          <p class="font-display text-xl" style="margin:0;">${escapeHtml(supName)}</p>
          <span class="badge">${g.alerts.length}</span>
        </div>
        <div>${items}</div>
        <div class="row" style="justify-content: flex-end;">${cta}</div>
      </div>`;
  }

  function renderOrders(orders, emptyMsg) {
    if (!orders || orders.length === 0) {
      resultsEl.innerHTML = emptyState('Niente da mostrare', emptyMsg);
      return;
    }
    resultsEl.innerHTML = `<div class="stack-12">${orders.map(orderCard).join('')}</div>`;
    resultsEl.querySelectorAll('[data-oid]').forEach((el) => {
      el.addEventListener('click', () => navigate(`/riordini/${el.dataset.oid}`));
    });
  }

  function orderCard(o) {
    const meta = STATUS_LABEL[o.status] || { label: o.status, cls: 'badge' };
    const supName = o.supplier ? o.supplier.name : '—';
    const lineCount = (o.lines || []).length;
    const total = (o.lines || []).reduce((s, l) => s + (Number(l.qty) * Number(l.unit_price || 0)), 0);
    const totalStr = total > 0 ? ` · stima € ${total.toFixed(2)}` : '';
    const when = o.sent_at ? `inviato ${humanDate(o.sent_at)}` : `creato ${humanDate(o.created_at)}`;
    return `
      <div class="card" data-oid="${o.id}" style="cursor: pointer; min-height: 56px;">
        <div class="row" style="gap: var(--space-12);">
          <div class="flex-1" style="min-width:0;">
            <p class="font-display text-lg" style="margin:0;">${escapeHtml(supName)}</p>
            <p class="muted text-xs" style="margin: var(--space-4) 0 0 0;">${lineCount} ${lineCount === 1 ? 'riga' : 'righe'}${escapeHtml(totalStr)} · ${escapeHtml(when)}</p>
          </div>
          <span class="${meta.cls}">${escapeHtml(meta.label)}</span>
        </div>
      </div>`;
  }
}

// -------------------- Helpers --------------------

function tabPill(id, label, active) {
  return `<button type="button" data-tab="${id}" class="pill ${active ? 'pill--success' : ''}" style="cursor:pointer; border:none; white-space:nowrap;">${escapeHtml(label)}</button>`;
}

function emptyState(title, message) {
  return `<div class="card center-text" style="padding: var(--space-32);">
    <div style="color: var(--ink-soft); margin-bottom: var(--space-16);">${icon('inventory', { size: 56 })}</div>
    <h3 class="font-display text-xl" style="margin: 0 0 var(--space-8) 0;">${escapeHtml(title)}</h3>
    <p class="muted">${escapeHtml(message)}</p>
  </div>`;
}

function errorCard(msg) {
  return `<div class="alert alert--urgent">
    <span class="alert__icon">${icon('alert', { size: 22 })}</span>
    <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(msg)}</p></div></div>`;
}

function humanDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
}

function formatQty(qty) {
  const n = Number(qty);
  if (Number.isNaN(n)) return '—';
  return Number.isInteger(n) ? n.toString() : n.toFixed(2);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
