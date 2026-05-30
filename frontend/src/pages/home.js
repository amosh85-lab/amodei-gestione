// / (Home) — redesigned dashboard for admin/manager, simple for staff.

import { getCurrentUser, logout, userHasRole } from '../js/auth.js';
import { setHeader } from '../js/app-shell.js';
import { navigate } from '../js/router.js';
import { icon } from '../js/icons.js';
import { confirmDialog } from '../js/components.js';
import { apiGet } from '../js/api.js';
import { isOnboardingSkipped } from './onboarding/welcome.js';

export function mountHome(container) {
  const user = getCurrentUser();
  const isAdminOrManager = userHasRole('admin', 'manager');

  if (userHasRole('admin') && !isOnboardingSkipped()) {
    Promise.all([
      apiGet('/products?limit=1').catch(() => []),
      apiGet('/suppliers?limit=1').catch(() => []),
    ]).then(([p, s]) => {
      const empty = Array.isArray(p) && p.length === 0
                 && Array.isArray(s) && s.length === 0;
      if (empty) navigate('/benvenuto');
    });
  }

  if (isAdminOrManager) {
    mountAdminHome(container, user);
  } else {
    mountStaffHome(container, user);
  }
}

// =====================================================================
// ADMIN / MANAGER HOME
// =====================================================================

function mountAdminHome(container, user) {
  // Hide the default app header — the hero replaces it
  const headerEl = document.getElementById('app-header');
  if (headerEl) headerEl.style.display = 'none';

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 14 ? 'Buongiorno' : 'Buonasera';
  const firstName = (user?.full_name || user?.email || '').split(' ')[0];
  const dateLabel = now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();

  const isAdmin = userHasRole('admin');

  container.innerHTML = `
    <!-- HERO HEADER -->
    <div style="background: var(--terracotta); color: var(--off-white); padding: 40px 20px 60px 20px;">
      <div style="max-width: 480px; margin: 0 auto;">
        <p style="margin:0; font-size: 11px; text-transform: uppercase; letter-spacing: 2px; opacity: 0.8; color: inherit;">${esc(dateLabel)}</p>
        <h1 style="margin: 12px 0 0 0; font-family: var(--font-display); font-style: italic; font-size: 2.2rem; font-weight: 600; line-height: 1.15; color: inherit;">
          ${esc(greeting)},<br>${esc(firstName)}
        </h1>
      </div>
    </div>

    <!-- CARD INCASSO (overlapping hero) — solo admin -->
    ${isAdmin ? `
    <div style="max-width: 480px; margin: -36px auto 0 auto; padding: 0 20px;">
      <div id="home-incasso" style="background: var(--off-white); border-radius: 16px; box-shadow: 0 4px 24px rgba(42,31,26,0.10); padding: 20px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="width:8px; height:8px; border-radius:50%; background: var(--bottle-green); flex-shrink:0;"></span>
          <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--ink-muted); font-weight: 600;">Incasso di oggi</span>
        </div>
        <p id="incasso-amount" class="font-display" style="margin: 8px 0 0 0; font-size: 3rem; font-weight: 700; line-height: 1; color: var(--ink);">
          <span style="font-size: 1rem; font-weight: 400; vertical-align: baseline;">€</span> <span id="incasso-int">—</span><span id="incasso-dec" style="font-size: 1.4rem; color: var(--ink-muted);"></span>
        </p>
        <div id="incasso-delta" style="margin-top: 4px;"></div>
        <div style="border-top: 1px solid var(--border-soft); margin-top: 16px; padding-top: 12px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; text-align: center;">
          <div>
            <p style="margin:0; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--ink-muted);">Pranzo</p>
            <p id="incasso-lunch" class="font-display" style="margin: 4px 0 0 0; font-size: 1.2rem; font-weight: 700; color: var(--ink);">—</p>
          </div>
          <div>
            <p style="margin:0; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--ink-muted);">Cena</p>
            <p id="incasso-dinner" class="font-display" style="margin: 4px 0 0 0; font-size: 1.2rem; font-weight: 700; color: var(--ink);">—</p>
          </div>
          <div>
            <p style="margin:0; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--ink-muted);">Spese</p>
            <p id="incasso-expenses" class="font-display" style="margin: 4px 0 0 0; font-size: 1.2rem; font-weight: 700; color: var(--terracotta-dark);">—</p>
          </div>
        </div>
      </div>

      <!-- ANDAMENTO INCASSI (WoW / MoM / YoY) -->
      <div id="home-trends" style="margin-top: 12px;"></div>
    </div>
    ` : ''}

    <div style="max-width: 480px; margin: 0 auto; padding: 0 20px;">

      <!-- DA GESTIRE -->
      <div id="home-notifications" style="margin-top: 28px;"></div>

      <!-- MENU OPERATIVO -->
      <p style="margin: 28px 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--ink-muted); font-weight: 600;">Operativo</p>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        ${tile('Segnala scorte', 'alert',     '/segnala',           '#B5391F')}
        ${tile('Magazzino',      'inventory', '/magazzino',         '#3D5A3D')}
        ${tile('Carica lotto',   'plus',      '/magazzino/carico',  '#B5391F')}
        ${tile('Chiusura serale','clock',     '/chiusura-serale',   '#6a4c93')}
      </div>

      <p style="margin: 24px 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--ink-muted); font-weight: 600;">Gestione</p>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        ${tile('Cassa',     'cash',      '/cassa',      '#3D5A3D')}
        ${tile('Riordini',  'whatsapp',  '/riordini',   '#25D366')}
        ${tile('Turni',     'clock',     '/turni',      '#6a4c93')}
        ${isAdmin ? tile('Stipendi', 'cash', '/stipendi', '#2563EB') : tile('Pasti staff', 'cash', '/pasti-staff', '#8B6A2E')}
      </div>

      <p style="margin: 24px 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--ink-muted); font-weight: 600;">Altro</p>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px;">
        ${tile('Food Cost',  'bar-chart', '/food-cost',  '#8B6A2E')}
        ${tile('Fornitori',  'phone',     '/fornitori',  '#3D5A3D')}
        ${tile('Fatture',    'cash',      '/fatture',    '#2563EB')}
        ${tile('Impostazioni','settings', '/impostazioni','#8A7A6E')}
      </div>

      <!-- ESCI -->
      <div style="text-align: center; padding: 20px 0 100px 0;">
        <button type="button" id="home-logout" style="background: none; border: none; cursor: pointer; font-size: 13px; color: var(--ink-muted); opacity: 0.7;">
          ${icon('logout', { size: 16 })} <span style="margin-left: 4px;">Esci</span>
        </button>
      </div>
    </div>
  `;

  // Wire navigation
  container.querySelectorAll('[data-go]').forEach((b) => {
    b.addEventListener('click', () => navigate(b.dataset.go));
  });
  container.querySelector('#home-logout')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Vuoi uscire?', 'Tornerai alla schermata di accesso.', { confirmLabel: 'Esci', cancelLabel: 'Annulla', danger: true });
    if (ok) logout();
  });

  // Async data loading
  if (isAdmin) {
    loadIncassoCard();
    loadTrendsCard();
  }
  loadNotifications(container);

  // Restore header when leaving
  return () => {
    if (headerEl) headerEl.style.display = '';
  };
}

// ---- Incasso card data ----

async function loadIncassoCard() {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const fromDate = new Date(today);
  fromDate.setDate(fromDate.getDate() - 14);
  const fromStr = fromDate.toISOString().slice(0, 10);

  let summaries;
  try {
    summaries = await apiGet(`/daily-summary?from=${fromStr}&to=${todayStr}&limit=30`);
  } catch { return; }

  // Build lookup
  const byDate = new Map();
  for (const s of summaries) byDate.set(s.date, s);

  // Today's summary
  const todaySummary = byDate.get(todayStr);
  const todayTotal = getTotal(todaySummary);

  // Fill amount
  const intEl = document.getElementById('incasso-int');
  const decEl = document.getElementById('incasso-dec');
  if (intEl && todayTotal != null) {
    const parts = todayTotal.toFixed(2).split('.');
    intEl.textContent = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    decEl.textContent = `,${parts[1]}`;
  } else if (intEl) {
    intEl.textContent = '0';
    decEl.textContent = ',00';
  }

  // Lunch / dinner / expenses breakdown
  if (todaySummary) {
    const lunchEl = document.getElementById('incasso-lunch');
    const dinnerEl = document.getElementById('incasso-dinner');
    const expEl = document.getElementById('incasso-expenses');
    const lunch = Number(todaySummary.partial_lunch || todaySummary.pos_lunch || 0);
    const dinner = Number(todaySummary.partial_dinner || todaySummary.pos_dinner || 0);
    const expenses = Number(todaySummary.expenses_total || 0);
    if (lunchEl) lunchEl.textContent = `€ ${fmtShort(lunch)}`;
    if (dinnerEl) dinnerEl.textContent = `€ ${fmtShort(dinner)}`;
    if (expEl) expEl.textContent = expenses > 0 ? `− € ${fmtShort(expenses)}` : '€ 0';
  }

  // Delta vs weekly average
  const deltaEl = document.getElementById('incasso-delta');
  if (deltaEl && todayTotal != null) {
    const weekAvg = computeWeekAvg(byDate, today);
    if (weekAvg != null && weekAvg > 0) {
      const diff = todayTotal - weekAvg;
      const pct = (diff / weekAvg) * 100;
      const sign = diff >= 0 ? '+' : '';
      const color = diff >= 0 ? 'var(--bottle-green)' : 'var(--terracotta-dark)';
      const arrow = diff >= 0 ? '▲' : '▼';
      deltaEl.innerHTML = `<p style="margin:0; font-size: 12px; color: ${color}; font-weight: 500;">${arrow} ${sign}${pct.toFixed(1).replace('.', ',')}% <span style="color: var(--ink-muted); font-weight: 400;">vs media settimanale</span></p>`;
    }
  }
}

function getTotal(s) {
  if (!s) return null;
  const v = s.computed_total ?? s.fiscal_total ?? (Number(s.pos_total) > 0 ? s.pos_total : null);
  return v != null ? Number(v) : null;
}

// ---- Trends card data (WoW / MoM / YoY) ----

async function loadTrendsCard() {
  const slot = document.getElementById('home-trends');
  if (!slot) return;

  const today = new Date();
  const todayStr = isoOf(today);
  const thisYear = today.getFullYear();
  const lastYearSameDay = new Date(thisYear - 1, today.getMonth(), today.getDate());
  const firstThisYear = `${thisYear}-01-01`;
  const firstLastYear = `${thisYear - 1}-01-01`;
  const lastYearSameDayStr = isoOf(lastYearSameDay);

  let curSummaries, prevYearSummaries;
  try {
    [curSummaries, prevYearSummaries] = await Promise.all([
      apiGet(`/daily-summary?from=${firstThisYear}&to=${todayStr}&limit=365`),
      apiGet(`/daily-summary?from=${firstLastYear}&to=${lastYearSameDayStr}&limit=365`),
    ]);
  } catch { return; }

  // WoW: lunedì → oggi  vs  lunedì precedente → stesso giorno-della-settimana
  const dow = (today.getDay() + 6) % 7;     // 0 = lun
  const thisMon = addDays(today, -dow);
  const lastMon = addDays(thisMon, -7);
  const lastWeekSameDow = addDays(lastMon, dow);
  const wowCurrent  = sumRange(curSummaries, isoOf(thisMon), todayStr);
  const wowPrevious = sumRange(curSummaries, isoOf(lastMon), isoOf(lastWeekSameDow));

  // MoM: 1° del mese → oggi  vs  1° del mese precedente → stesso giorno (o ultimo, se il mese prec è più corto)
  const thisMonth1 = new Date(thisYear, today.getMonth(), 1);
  const lastMonth1 = new Date(thisYear, today.getMonth() - 1, 1);
  const lastMonthLastDayDate = new Date(thisYear, today.getMonth(), 0).getDate();
  const lastMonthSameDay = new Date(
    lastMonth1.getFullYear(), lastMonth1.getMonth(),
    Math.min(today.getDate(), lastMonthLastDayDate),
  );
  const momCurrent  = sumRange(curSummaries, isoOf(thisMonth1), todayStr);
  const momPrevious = sumRange(curSummaries, isoOf(lastMonth1), isoOf(lastMonthSameDay));

  // YoY: 1° gen anno corrente → oggi  vs  1° gen anno scorso → stessa data
  const yoyCurrent  = sumRange(curSummaries, firstThisYear, todayStr);
  const yoyPrevious = sumRange(prevYearSummaries, firstLastYear, lastYearSameDayStr);

  slot.innerHTML = `
    <div style="background: var(--off-white); border-radius: 16px; box-shadow: 0 4px 24px rgba(42,31,26,0.10); padding: 16px 20px;">
      <p style="margin: 0 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--ink-muted); font-weight: 600;">Andamento incassi</p>
      <div style="display: grid; gap: 12px;">
        ${trendRow('Questa settimana', wowCurrent, wowPrevious, 'vs settimana precedente')}
        ${trendRow('Questo mese', momCurrent, momPrevious, 'vs mese precedente')}
        ${trendRow('Anno in corso', yoyCurrent, yoyPrevious, 'vs anno precedente')}
      </div>
    </div>
  `;
}

function trendRow(label, current, previous, vsLabel) {
  const hasPrev = previous > 0;
  const diff = current - previous;
  const pct = hasPrev ? (diff / previous) * 100 : null;
  const positive = diff >= 0;
  const color = positive ? 'var(--bottle-green)' : 'var(--terracotta-dark)';
  const arrow = positive ? '▲' : '▼';
  const sign = positive ? '+' : '−';
  const absDiff = Math.abs(diff);
  const deltaText = !hasPrev
    ? `<span style="color: var(--ink-muted); font-size: 12px;">nessun dato comparabile</span>`
    : `<span style="color: ${color}; font-weight: 600; font-size: 13px;">${arrow} ${sign}€&nbsp;${fmtThousands(absDiff)}</span>
       <span style="color: ${color}; font-weight: 500; font-size: 13px; margin-left: 6px;">(${sign}${Math.abs(pct).toFixed(1).replace('.', ',')}%)</span>
       <span style="color: var(--ink-muted); font-size: 12px; margin-left: 6px;">${esc(vsLabel)}</span>`;
  return `
    <div>
      <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 12px;">
        <span style="font-size: 13px; color: var(--ink-muted); font-weight: 500;">${esc(label)}</span>
        <span class="font-display" style="font-size: 1.3rem; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums;">€&nbsp;${fmtThousands(current)}</span>
      </div>
      <div style="margin-top: 2px;">${deltaText}</div>
    </div>
  `;
}

function isoOf(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function sumRange(summaries, fromStr, toStr) {
  let acc = 0;
  for (const s of summaries) {
    if (s.date < fromStr || s.date > toStr) continue;
    const t = getTotal(s);
    if (t != null) acc += t;
  }
  return acc;
}

function fmtThousands(n) {
  const parts = Number(n).toFixed(2).split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${intPart},${parts[1]}`;
}

function computeWeekAvg(byDate, today) {
  const monday = new Date(today);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const lastMonday = new Date(monday);
  lastMonday.setDate(lastMonday.getDate() - 7);
  const lastSunday = new Date(monday);
  lastSunday.setDate(lastSunday.getDate() - 1);

  const vals = [];
  const d = new Date(lastMonday);
  while (d <= lastSunday) {
    const k = d.toISOString().slice(0, 10);
    const s = byDate.get(k);
    const t = getTotal(s);
    if (t != null) vals.push(t);
    d.setDate(d.getDate() + 1);
  }
  return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

// ---- Notifications (Da gestire) ----

async function loadNotifications(container) {
  const slot = container.querySelector('#home-notifications');
  if (!slot) return;

  const items = [];

  // Stock alerts
  try {
    const alerts = await apiGet('/alerts?status=open&limit=500');
    const outCount = alerts.filter((a) => a.status_signaled === 'out').length;
    const lowCount = alerts.filter((a) => a.status_signaled === 'low').length;
    if (outCount > 0) {
      items.push(notifCard({
        color: '#B5391F',
        bgColor: 'rgba(181,57,31,0.10)',
        iconName: 'alert',
        title: `${outCount} ${outCount === 1 ? 'prodotto finito' : 'prodotti finiti'}`,
        subtitle: lowCount > 0 ? `+ ${lowCount} con scorta bassa` : 'Da riordinare',
        action: 'Riordini',
        href: '/riordini',
      }));
    } else if (lowCount > 0) {
      items.push(notifCard({
        color: '#c9942a',
        bgColor: 'rgba(201,148,42,0.10)',
        iconName: 'warning',
        title: `${lowCount} ${lowCount === 1 ? 'prodotto scarso' : 'prodotti scarsi'}`,
        subtitle: 'Segnalati dallo staff',
        action: 'Vedi',
        href: '/riordini',
      }));
    }
  } catch { /* silent */ }

  // Expiring products
  try {
    const expiring = await apiGet('/products?expiring_within_days=3&active=true');
    if (expiring.length > 0) {
      items.push(notifCard({
        color: '#B5391F',
        bgColor: 'rgba(181,57,31,0.10)',
        iconName: 'clock',
        title: `${expiring.length} ${expiring.length === 1 ? 'prodotto in scadenza' : 'prodotti in scadenza'}`,
        subtitle: 'Entro 3 giorni',
        action: 'Magazzino',
        href: '/magazzino',
      }));
    }
  } catch { /* silent */ }

  if (items.length === 0) return;

  slot.innerHTML = `
    <p style="margin: 0 0 12px 0; font-family: var(--font-display); font-size: 1.4rem; font-weight: 700; color: var(--ink);">Da gestire</p>
    <div style="display: grid; gap: 10px;">${items.join('')}</div>
  `;
  slot.querySelectorAll('[data-go]').forEach((b) => {
    b.addEventListener('click', () => navigate(b.dataset.go));
  });
}

function notifCard({ color, bgColor, iconName, title, subtitle, action, href }) {
  return `
    <div style="background: var(--off-white); border-radius: 12px; border-left: 4px solid ${color}; padding: 14px 16px; display: flex; align-items: center; gap: 12px; box-shadow: 0 1px 4px rgba(42,31,26,0.06);">
      <div style="width: 40px; height: 40px; border-radius: 50%; background: ${bgColor}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: ${color};">
        ${icon(iconName, { size: 20 })}
      </div>
      <div style="flex: 1; min-width: 0;">
        <p style="margin:0; font-size: 14px; font-weight: 600; color: var(--ink);">${esc(title)}</p>
        <p style="margin: 2px 0 0 0; font-size: 12px; color: var(--ink-muted);">${esc(subtitle)}</p>
      </div>
      <button type="button" data-go="${href}" style="background: ${bgColor}; border: none; border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 600; color: ${color}; cursor: pointer; white-space: nowrap;">
        ${esc(action)}
      </button>
    </div>
  `;
}

// ---- Tile helper ----

function tile(label, iconName, href, color) {
  const bgOpacity = color + '26';
  return `
    <button type="button" data-go="${href}" style="
      background: var(--off-white); border: 1px solid var(--border-soft); border-radius: 14px;
      min-height: 100px; padding: 16px; cursor: pointer;
      display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 10px;
      box-shadow: 0 1px 3px rgba(42,31,26,0.04);
    ">
      <div style="width: 42px; height: 42px; border-radius: 10px; background: ${bgOpacity}; display: flex; align-items: center; justify-content: center; color: ${color};">
        ${icon(iconName, { size: 22 })}
      </div>
      <span style="font-size: 13px; font-weight: 500; color: var(--ink);">${esc(label)}</span>
    </button>
  `;
}

// =====================================================================
// STAFF HOME
// =====================================================================

function mountStaffHome(container, user) {
  const headerEl = document.getElementById('app-header');
  if (headerEl) headerEl.style.display = 'none';

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 14 ? 'Buongiorno' : 'Buonasera';
  const firstName = (user?.full_name || user?.email || '').split(' ')[0];
  const dateLabel = now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();

  container.innerHTML = `
    <!-- HERO HEADER -->
    <div style="background: var(--terracotta); color: var(--off-white); padding: 40px 20px 36px 20px;">
      <div style="max-width: 480px; margin: 0 auto;">
        <p style="margin:0; font-size: 11px; text-transform: uppercase; letter-spacing: 2px; opacity: 0.8; color: inherit;">${esc(dateLabel)}</p>
        <h1 style="margin: 12px 0 0 0; font-family: var(--font-display); font-style: italic; font-size: 2.2rem; font-weight: 600; line-height: 1.15; color: inherit;">
          ${esc(greeting)},<br>${esc(firstName)}
        </h1>
      </div>
    </div>

    <div style="max-width: 480px; margin: 0 auto; padding: 0 20px;">

      <!-- DA GESTIRE (staff vede solo le proprie notifiche) -->
      <div id="home-notifications" style="margin-top: 28px;"></div>

      <!-- MENU OPERATIVO -->
      <p style="margin: 28px 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--ink-muted); font-weight: 600;">Operativo</p>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        ${tile('Segnala scorte', 'alert',     '/segnala',           '#B5391F')}
        ${tile('Magazzino',      'inventory', '/magazzino',         '#3D5A3D')}
        ${tile('Carica lotto',   'plus',      '/magazzino/carico',  '#B5391F')}
        ${tile('Chiusura serale','clock',     '/chiusura-serale',   '#6a4c93')}
      </div>

      <p style="margin: 24px 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--ink-muted); font-weight: 600;">Personale</p>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px;">
        ${tile('I miei turni', 'clock', '/miei-turni', '#6a4c93')}
        ${tile('Pasti staff',  'cash',  '/pasti-staff', '#8B6A2E')}
      </div>

      <!-- ESCI -->
      <div style="text-align: center; padding: 20px 0 100px 0;">
        <button type="button" id="home-logout" style="background: none; border: none; cursor: pointer; font-size: 13px; color: var(--ink-muted); opacity: 0.7;">
          ${icon('logout', { size: 16 })} <span style="margin-left: 4px;">Esci</span>
        </button>
      </div>
    </div>
  `;

  container.querySelectorAll('[data-go]').forEach((b) => {
    b.addEventListener('click', () => navigate(b.dataset.go));
  });
  container.querySelector('#home-logout')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Vuoi uscire?', 'Tornerai alla schermata di accesso.', { confirmLabel: 'Esci', cancelLabel: 'Annulla', danger: true });
    if (ok) logout();
  });

  // Staff notifications (alerts they can see)
  loadNotifications(container);

  return () => {
    if (headerEl) headerEl.style.display = '';
  };
}

// =====================================================================
// Helpers
// =====================================================================

function fmtShort(n) {
  return Number(n).toFixed(2).replace('.', ',');
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
