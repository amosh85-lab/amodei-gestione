// /acconti — employee advances dashboard (manager/admin).
//
// Top: KPI (Da saldare totale, Saldati questo mese, count utenti con debito).
// Three tabs:
//   - Da saldare (default): grouped by employee, bottone "Marca come saldati"
//     (admin only) per dipendente; modal chiede il payroll_month.
//   - Saldati: filtra per payroll_month via selettore mese, gruppo per
//     dipendente, ogni acconto ha bottone "Annulla saldo" (admin only).
//   - Tutti: lista cronologica filtri liberi (filtro da/a + dipendente).

import { apiGet, apiPost, apiDelete, ApiError } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { userHasRole } from '../../js/auth.js';
import { icon } from '../../js/icons.js';
import { showModal, showToast, confirmDialog, skeletonList } from '../../js/components.js';

export async function mountAdvancesList(container, _params, query) {
  setHeader({ title: 'Acconti dipendenti', brand: true, backHref: '/cassa' });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(3)}</div>`;

  const isAdmin = userHasRole('admin');
  const state = {
    tab: ['unsettled', 'settled', 'all'].includes(query.tab) ? query.tab : 'unsettled',
    settledMonth: query.payroll || isoMonth(new Date()),
    error: null,
    unsettledGroups: [],
    settledList: [],
    allList: [],
    summary: null,
  };

  await load();
  return () => {};

  async function load() {
    state.error = null;
    try {
      const [unsettledGroups, summary, settledList, allList] = await Promise.all([
        apiGet('/advances/by-employee?settled=false'),
        apiGet('/advances/summary/monthly'),
        apiGet(`/advances?settled=true&payroll_month=${state.settledMonth}`),
        apiGet('/advances'),                  // current month, all states
      ]);
      state.unsettledGroups = unsettledGroups;
      state.summary = summary;
      state.settledList = settledList;
      state.allList = allList;
      render();
    } catch (err) {
      state.error = err.message || 'Errore di rete';
      container.innerHTML = errorBlock(state.error, load);
    }
  }

  function render() {
    container.innerHTML = `
      <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
        ${renderKpi()}
        ${renderTabs()}
        <div id="adv-body" style="margin-top: var(--space-16);">${renderBody()}</div>
      </section>
    `;
    wire();
  }

  function renderKpi() {
    const u = Number(state.summary?.unsettled_total || 0);
    const s = Number(state.summary?.total_amount_settled || 0);
    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-8); margin-bottom: var(--space-16);">
        <div class="card" style="padding: var(--space-12);">
          <p class="muted text-xs" style="margin:0; text-transform: uppercase; letter-spacing: var(--letter-spacing-wide);">Da saldare</p>
          <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 1.6rem; font-weight: 600; color: var(--terracotta-dark);">€ ${formatMoney(u)}</p>
          <p class="muted text-xs" style="margin: 2px 0 0 0;">${state.unsettledGroups.length} dipendenti</p>
        </div>
        <div class="card" style="padding: var(--space-12);">
          <p class="muted text-xs" style="margin:0; text-transform: uppercase; letter-spacing: var(--letter-spacing-wide);">Saldati nel mese</p>
          <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 1.6rem; font-weight: 600;">€ ${formatMoney(s)}</p>
          <p class="muted text-xs" style="margin: 2px 0 0 0;">busta ${escapeHtml(isoMonth(new Date()))}</p>
        </div>
      </div>
    `;
  }

  function renderTabs() {
    return `
      <div class="row" style="gap: var(--space-8); margin-bottom: var(--space-12); flex-wrap: wrap;">
        ${tabPill('unsettled', 'Da saldare', state.tab === 'unsettled')}
        ${tabPill('settled',   'Saldati',    state.tab === 'settled')}
        ${tabPill('all',       'Tutti',      state.tab === 'all')}
      </div>
    `;
  }

  function tabPill(id, label, active) {
    return `<button type="button" data-tab="${id}" class="badge"
      style="padding: var(--space-8) var(--space-12); border-radius: 999px; border: 1px solid ${active ? 'var(--terracotta)' : 'var(--border-soft)'}; background: ${active ? 'var(--terracotta)' : 'var(--off-white)'}; color: ${active ? 'var(--off-white)' : 'var(--ink)'}; cursor: pointer;">${label}</button>`;
  }

  function renderBody() {
    if (state.tab === 'unsettled') return renderUnsettled();
    if (state.tab === 'settled') return renderSettled();
    return renderAll();
  }

  function renderUnsettled() {
    if (state.unsettledGroups.length === 0) {
      return emptyCard('Tutti gli acconti sono saldati. 🎉');
    }
    return state.unsettledGroups.map((g) => `
      <div class="card" style="padding: var(--space-12); margin-bottom: var(--space-12);">
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: var(--space-8); gap: var(--space-8);">
          <div>
            <p style="margin:0; font-weight: 600;">${escapeHtml(g.user.full_name)}</p>
            <p class="muted text-xs" style="margin: 2px 0 0 0;">${g.count} ${g.count === 1 ? 'acconto' : 'acconti'} · ${g.user.role}</p>
          </div>
          <p style="margin:0; font-family: var(--font-display); font-size: 1.4rem; color: var(--terracotta-dark);">€ ${formatMoney(g.total_amount)}</p>
        </div>
        <div style="border-top: 1px solid var(--border-soft); padding-top: var(--space-8);">
          ${g.advances.map(advanceCompactRow).join('')}
        </div>
        ${isAdmin ? `
          <button type="button" data-settle-user="${g.user.id}" class="btn btn--primary full-width" style="margin-top: var(--space-12);">
            ${icon('check', { size: 16 })}<span>Marca come saldati</span>
          </button>` : ''}
      </div>
    `).join('');
  }

  function renderSettled() {
    return `
      <div class="card" style="padding: var(--space-12); margin-bottom: var(--space-12);">
        <label class="label" for="adv-month" style="margin:0;">Busta paga</label>
        <input type="month" id="adv-month" class="input" value="${escapeAttr(state.settledMonth)}">
      </div>
      ${state.settledList.length === 0
        ? emptyCard(`Nessun acconto saldato nel mese ${escapeHtml(state.settledMonth)}.`)
        : `<div class="card" style="padding: 0;">${groupByUser(state.settledList).map((g) => `
            <div style="padding: var(--space-12); border-top: 1px solid var(--border-soft);">
              <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: var(--space-8); gap: var(--space-8);">
                <p style="margin:0; font-weight: 600;">${escapeHtml(g.user.full_name)}</p>
                <p style="margin:0; font-family: var(--font-display); color: var(--success, #4f8e3a);">€ ${formatMoney(g.total)}</p>
              </div>
              ${g.advances.map(advanceCompactRow).join('')}
            </div>
          `).join('')}</div>`}
    `;
  }

  function renderAll() {
    if (state.allList.length === 0) {
      return emptyCard('Nessun acconto questo mese.');
    }
    return `<div class="card" style="padding: 0;">
      ${state.allList.map((a, i) => `
        <div style="padding: var(--space-12); ${i > 0 ? 'border-top: 1px solid var(--border-soft);' : ''}">
          <div style="display: flex; justify-content: space-between; gap: var(--space-8); align-items: baseline;">
            <div>
              <p style="margin:0; font-weight: 500;">${escapeHtml(a.user.full_name)}</p>
              <p class="muted text-xs" style="margin: 2px 0 0 0;">${escapeHtml(a.date)} · ${a.service === 'lunch' ? 'pranzo' : 'cena'}${a.notes ? ' · ' + escapeHtml(a.notes) : ''}</p>
            </div>
            <div style="text-align: right;">
              <p style="margin:0; font-family: var(--font-display); color: ${a.settled_at ? 'var(--success, #4f8e3a)' : 'var(--terracotta-dark)'};">€ ${formatMoney(a.amount)}</p>
              <p class="muted text-xs" style="margin: 2px 0 0 0;">${a.settled_at ? `saldato ${escapeHtml(a.settled_in_payroll_month)}` : 'da saldare'}</p>
            </div>
          </div>
          ${isAdmin && a.settled_at ? `<button type="button" data-unsettle="${a.id}" class="btn btn--ghost btn--sm" style="margin-top: var(--space-8);">Annulla saldo</button>` : ''}
          ${isAdmin && !a.settled_at ? `<button type="button" data-delete="${a.id}" class="btn btn--ghost btn--sm" style="margin-top: var(--space-8);">${icon('trash', { size: 14 })} Elimina</button>` : ''}
        </div>
      `).join('')}
    </div>`;
  }

  function advanceCompactRow(a) {
    return `
      <div style="display: flex; justify-content: space-between; padding: var(--space-4) 0; gap: var(--space-8); font-size: var(--text-sm);">
        <span class="muted">${escapeHtml(a.date)} · ${a.service === 'lunch' ? 'pranzo' : 'cena'}${a.notes ? ' · ' + escapeHtml(a.notes) : ''}</span>
        <span style="font-family: var(--font-display);">€ ${formatMoney(a.amount)}</span>
      </div>
    `;
  }

  function wire() {
    container.querySelectorAll('[data-tab]').forEach((b) => {
      b.addEventListener('click', () => {
        state.tab = b.dataset.tab;
        render();
      });
    });
    const monthInput = container.querySelector('#adv-month');
    if (monthInput) monthInput.addEventListener('change', async (e) => {
      state.settledMonth = e.target.value;
      try {
        state.settledList = await apiGet(`/advances?settled=true&payroll_month=${state.settledMonth}`);
        render();
      } catch (err) { showToast(err.message || 'Errore', 'danger', 4000); }
    });
    container.querySelectorAll('[data-settle-user]').forEach((b) => {
      b.addEventListener('click', () => openSettleModal(Number(b.dataset.settleUser)));
    });
    container.querySelectorAll('[data-unsettle]').forEach((b) => {
      b.addEventListener('click', () => unsettleAdvance(Number(b.dataset.unsettle)));
    });
    container.querySelectorAll('[data-delete]').forEach((b) => {
      b.addEventListener('click', () => deleteAdvance(Number(b.dataset.delete)));
    });
  }

  function openSettleModal(userId) {
    const group = state.unsettledGroups.find((g) => g.user.id === userId);
    if (!group) return;
    const defaultMonth = isoMonth(new Date());
    const body = `
      <p>Stai per marcare come <strong>saldati</strong> tutti gli acconti di
      <strong>${escapeHtml(group.user.full_name)}</strong> (€ ${formatMoney(group.total_amount)} totali).</p>
      <p class="muted text-sm">L'azione è reversibile (annulla saldo dal tab "Tutti").</p>
      <div style="margin-top: var(--space-12);">
        <label class="label" for="payroll-input" style="margin:0;">Busta paga di riferimento</label>
        <input type="month" id="payroll-input" class="input" value="${defaultMonth}" required>
      </div>
    `;
    showModal('Conferma saldo', body, [
      { label: 'Annulla', variant: 'ghost' },
      {
        label: 'Marca come saldati', variant: 'primary', closeOnClick: true,
        onClick: async () => {
          const month = document.getElementById('payroll-input').value;
          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { showToast('Mese non valido', 'warn'); return; }
          const ids = group.advances.map((a) => a.id);
          try {
            const res = await apiPost('/advances/settle', { advance_ids: ids, payroll_month: month });
            showToast(`${res.settled_count} acconti saldati per ${escapeHtml(group.user.full_name)}`, 'success');
            await load();
          } catch (err) {
            const msg = err instanceof ApiError && err.message ? err.message : 'Errore saldo';
            showToast(msg, 'danger', 5000);
          }
        },
      },
    ]);
  }

  async function unsettleAdvance(id) {
    const ok = await confirmDialog('Annullare il saldo?', "L'acconto torna nello stato 'da saldare'.", { confirmLabel: 'Annulla saldo', danger: true });
    if (!ok) return;
    try {
      await apiPost(`/advances/${id}/unsettle`, {});
      showToast('Saldo annullato', 'success');
      await load();
    } catch (err) {
      showToast(err.message || 'Errore', 'danger', 4000);
    }
  }

  async function deleteAdvance(id) {
    const ok = await confirmDialog('Eliminare l\'acconto?', "L'azione è irreversibile.", { confirmLabel: 'Elimina', danger: true });
    if (!ok) return;
    try {
      await apiDelete(`/advances/${id}`);
      showToast('Acconto eliminato', 'success');
      await load();
    } catch (err) {
      showToast(err.message || 'Errore', 'danger', 4000);
    }
  }
}

// ---------- helpers ----------

function groupByUser(advances) {
  const m = new Map();
  for (const a of advances) {
    if (!m.has(a.user.id)) m.set(a.user.id, { user: a.user, total: 0, advances: [] });
    const g = m.get(a.user.id);
    g.total += Number(a.amount);
    g.advances.push(a);
  }
  return [...m.values()].sort((x, y) => y.total - x.total);
}

function isoMonth(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMoney(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return '0,00';
  return n.toFixed(2).replace('.', ',');
}

function emptyCard(msg) {
  return `<p class="muted" style="margin: 0; padding: var(--space-16); text-align: center; background: var(--cream-soft); border-radius: var(--radius-md);">${escapeHtml(msg)}</p>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
      <div class="alert__body"><strong>Errore</strong>
        <p class="alert__text">${escapeHtml(msg)}</p>
        <button type="button" id="retry-load" class="btn btn--secondary btn--sm" style="margin-top: var(--space-8);">Riprova</button>
      </div>
    </div>
  </div>`;
}
