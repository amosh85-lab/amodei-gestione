# Deploy — Amodei Wine Bar PWA

Guida operativa per portare lo scaffold dalla tua macchina alla produzione.

1. [Setup locale](#1-setup-locale)
2. [Repo GitHub](#2-repo-github)
3. [Deploy backend su Railway](#3-deploy-backend-su-railway)
4. [Deploy frontend su Netlify](#4-deploy-frontend-su-netlify)
5. [Wiring CORS tra Netlify e Railway](#5-wiring-cors-tra-netlify-e-railway)

---

## 1. Setup locale

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

cp .env.example .env
# Modifica .env se serve. DATABASE_URL può restare vuoto: l'app si avvia lo stesso.

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Output atteso:
```
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     Application startup complete.
```

Verifica:
```bash
curl http://localhost:8000/health
# → {"status":"ok","service":"amodei-api","version":"0.1.0"}
```

### Frontend (dev)

Servi `frontend/public/` con un static server. Esempio con Python:

```bash
cd frontend/public
python3 -m http.server 5500
```

Apri http://localhost:5500 — dovresti vedere il box **Connesso al backend ✓**
(in verde bottle).

> Nota: il frontend, senza meta tag configurato, fa fallback a
> `http://localhost:8000`. Per puntare a un backend diverso modifica
> `<meta name="amodei-api-url" content="...">` in `index.html`.

---

## 2. Repo GitHub

Dalla root del progetto:

```bash
git init -b main
git add .
git commit -m "chore: initial scaffold (FastAPI + vanilla PWA)"
```

Crea il repo su GitHub:
1. Vai su https://github.com/new
2. Repository name: `amodei-gestione`
3. Visibilità: a tua scelta (privato consigliato per ora)
4. **NON** spuntare README / .gitignore / license — sono già presenti localmente

Collega e push:
```bash
git remote add origin git@github.com:<tuo-username>/amodei-gestione.git
git push -u origin main
```

(Se non hai SSH configurato usa l'URL HTTPS: `https://github.com/<user>/amodei-gestione.git`.)

---

## 3. Deploy backend su Railway

1. Vai su https://railway.app → **New Project** → **Empty Project**.
   Dagli un nome tipo `amodei-prod`.
2. **Aggiungi Postgres**:
   - **+ New** → **Database** → **Add PostgreSQL**
   - Railway crea un servizio Postgres ed espone `DATABASE_URL` come variabile referenziabile.
3. **Aggiungi il backend**:
   - **+ New** → **GitHub Repo** → seleziona `amodei-gestione`
   - Alla prima configurazione, vai in **Settings** del servizio backend →
     **Root Directory** = `backend`
   - Railway rileverà automaticamente `Dockerfile` + `railway.json`
4. **Configura le env var** (tab **Variables** del servizio backend):

   | Variabile         | Valore                                                                 |
   |-------------------|------------------------------------------------------------------------|
   | `DATABASE_URL`    | `${{Postgres.DATABASE_URL}}` *(reference, non valore copiato a mano)* |
   | `ALLOWED_ORIGINS` | lascia vuoto per ora                                                  |
   | `JWT_SECRET`      | output di `openssl rand -hex 32`                                       |
   | `APP_VERSION`     | `0.1.0`                                                                |
   | `ENVIRONMENT`     | `production`                                                           |

5. **Espone il backend**:
   - **Settings → Networking** del servizio backend → **Generate Domain**
   - Otterrai un URL tipo `https://amodei-backend-production.up.railway.app`
6. **Verifica**:
   ```bash
   curl https://<tuo-backend>.up.railway.app/health
   # → {"status":"ok","service":"amodei-api","version":"0.1.0"}
   ```

> Se la build fallisce, controlla:
> - **Root Directory** del servizio è `backend`
> - Railway usa il Dockerfile (lo dichiariamo in `railway.json`)
> - Log del deploy nel tab **Deployments**

---

## 4. Deploy frontend su Netlify

**Prima di trascinare**: aggiorna il meta tag in `frontend/public/index.html`:

```html
<meta name="amodei-api-url" content="https://<tuo-backend>.up.railway.app" />
```

Poi:
1. Vai su https://app.netlify.com/drop
2. Trascina la cartella **`frontend/public/`**
3. Netlify assegna un URL tipo `https://eloquent-curie-12345.netlify.app`
4. (Opzionale) **Site configuration → Change site name** → `amodei`

---

## 5. Wiring CORS tra Netlify e Railway

Ora hai entrambi gli URL. Configura il backend per accettarli:

1. Su Railway → servizio backend → tab **Variables** → aggiorna:
   ```
   ALLOWED_ORIGINS = https://<tuo-sito>.netlify.app
   ```
   (più origini si separano con virgola, senza spazi superflui)
2. Railway redeploya automaticamente (~30s)
3. Apri `https://<tuo-sito>.netlify.app` → la card deve mostrare
   **Connesso al backend ✓**

### Troubleshooting

| Sintomo                                  | Causa probabile                                    | Fix |
|------------------------------------------|----------------------------------------------------|-----|
| `Errore connessione` + `Failed to fetch` | meta tag `amodei-api-url` errato                   | Controlla URL, no trailing slash, schema https |
| `Errore connessione` + CORS in console   | `ALLOWED_ORIGINS` non include l'URL Netlify         | Aggiungi l'URL esatto (con `https://`) |
| `502` da Railway                         | Backend in crash (controlla log Deployments)        | Vedi log; spesso env var mancante |
| `/health` ok ma frontend non aggiornato  | Service worker che cacha la vecchia versione        | DevTools → Application → Service Workers → Unregister, hard reload |
