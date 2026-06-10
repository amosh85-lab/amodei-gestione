// Helper date condivise.
//
// ATTENZIONE: per la data "di oggi" sul dispositivo NON usare
// `new Date().toISOString().slice(0, 10)`: toISOString() converte in UTC,
// quindi tra mezzanotte e le 2 (ora italiana, UTC+1/+2) restituisce il
// giorno PRECEDENTE. Usare sempre queste helper, che leggono il calendario
// locale del dispositivo.

// "YYYY-MM-DD" della data LOCALE dell'oggetto Date passato.
export function localIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const g = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${g}`;
}

// "YYYY-MM-DD" di oggi secondo l'orologio locale del dispositivo.
export function todayLocalIso() {
  return localIso(new Date());
}
