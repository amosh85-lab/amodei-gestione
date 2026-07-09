// Bonus incasso del manager + helper incassi mensili.
//
// Unica fonte della logica (usata da payroll/dashboard.js e
// payroll/salary-table.js — non ricopiarla altrove).
// Accordo: soglia 40.000 € di incasso mensile → 250 €; ogni 5.000 € sopra
// la soglia, altri 250 €. Vale SOLO per Marco Sanarighi (identificato per
// email): gli altri manager in organico non hanno questo bonus.

export const BONUS_THRESHOLD = 40000;
export const BONUS_STEP = 5000;
export const BONUS_PER_TIER = 250;
export const BONUS_ELIGIBLE_EMAILS = new Set([
  'marco.sanarighi86@icloud.com',
]);

export function isBonusEligible(user) {
  return !!user && BONUS_ELIGIBLE_EMAILS.has((user.email || '').toLowerCase());
}

export function managerBonus(monthlyRevenue) {
  const rev = Number(monthlyRevenue) || 0;
  if (rev < BONUS_THRESHOLD) return 0;
  const tiers = Math.floor((rev - BONUS_THRESHOLD) / BONUS_STEP) + 1;
  return tiers * BONUS_PER_TIER;
}

// Incasso reale di un daily-summary: computed_total, poi fiscale, poi POS.
export function summaryRevenue(s) {
  if (!s) return null;
  const v = s.computed_total ?? s.fiscal_total ?? (Number(s.pos_total) > 0 ? s.pos_total : null);
  return v != null ? Number(v) : null;
}

export function monthIso(year, month /* 1-indexed */) {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: f(first), to: f(last) };
}
