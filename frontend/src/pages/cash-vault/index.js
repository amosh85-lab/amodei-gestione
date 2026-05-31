// /cassaforte — gestione cassaforte: saldo, baseline, movimenti, uscite manuali.
// Solo admin.

import { apiGet, apiPost, apiPut, apiDelete, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { icon } from '../../js/icons.js';
import { showModal, showToast, confirmDialog, skeletonList } from '../../js/components.js';

export async function mountCashVault(container, _params, _query) {
  setHeader({
    title: 'Cassaforte',
    brand: true,
    backHref: '/',
  });

  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(4)}</div>`;

  const state = {
    balance: null,
    movements: [],
    loading: true,
  };

  await load();
  return () => {};

  async function load() {
    try {
      const today = new Date();
      const from = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
      // Mese corrente (movimenti): se l'utente vuole vedere oltre, va a pagina filtri (TODO future)
      const [balance, movements] = await Promise.all([
        apiGet('/cash-vault/balance?last_n=0'),  // last_n=0: ci pensiamo noi sotto
        apiGet(`/cash-vault/movements?from=${from}&limit=1000`),
      ]);
      state.balance = balance;
      state.movements = movements;
      render();
    } catch (err) {
      container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
        <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
        <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(err.message || '')}</p></div></div></div>`;
    }
  }

  function render() {
    const b = state.balance || {};
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 110px;">

        <!-- Saldo card (dark) -->
        <div style="background: var(--ink); color: var(--off-white); border-radius: var(--radius-xl); padding: var(--space-24); box-shadow: var(--shadow-lg);">
          <p style="margin:0; font-size: var(--text-xs); opacity: 0.7; text-transform: uppercase; letter-spacing: var(--letter-spacing-wide); color: inherit;">Saldo cassaforte</p>
          <p class="font-display" style="margin: var(--space-8) 0 0 0; font-size: 3rem; font-weight: 600; line-height: 1; color: inherit;">€ ${formatMoney(b.balance)}</p>
          <div style="margin-top: var(--space-16); padding-top: var(--space-12); border-top: 1px solid rgba(255,255,255,0.15); display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-8); text-align: center;">
            <div>
              <p style="margin:0; font-size: 10px; opacity: 0.6; text-transform: uppercase; color: inherit;">Iniziale</p>
              <p class="font-display" style="margin: var(--space-4) 0 0 0; font-size: 1rem; color: inherit;">€ ${formatMoney(b.baseline)}</p>
            </div>
            <div>
              <p style="margin:0; font-size: 10px; opacity: 0.6; text-transform: uppercase; color: inherit;">+ Cassa</p>
              <p class="font-display" style="margin: var(--space-4) 0 0 0; font-size: 1rem; color: var(--bottle-green, #4f8e3a);">€ ${formatMoney(b.auto_total)}</p>
            </div>
            <div>
              <p style="margin:0; font-size: 10px; opacity: 0.6; text-transform: uppercase; color: inherit;">+ Manuali</p>
              <p class="font-display" style="margin: var(--space-4) 0 0 0; font-size: 1rem; color: var(--bottle-green, #4f8e3a);">€ ${formatMoney(b.manual_in_total)}</p>
            </div>
            <div>
              <p style="margin:0; font-size: 10px; opacity: 0.6; text-transform: uppercase; color: inherit;">− Uscite</p>
              <p class="font-display" style="margin: var(--space-4) 0 0 0; font-size: 1rem; color: var(--terracotta);">€ ${formatMoney(b.manual_out_total)}</p>
            </div>
          </div>
          ${b.baseline_date ? `<p class="text-xs" style="margin: var(--space-12) 0 0 0; opacity: 0.55; color: inherit;">Saldo iniziale impostato al ${humanDate(b.baseline_date)}</p>` : ''}
        </div>

        <!-- Actions: stack verticale per stare comodi su mobile senza sforare -->
        <div class="stack-8" style="margin-top: var(--space-16);">
          <button type="button" id="add-in" class="btn btn--secondary btn--lg full-width" style="border-color: var(--bottle-green, #4f8e3a); color: var(--bottle-green, #4f8e3a);">
            ${icon('plus', { size: 18 })}<span>Aggiungi entrata</span>
          </button>
          <button type="button" id="add-out" class="btn btn--primary btn--lg full-width">
            ${icon('plus', { size: 18 })}<span>Aggiungi uscita</span>
          </button>
          <button type="button" id="set-baseline" class="btn btn--ghost full-width">
            ${icon('edit', { size: 16 })}<span>Modifica saldo iniziale</span>
          </button>
        </div>

        <!-- Movimenti del mese corrente -->
        <div style="margin-top: var(--space-20);">
          <p class="card__meta" style="margin: 0 0 var(--space-8) 0;">Movimenti del mese (${state.movements.length})</p>
          ${state.movements.length === 0
            ? `<p class="muted text-sm" style="text-align:center; padding: var(--space-16); background: var(--cream-soft); border-radius: var(--radius-md);">Nessun movimento questo mese.</p>`
            : `<div class="card stack-8">${state.movements.map(movementRow).join('')}</div>`}
        </div>
      </section>
    `;
    wire();
  }

  function movementRow(m) {
    const isOut = Number(m.amount) < 0;
    const amountAbs = Math.abs(Number(m.amount));
    const color = isOut ? 'var(--terracotta-dark)' : 'var(--bottle-green, #4f8e3a)';
    const sign = isOut ? '−' : '+';
    const kindBadge = m.kind === 'baseline'
      ? '<span class="badge" style="background: var(--cream-soft); color: var(--ink-muted); font-size: var(--text-xs);">iniziale</span>'
      : m.kind === 'auto_daily'
        ? '<span class="badge" style="background: rgba(79,142,58,0.12); color: var(--bottle-green, #4f8e3a); font-size: var(--text-xs);">auto fine giornata</span>'
        : m.kind === 'manual_in'
          ? '<span class="badge" style="background: rgba(79,142,58,0.12); color: var(--bottle-green, #4f8e3a); font-size: var(--text-xs);">entrata manuale</span>'
          : '<span class="badge" style="background: rgba(181,57,31,0.10); color: var(--terracotta-dark); font-size: var(--text-xs);">uscita</span>';
    const canDelete = m.kind === 'manual_in' || m.kind === 'manual_out';
    return `
      <div class="row" style="gap: var(--space-12); padding: var(--space-12) 0; border-top: 1px solid var(--border-soft);">
        <div class="flex-1" style="min-width:0;">
          <p style="margin:0; font-weight: 500;">${escapeHtml(m.description || '—')}</p>
          <p class="muted text-xs" style="margin: var(--space-4) 0 0 0;">${humanDate(m.movement_date)} · ${kindBadge}${m.created_by_name ? ` · ${escapeHtml(m.created_by_name)}` : ''}</p>
        </div>
        <p style="margin:0; font-family: var(--font-display); font-size: var(--text-lg); color: ${color}; white-space: nowrap;">${sign} € ${formatMoney(amountAbs)}</p>
        ${canDelete ? `<button type="button" data-del="${m.id}" class="btn btn--ghost btn--icon" aria-label="Elimina">${icon('trash', { size: 14 })}</button>` : ''}
      </div>
    `;
  }

  function wire() {
    container.querySelector('#add-in')?.addEventListener('click', () => openManualMovementModal('in'));
    container.querySelector('#add-out')?.addEventListener('click', () => openManualMovementModal('out'));
    container.querySelector('#set-baseline')?.addEventListener('click', openBaselineModal);
    container.querySelectorAll('[data-del]').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = Number(b.dataset.del);
        const ok = await confirmDialog('Eliminare il movimento?', 'L\'azione è irreversibile.', { confirmLabel: 'Elimina', danger: true });
        if (!ok) return;
        try {
          await apiDelete(`/cash-vault/movements/${id}`);
          showToast('Movimento eliminato', 'success');
          await load();
        } catch (err) {
          showToast(err.message || 'Errore', 'danger', 5000);
        }
      });
    });
  }

  function openManualMovementModal(direction) {
    const isIn = direction === 'in';
    const title = isIn ? 'Nuova entrata' : 'Nuova uscita';
    const placeholder = isIn
      ? 'es. Versamento da conto personale'
      : 'es. Pagamento fornitore X';
    const endpoint = isIn ? '/cash-vault/movements/in' : '/cash-vault/movements';
    const successMsg = isIn ? 'Entrata registrata' : 'Uscita registrata';
    const today = new Date().toISOString().slice(0, 10);
    const body = `
      <form id="mv-form" class="stack-12" onsubmit="return false">
        <div class="form-row">
          <label class="label label--required" for="mv-amount">Importo €</label>
          <input id="mv-amount" type="number" class="input" step="0.01" min="0.01" inputmode="decimal" required>
        </div>
        <div class="form-row">
          <label class="label label--required" for="mv-desc">Causale</label>
          <input id="mv-desc" class="input" maxlength="255" required placeholder="${escapeAttr(placeholder)}">
        </div>
        <div class="form-row">
          <label class="label label--required" for="mv-date">Data</label>
          <input id="mv-date" type="date" class="input" required value="${today}">
        </div>
      </form>
    `;
    const close = showModal(title, body, [
      { label: 'Annulla', variant: 'ghost' },
      {
        label: 'Salva', variant: 'primary', closeOnClick: false,
        onClick: async () => {
          const amount = parseFloat(document.getElementById('mv-amount').value);
          const description = document.getElementById('mv-desc').value.trim();
          const date = document.getElementById('mv-date').value;
          if (!(amount > 0)) { showToast('Importo non valido', 'warn'); return; }
          if (!description) { showToast('Causale obbligatoria', 'warn'); return; }
          if (!date) { showToast('Data obbligatoria', 'warn'); return; }
          try {
            await apiPost(endpoint, { amount: amount.toFixed(2), description, date });
            showToast(successMsg, 'success');
            close();
            await load();
          } catch (err) {
            const msg = err instanceof ApiError ? (err.detail || err.message) : (err.message || 'Errore');
            showToast(msg, 'danger', 5000);
          }
        },
      },
    ]);
  }

  function openBaselineModal() {
    const b = state.balance || {};
    const todayIso = new Date().toISOString().slice(0, 10);
    const body = `
      <p class="muted text-sm" style="margin: 0 0 var(--space-12) 0;">Il saldo iniziale è il contante che hai in cassaforte <strong>la mattina della data scelta</strong>. Dalla chiusura cassa di quel giorno in poi, il saldo cresce automaticamente con il cash di fine serata di ogni giornata già registrata in /cassa (anche i giorni passati vengono recuperati). Cala con le uscite manuali. Sovrascrive l'eventuale baseline precedente.</p>
      <form id="bl-form" class="stack-12" onsubmit="return false">
        <div class="form-row">
          <label class="label label--required" for="bl-amount">Saldo iniziale €</label>
          <input id="bl-amount" type="number" class="input" step="0.01" min="0" inputmode="decimal" required value="${b.baseline != null ? Number(b.baseline).toFixed(2) : ''}">
        </div>
        <div class="form-row">
          <label class="label label--required" for="bl-date">Data del saldo</label>
          <input id="bl-date" type="date" class="input" required value="${b.baseline_date || todayIso}">
        </div>
        <div class="form-row">
          <label class="label" for="bl-desc">Nota (opzionale)</label>
          <input id="bl-desc" class="input" maxlength="255" placeholder="es. Conta iniziale di giugno">
        </div>
      </form>
    `;
    const close = showModal('Saldo iniziale cassaforte', body, [
      { label: 'Annulla', variant: 'ghost' },
      {
        label: 'Salva', variant: 'primary', closeOnClick: false,
        onClick: async () => {
          const amount = parseFloat(document.getElementById('bl-amount').value);
          const date = document.getElementById('bl-date').value;
          const description = document.getElementById('bl-desc').value.trim() || null;
          if (!(amount >= 0)) { showToast('Importo non valido', 'warn'); return; }
          if (!date) { showToast('Data obbligatoria', 'warn'); return; }
          try {
            await apiPut('/cash-vault/baseline', { amount: amount.toFixed(2), date, description });
            showToast('Saldo iniziale aggiornato', 'success');
            close();
            await load();
          } catch (err) {
            const msg = err instanceof ApiError ? (err.detail || err.message) : (err.message || 'Errore');
            showToast(msg, 'danger', 5000);
          }
        },
      },
    ]);
  }
}

function formatMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0,00';
  return n.toFixed(2).replace('.', ',');
}
function humanDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
