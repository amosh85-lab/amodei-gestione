// /guida — guida rapida personalizzata per ruolo (admin/manager/staff).
//
// Nessuna API: il contenuto è statico e cambia solo in base a
// getCurrentUser().role. Sostanzialmente una versione mobile-friendly
// e in-app degli stessi contenuti di docs/USER_GUIDE.md + STAFF_GUIDE.md.

import { getCurrentUser } from '../js/auth.js';
import { setHeader } from '../js/app-shell.js';
import { navigate } from '../js/router.js';
import { icon } from '../js/icons.js';

export async function mountGuide(container, _params, _query) {
  const user = getCurrentUser();
  const role = user?.role || 'staff';

  setHeader({ title: 'Guida rapida', brand: true, backHref: '/' });

  container.innerHTML = `
    <section class="container container--narrow" style="padding-block: var(--space-20); padding-bottom: 96px;">
      <div class="card card--elevated" style="padding: var(--space-16); margin-bottom: var(--space-16);">
        <p class="muted text-xs" style="margin:0; text-transform: uppercase; letter-spacing: var(--letter-spacing-wide);">Stai entrando come</p>
        <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 1.4rem; font-weight: 600;">${escapeHtml(user?.full_name || 'Utente')} <span class="badge badge--success" style="margin-left: var(--space-4);">${escapeHtml(role)}</span></p>
        <p class="muted text-sm" style="margin: var(--space-8) 0 0 0;">Questa è una guida veloce. Per la versione completa con screenshot: <code>docs/USER_GUIDE.md</code> (admin) e <code>docs/STAFF_GUIDE.md</code> (staff).</p>
      </div>

      ${role === 'admin' ? renderAdminGuide()
        : role === 'manager' ? renderManagerGuide()
        : renderStaffGuide()}

      <div style="margin-top: var(--space-20); padding: var(--space-16); border: 1px dashed var(--border-strong); border-radius: var(--radius-md); background: var(--cream-soft);">
        <p style="margin:0; font-weight: 500;">Se qualcosa non funziona</p>
        <p class="muted text-sm" style="margin: var(--space-4) 0 var(--space-8) 0;">Chiudi e riapri l'app. Se persiste, chiama l'amministratore.</p>
        <p class="muted text-xs" style="margin:0;">Backend lento o "Errore di rete"? Aspetta 30 secondi e riprova.</p>
      </div>
    </section>
  `;

  container.querySelectorAll('[data-go]').forEach((b) => {
    b.addEventListener('click', () => navigate(b.dataset.go));
  });
}

// ---------- contenuti per ruolo ----------

function renderStaffGuide() {
  return `
    <h2 class="font-display" style="margin: var(--space-12) 0 var(--space-4) 0; font-size: 1.4rem;">Le 3 cose principali</h2>
    <p class="muted text-sm" style="margin: 0 0 var(--space-16) 0;">Quello che ti serve sapere ogni giorno.</p>

    ${section('1', '🟡 Segnalare scorte che finiscono',
      'Vai su <strong>Segnala</strong> dalla home. Cerca il prodotto, tocca <strong>SCARSO</strong> o <strong>FINITO</strong>. Il prodotto sparisce dalla lista, l\'amministrazione viene avvisata.',
      '/segnala', 'Segnala scorta')}

    ${section('2', '💸 Registrare una spesa fatta in cassa',
      'Vai su <strong>Cassa → Pranzo</strong> (o <strong>Cena</strong>). Nella sezione <strong>Spese</strong> tocca <strong>+ Aggiungi spesa</strong>. Compila descrizione, importo, categoria. Se puoi, scatta foto dello scontrino.',
      '/cassa', 'Apri Cassa')}

    ${section('3', '🧾 Chiudere POS a fine servizio',
      'Vai su <strong>Cassa → Pranzo</strong> (o <strong>Cena</strong> a fine sera). Tocca <strong>Chiudi sessione POS</strong>, inserisci il totale incassato col POS, conferma.',
      '/cassa', 'Apri Cassa')}

    <h2 class="font-display" style="margin: var(--space-20) 0 var(--space-8) 0; font-size: 1.2rem;">Altre cose utili</h2>
    <ul style="padding-left: var(--space-20); margin: 0;">
      <li class="text-sm" style="margin-bottom: var(--space-4);"><strong>Pasti staff:</strong> se mangi al bar, registra il pasto da <strong>Pasti staff</strong></li>
      <li class="text-sm" style="margin-bottom: var(--space-4);"><strong>I miei turni:</strong> vedi quante ore hai fatto questo mese da <strong>I miei turni</strong></li>
      <li class="text-sm" style="margin-bottom: var(--space-4);">Cose che NON puoi vedere: stipendi, fatture, pagamenti, acconti dei colleghi. È normale.</li>
    </ul>
  `;
}

function renderManagerGuide() {
  return `
    <h2 class="font-display" style="margin: var(--space-12) 0 var(--space-4) 0; font-size: 1.4rem;">Cosa fai tu</h2>
    <p class="muted text-sm" style="margin: 0 0 var(--space-16) 0;">Gestisci la giornata operativa: cassa, riordini, fatture, turni dello staff.</p>

    ${section('💰', 'Cassa giornaliera',
      'Tab <strong>Pranzo</strong> → chiudi POS pranzo + aggiungi spese + inserisci cash extra fondo (NETTO). Tab <strong>Cena</strong> → idem a fine giornata. Tab <strong>Totale</strong> mostra il calcolato + confronto con fiscale + Ipratico.',
      '/cassa', 'Cassa oggi')}

    ${section('🛒', 'Riordini ai fornitori',
      '<strong>Riordini → Aperte</strong>: vedi le segnalazioni dello staff raggruppate per fornitore. Tocca <strong>Prepara ordine</strong> per generare una bozza e mandare il WhatsApp al fornitore. <strong>Riordini → Previsti</strong> ti dice automaticamente quanto manca a ogni stockout.',
      '/riordini', 'Apri Riordini')}

    ${section('🧾', 'Fatture',
      'Tutti i giorni: <strong>Fatture → + Nuova</strong> per registrare le fatture dei fornitori (importo, data, foto). Filtri per periodo/categoria/fornitore.',
      '/fatture', 'Fatture')}

    ${section('🕒', 'Turni dei dipendenti',
      'Ogni giorno: <strong>Turni</strong> → scegli la data, inserisci le ore di chi ha lavorato (stepper + tasti rapidi 4/6/8h), salva tutto in un colpo. <strong>Turni settimanale</strong> ti mostra chi è in straordinario.',
      '/turni', 'Turni di oggi')}

    ${section('💸', 'Acconti dipendenti',
      'Da <strong>Cassa → Pranzo/Cena → Aggiungi acconto</strong> registri gli anticipi dati ai ragazzi. Specifica per quale busta è (default automatico). La vista <strong>Acconti</strong> li raggruppa per mese di riferimento.',
      '/acconti', 'Vedi acconti')}

    <h2 class="font-display" style="margin: var(--space-20) 0 var(--space-8) 0; font-size: 1.2rem;">Quello che NON puoi vedere</h2>
    <ul style="padding-left: var(--space-20); margin: 0;">
      <li class="text-sm" style="margin-bottom: var(--space-4);">Stato pagato/non-pagato delle fatture (solo admin)</li>
      <li class="text-sm" style="margin-bottom: var(--space-4);">Pagamenti effettuati ai fornitori e scadenziario</li>
      <li class="text-sm" style="margin-bottom: var(--space-4);">Stipendi calcolati, tariffe orarie e ore contrattuali specifiche dei colleghi</li>
      <li class="text-sm" style="margin-bottom: var(--space-4);">Impostazioni di sistema (fondo cassa, soglie, utenti)</li>
    </ul>
  `;
}

function renderAdminGuide() {
  return `
    <h2 class="font-display" style="margin: var(--space-12) 0 var(--space-4) 0; font-size: 1.4rem;">Hai accesso a tutto</h2>
    <p class="muted text-sm" style="margin: 0 0 var(--space-16) 0;">Sei l'unico che può vedere stipendi, pagamenti, impostazioni di sistema, dati sensibili.</p>

    ${section('💰', 'Cassa, riordini, fatture',
      'Stesse cose del manager: <strong>Cassa</strong>, <strong>Riordini</strong>, <strong>Fatture</strong>, <strong>Turni</strong>, <strong>Acconti</strong>. In più tu vedi anche lo stato pagato delle fatture e il scadenziario.',
      '/cassa', 'Apri Cassa')}

    ${section('📊', 'Report di gestione',
      '<strong>Magazzino → Sprechi</strong> (cosa hai buttato e quanto costa). <strong>Magazzino → Margini</strong> (quanto guadagni per prodotto). <strong>Cassa → Statistiche</strong> (trend incassi). <strong>Food Cost</strong> dalla home (incidenza cibo/bevande/consumo sui ricavi).',
      '/food-cost', 'Food Cost')}

    ${section('💳', 'Pagamenti fornitori',
      '<strong>Fatture → Scadenziario</strong> (icona orologio): vedi le fatture non pagate raggruppate per fornitore, selezioni quelle da saldare e registri il pagamento (bonifico/assegno/contanti). <strong>Fatture → Pagamenti</strong>: storico di tutti i pagamenti fatti.',
      '/fatture/da-pagare', 'Scadenziario')}

    ${section('🕒', 'Turni e stipendi',
      '<strong>Stipendi</strong> dalla home: a fine mese vedi per ogni dipendente ore × tariffa = lordo − acconti = netto da consegnare. Bottone <strong>"Marca acconti saldati"</strong> li chiude in un click. <strong>Stime operative, non busta reale del commercialista.</strong>',
      '/stipendi', 'Apri Stipendi')}

    ${section('⚙️', 'Impostazioni',
      '<strong>Impostazioni</strong>: fondo cassa (€200 default), categorie spese, soglia food cost (32% default), utenti (puoi aggiungere admin/manager/staff e impostare la tariffa €/h dei dipendenti).',
      '/impostazioni', 'Impostazioni')}

    <h2 class="font-display" style="margin: var(--space-20) 0 var(--space-8) 0; font-size: 1.2rem;">Cose da fare periodicamente</h2>
    <ul style="padding-left: var(--space-20); margin: 0;">
      <li class="text-sm" style="margin-bottom: var(--space-4);"><strong>Ogni giorno:</strong> chiudi la cassa a fine servizio — POS + cash + fiscale + Ipratico (la PWA mostra in automatico la giornata operativa anche dopo mezzanotte, fino alle 6:00 del mattino)</li>
      <li class="text-sm" style="margin-bottom: var(--space-4);"><strong>Ogni settimana:</strong> guarda Riordini → Previsti per ordini in arrivo</li>
      <li class="text-sm" style="margin-bottom: var(--space-4);"><strong>Ogni mese:</strong> esporta CSV cassa per il commercialista (Cassa → Storico → 📤), controlla Food Cost, paga gli stipendi dalla pagina Stipendi</li>
      <li class="text-sm" style="margin-bottom: var(--space-4);"><strong>Ogni 6 mesi:</strong> ruota JWT_SECRET su Railway, cambia password admin</li>
    </ul>

    <p class="muted text-xs" style="margin: var(--space-16) 0 0 0;">Per problemi tecnici → <code>docs/MAINTENANCE.md</code> ha il runbook.</p>
  `;
}

function section(num, title, body, route, btnLabel) {
  return `
    <div class="card" style="padding: var(--space-16); margin-bottom: var(--space-12);">
      <div style="display: flex; align-items: baseline; gap: var(--space-8); margin-bottom: var(--space-8);">
        <span style="font-family: var(--font-display); font-size: 1.2rem; color: var(--terracotta);">${num}</span>
        <p style="margin:0; font-weight: 600;">${title}</p>
      </div>
      <p class="text-sm" style="margin: 0 0 var(--space-12) 0;">${body}</p>
      ${route ? `<button type="button" data-go="${route}" class="btn btn--secondary btn--sm">${escapeHtml(btnLabel || 'Vai')}</button>` : ''}
    </div>
  `;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
