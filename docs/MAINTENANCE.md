# Amodei — Manutenzione e risoluzione problemi

Cosa fare quando qualcosa non funziona. Procedure ordinate dalla più
probabile (e meno invasiva) alla meno probabile.

---

## L'app non si apre / schermo bianco sul telefono

1. **Chiudi e riapri** l'app
2. **Hard reload**: tieni premuta l'icona ricarica nel browser, scegli
   "Svuota cache e ricarica" (oppure su iPhone: chiudi l'app, riaprila,
   tocca 5 volte il logo per skippare lo splash)
3. Se persiste, il backend è probabilmente giù — vedi sezione successiva

---

## "Errore di rete" o "Failed to fetch"

Il backend non risponde. Controlla:

1. **Connessione internet** del tuo dispositivo (apri un altro sito)
2. **Stato del backend**:
   ```
   https://amodei-gestione-production.up.railway.app/health
   ```
   Atteso: `{"status":"ok","service":"amodei-api","version":"…"}`
3. Se la risposta non è ok, vai su **Railway dashboard** → progetto
   `amodei-gestione` → servizio backend → tab **Deployments** → guarda
   gli ultimi log
4. Se Railway è down (rarissimo): https://status.railway.app

---

## "Sessione scaduta" / "Credenziali non valide"

- Il token è scaduto (durata 8 ore) → rifai login
- Oppure `JWT_SECRET` è stato ruotato (lato Railway) → tutti devono rifare login

Se hai dimenticato la password admin: oggi non c'è un flusso "password
dimenticata" (richiede SMTP). Per ora, **resetta la password via DB**:

```bash
cd backend
.venv/bin/python -c "
from app.database import get_session
from app.models.users import User
from app.services.auth import hash_password
sess = next(get_session())
u = sess.query(User).filter(User.email == 'tua-email@example.it').first()
u.password_hash = hash_password('NuovaPasswordRobusta')
sess.commit()
print('Password reimpostata.')
"
```

---

## "Troppi tentativi di login. Riprova tra X secondi"

Rate limit attivo: 5 tentativi in 5 minuti per IP. Aspetta il tempo
indicato e riprova. Se non sei stato tu a sbagliare, qualcuno sta
tentando di entrare — controlla i log su Sentry / Railway.

---

## I dati non aggiornano (la pagina mostra cose vecchie)

Cache del service worker. Quando esce una nuova versione l'app **dovrebbe**
mostrare un toast "Nuova versione disponibile. Tocca per aggiornare."
Se non lo vedi e i dati sono incoerenti:

1. **iPhone (Safari)**: Impostazioni → Safari → Cancella dati siti web →
   confermi
2. **Chrome**: DevTools (Cmd+Option+I) → tab Application → Service Workers →
   **Unregister** + Hard Reload (Cmd+Shift+R)
3. In ogni caso, riaprire l'app installata risolve di solito

---

## Manca un alert / la segnalazione di sistema non parte

Il job giornaliero gira alle **6:00 UTC** (8:00 ora italiana estiva).
Verifica:

1. **Railway dashboard** → servizio `amodei-cron-forecast` → tab
   **Deployments** → c'è una entry per stamattina alle 6:00?
2. Apri quella entry e guarda i log. Cerca la riga:
   ```
   Cron forecast completato: created=…, skipped_existing=…, skipped_no_signal=…
   ```
3. Se `created=0` ma ti aspettavi alert: probabilmente esistono già alert
   aperti per quei prodotti (vai su /riordini tab "Aperte")
4. Se l'esecuzione manca completamente, **Settings** del servizio cron:
   verifica `Cron Schedule = 0 6 * * *` + `Custom Start Command =
   python -m app.cron.run_forecast`
5. Manual trigger di emergenza: /riordini-previsti → bottone "Genera
   segnalazioni di sistema" (admin only)

---

## Un prodotto risulta in stock ma so che è finito

1. Vai sul prodotto, verifica i **Lotti** — quanti hanno `current_qty > 0`?
2. Verifica i **Movimenti** recenti per quel prodotto
3. Se c'è una vendita o spreco non registrato: vai su **Chiusura serale**
   → conta manualmente quel prodotto → salva. Il sistema crea movimenti
   correttivi automaticamente.

---

## Backup di emergenza prima di una modifica rischiosa

```bash
cd backend
.venv/bin/python -m scripts.backup_db
```

Output: `backend/backups/amodei_YYYY-MM-DD_HH-MM-SS.sql` (gitignored).

Per ripristinare:
```bash
psql <DATABASE_URL_RAILWAY> < backend/backups/amodei_<TIMESTAMP>.sql
```

In alternativa, Railway tiene snapshot automatici del Postgres (7-30
giorni a seconda del piano): dashboard → servizio Postgres → tab
**Backups** → Restore.

---

## L'errore non rientra in questa lista

1. **Apri Sentry**: https://sentry.io → progetto `amodei-backend` → tab
   **Issues**. L'errore esatto è quasi sicuramente lì con stack trace e
   request ID.
2. **Cerca per request ID**: ogni risposta del backend ha l'header
   `X-Request-ID`. Se hai un report dell'utente con quel valore, su
   Sentry filtri per quell'ID e vedi cosa è successo.
3. **Log Railway**: dashboard → backend → Deployments → log live (JSON
   strutturati, cercabili per `request_id`).

---

## Cose che NON devi fare

- ❌ Non droppare colonne/tabelle in Postgres manualmente — usa una
  Alembic migration
- ❌ Non cambiare `JWT_SECRET` senza avvertire prima lo staff (devono
  rifare login)
- ❌ Non resettare il DB Railway senza aver fatto un backup prima
- ❌ Non condividere il `SENTRY_DSN` né il `JWT_SECRET` in chat / email /
  repo Git
