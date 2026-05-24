# Amodei — Guida completa amministratore/manager

Questa guida copre tutto quello che un amministratore o manager deve sapere
per usare Amodei nel quotidiano. Per lo staff c'è una guida separata
[STAFF_GUIDE.md](./STAFF_GUIDE.md) di 1 pagina.

---

## Indice

1. [Installazione PWA sul telefono](#1-installazione-pwa-sul-telefono)
2. [Login e ruoli](#2-login-e-ruoli)
3. [Magazzino: prodotti, lotti, vendite, sprechi](#3-magazzino)
4. [Cassa giornaliera](#4-cassa-giornaliera)
5. [Riordini ai fornitori (manuali + da sistema)](#5-riordini)
6. [Menu e pasti staff](#6-menu-e-pasti-staff)
7. [Report: storico, statistiche, sprechi, margini](#7-report)
8. [Impostazioni admin](#8-impostazioni)
9. [Backup e cose da fare ogni mese](#9-manutenzione)

---

## 1. Installazione PWA sul telefono

L'app si installa direttamente dal browser, senza passare da App Store/Play
Store.

### iPhone / iPad
1. Apri **Safari** (non Chrome) → vai a `https://amodei-gestione.netlify.app`
2. Tocca l'icona condividi (quadrato con freccia in alto) → **Aggiungi a Home**
3. Conferma il nome "Amodei" e tocca **Aggiungi**
4. L'icona Amodei (logo terracotta) appare sulla home come una vera app

### Android (Chrome)
1. Apri `https://amodei-gestione.netlify.app` con Chrome
2. Menu (3 puntini in alto) → **Installa app** (o "Aggiungi a schermata Home")
3. Conferma

Quando esce una nuova versione, l'app mostra in basso un toast
**"Nuova versione disponibile. Tocca per aggiornare."** — toccalo, l'app si
ricarica con la versione nuova.

---

## 2. Login e ruoli

Ci sono **3 ruoli**:

| Ruolo | Può fare |
|---|---|
| `admin` | Tutto: utenti, impostazioni, dati, ordini, report |
| `manager` | Tutto eccetto creare utenti e cambiare impostazioni |
| `staff` | Segnalare scorte, registrare pasti staff/spese/POS |

Per creare un nuovo utente: **Impostazioni** non è il posto (solo admin
modifica fondo cassa e categorie). Per gli utenti usa l'onboarding wizard
(`/benvenuto`) oppure direttamente l'endpoint backend tramite Postman/curl.

Sicurezza:
- Password minimo 8 caratteri
- Dopo 5 login falliti dallo stesso indirizzo, l'IP viene bloccato per 5 minuti
- Cambia la password admin almeno ogni 6 mesi

---

## 3. Magazzino

### 3.1 Caricare un nuovo arrivo

Tocca **Magazzino** → **+** (in alto a destra) → wizard 6 step:
1. Scegli il prodotto (oppure crealo al volo se non esiste)
2. Quantità + unità di misura
3. Prezzo unitario di acquisto (per kg / per pezzo / per litro)
4. Fornitore + numero documento (opzionale)
5. Data scadenza (opzionale)
6. Foto scontrino (opzionale, fortemente consigliata)

Premi **Salva**. Viene creato un **lotto** con quella quantità a quel prezzo;
ogni movimento futuro (vendita, spreco, pasto staff) lo scarica FIFO
(primo lotto in entrata = primo a scaricarsi).

### 3.2 Chiusura serale del magazzino

Ogni sera, **Chiusura serale** → conti quanto è rimasto di ogni prodotto
sensibile + salvi. Il sistema:
- Calcola la differenza tra quanto avresti dovuto avere (carico − vendite −
  sprechi) e quanto hai contato
- Se manca qualcosa, crea automaticamente movimenti di vendita per coprire
  la differenza
- Tutti i conti del giorno sono coerenti col cash incassato

### 3.3 Segnalare uno spreco

**Magazzino → tocca un prodotto → Sprechi → +** → inserisci quantità +
causale (scaduto / altro) + nota opzionale. Il lotto viene scaricato e
appare nel report sprechi.

---

## 4. Cassa giornaliera

Sezione **Cassa**, tre tab: **Pranzo**, **Cena**, **Totale**.

### Cosa inserisci a fine pranzo

Tab **Pranzo**:
1. Chiudi sessione POS pranzo (totale incassato col POS)
2. Aggiungi le spese pranzo (eventuali — frutta, pane, ecc.)
3. Inserisci **Cash extra fondo a fine pranzo** = contante in cassa
   MENO il fondo (€ 200 di default)

Vedi subito il **Parziale pranzo**.

### Cosa inserisci a fine giornata

Tab **Cena**:
1. Chiudi sessione POS cena
2. Aggiungi le spese cena
3. Inserisci **Cash extra fondo a fine serata** (il cash che resta
   nel cassetto MENO il fondo che metti via prima di contare)

Tab **Totale** mostra in automatico:
- Parziale pranzo + Parziale cena = Totale calcolato
- Fondo cassa snapshot (informativo)
- Confronto con totale fiscale (chiusura registratore di cassa) e Ipratico
- Eventuali scostamenti

Quando inserisci anche **fiscale** e **Ipratico**, lo stato della giornata
diventa **chiusa** e viene marcata con l'orario.

### Storico e statistiche cassa

- Dall'header di **Cassa**, icona calendario → **Storico** con calendario
  mensile, pallini colorati (verde = OK, ambra = scostamenti > €5, grigio = non chiusa),
  KPI totale/media/proiezione mensile, **Esporta CSV** per il commercialista
- Dall'header di **Cassa**, icona grafico → **Statistiche** con line chart
  incassi del mese, confronto mese vs mese precedente, spese per categoria

---

## 5. Riordini

Tab **Riordini** ha 3 tab interne:
- **Aperte**: segnalazioni di scorta (manuali da staff + automatiche dal sistema), raggruppate per fornitore. Tocca **Prepara ordine** per generare una bozza.
- **Bozze**: ordini in compilazione, modificabili. Da qui puoi mandare il WhatsApp al fornitore.
- **Inviati**: ordini già inviati, ricevuti o annullati.

### Riordini previsti automaticamente

Header di **Riordini**, icona grafico → **Riordini previsti**: il sistema
calcola il consumo medio degli ultimi 28 giorni e ti dice quanti giorni
mancano allo stockout di ogni prodotto. Badge:
- Rosso (< 3 giorni)
- Ambra (3-7 giorni)
- Verde (> 7 giorni)

Bottone **Genera segnalazioni di sistema** crea alert automatici per i
prodotti sotto soglia. Lo fa anche automaticamente ogni notte alle 6 UTC.

---

## 6. Menu e pasti staff

- **Menu** → lista piatti del menu, con prezzo, costo stimato dei
  componenti e margine. Per i piatti composti puoi definire la
  composizione (es. "Tagliere = 100g formaggio + 80g salume + 1 fetta pane").
- **Pasti staff** → quando lo staff (incluso te) mangia al bar, registra il
  pasto. Scala il magazzino e va come **costo pasti staff** nelle statistiche
  (non come spreco, non come vendita).

---

## 7. Report

| Report | Dove | A cosa serve |
|---|---|---|
| Storico cassa | Cassa → Storico | Vista mensile, KPI, export CSV per commercialista |
| Statistiche cassa | Cassa → Statistiche | Trend giornaliero, MoM, spese per categoria |
| Sprechi | Magazzino → Sprechi | Cosa hai buttato e quanto è costato |
| Margini | Magazzino → Margini | Quanto guadagni su ogni prodotto (vendite - costo medio) |
| Riordini previsti | Riordini → Previsti | Quando finisce ogni prodotto, quanto riordinare |
| Statistiche pasti staff | Pasti staff → Statistiche | Costo mensile dei pasti del personale |

---

## 8. Impostazioni

**Impostazioni** (solo admin):

- **Fondo cassa**: il contante che resta in cassa a fine giornata (default
  € 200). Cambiandolo, le giornate già aperte mantengono lo snapshot vecchio;
  il nuovo valore vale dalle prossime giornate.
- **Categorie spese**: aggiungi/modifica/archivia (le esistenti non vengono
  cancellate, restano referenziate dalle spese vecchie).
- **Soglie alert scadenze**: in arrivo.

---

## 9. Manutenzione

Vedi anche [MAINTENANCE.md](./MAINTENANCE.md) per i problemi più comuni.

**Ogni giorno**: la cassa va chiusa a fine servizio — POS pranzo+cena +
cash + fiscale + Ipratico. Il sistema non chiude da solo.

> **Nota giornata operativa:** se chiudi la cassa dopo mezzanotte (es. alle 1:30
> di notte), la PWA mostra automaticamente la giornata che stai chiudendo (quella
> del giorno prima), non il "calendario di sistema". La soglia è alle **6:00 del
> mattino**: prima delle 6 stai ancora chiudendo "ieri"; dalle 6 in poi è "oggi".
> Vedrai un piccolo banner informativo nella pagina Cassa per ricordartelo.

**Ogni settimana**: dai un'occhiata a **Riordini previsti** anche al di là
delle segnalazioni automatiche.

**Ogni mese**:
- Verifica **Storico cassa** del mese chiuso → export CSV per commercialista
- Verifica **Sprechi** → se è alto, capisci perché (categoria? prodotto?
  fornitore?)
- Cambia password admin se ne hai voglia / sospetti

**Ogni 6 mesi**:
- Ruota `JWT_SECRET` su Railway (invalida tutti i token attivi: tutti devono rifare login)
- Verifica retention degli snapshot Postgres Railway (sono attivi?)
- Backup manuale extra: `cd backend && .venv/bin/python -m scripts.backup_db`
