// /food-cost/dettaglio?category=food&year=2026&month=5
//
// Ogni riga di ogni fornitore è una fattura (kind=invoice → tap va al
// dettaglio fattura) o un DDT non ancora fatturato (kind=ddt → tap va al
// dettaglio DDT, con badge "da fatturare").

import { apiGet } from '../../js/api.js';
import { setHeader } from '../../js/app-shell.js';
import { navigate } from '../../js/router.js';
import { icon } from '../../js/icons.js';
import { skeletonList } from '../../js/components.js';

const CAT_LABEL = { food: '🍖 Food', beverage: '🍷 Beverage', consumo: '🧴 Consumo' };

export async function mountFoodcostBreakdown(container, _params, query) {
  const cat = query.category || 'food';
  const year = parseInt(query.year, 10) || new Date().getFullYear();
  const month = parseInt(query.month, 10) || (new Date().getMonth() + 1);
  setHeader({ title: `Dettaglio ${CAT_LABEL[cat]}`, brand: true, backHref: '/food-cost' });
  container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">${skeletonList(3)}</div>`;

  let data = [];
  try {
    data = await apiGet(`/foodcost/monthly/breakdown?category=${cat}&year=${year}&month=${month}`);
  } catch (err) {
    container.innerHTML = `<div class="container" style="padding-top: var(--space-20);">
      <div class="alert alert--urgent"><span class="alert__icon">${icon('alert', { size: 22 })}</span>
        <div class="alert__body"><strong>Errore</strong><p class="alert__text">${escapeHtml(err.message || '')}</p></div></div></div>`;
    return;
  }

  const total = data.reduce((s, g) => s + Number(g.total), 0);
  container.innerHTML = `
    <section class="container" style="padding-block: var(--space-12); padding-bottom: 96px;">
      <div class="card" style="padding: var(--space-12); margin-bottom: var(--space-16); background: var(--cream-soft);">
        <p class="muted text-xs" style="margin:0; text-transform: uppercase;">${CAT_LABEL[cat]} · ${month.toString().padStart(2, '0')}/${year}</p>
        <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 1.6rem; font-weight: 600;">€ ${fmt(total)}</p>
        <p class="muted text-xs" style="margin: 2px 0 0 0;">${data.length} fornitori</p>
      </div>
      ${data.length === 0
        ? '<p class="muted" style="text-align: center; padding: var(--space-16); background: var(--cream-soft); border-radius: var(--radius-md);">Nessuna fattura o DDT in questa categoria nel mese.</p>'
        : data.map(renderGroup).join('')}
    </section>
  `;

  container.querySelectorAll('[data-item]').forEach((b) => {
    b.addEventListener('click', () => {
      const dest = b.dataset.kind === 'ddt' ? `/ddt/${b.dataset.item}` : `/fatture/${b.dataset.item}`;
      navigate(dest);
    });
  });

  function renderGroup(g) {
    return `
      <div class="card" style="padding: var(--space-12); margin-bottom: var(--space-12);">
        <div style="display: flex; justify-content: space-between; gap: var(--space-8); align-items: baseline;">
          <p style="margin:0; font-weight: 600;">${escapeHtml(g.supplier.name)}</p>
          <p style="margin:0; font-family: var(--font-display); font-size: 1.2rem;">€ ${fmt(g.total)}</p>
        </div>
        <p class="muted text-xs" style="margin: 2px 0 var(--space-8) 0;">${g.count} voci</p>
        ${g.items.map((i) => `
          <button type="button" data-item="${i.id}" data-kind="${i.kind}" style="display: block; width: 100%; padding: var(--space-4) 0; text-align: left; background: transparent; border: none; border-top: 1px solid var(--border-soft); cursor: pointer;">
            <div style="display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-8);">
              <span class="muted text-sm">#${escapeHtml(i.number)} · ${formatDate(i.date)}${i.kind === 'ddt' ? ' · <span style="color: var(--warning, #c9942a);">da fatturare</span>' : ''}</span>
              <span style="font-family: var(--font-display); font-size: var(--text-sm);">€ ${fmt(i.amount_total)}</span>
            </div>
          </button>
        `).join('')}
      </div>
    `;
  }
}

function fmt(v) { const n = Number(v); return Number.isNaN(n) ? '0,00' : n.toFixed(2).replace('.', ','); }
function formatDate(iso) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
