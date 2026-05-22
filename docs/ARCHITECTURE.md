# Architettura — Amodei Wine Bar PWA

## Stack

| Layer    | Tecnologia                                              |
|----------|---------------------------------------------------------|
| Backend  | Python 3.11+ · FastAPI · SQLAlchemy 2 · Alembic         |
| DB       | PostgreSQL (Railway)                                    |
| Frontend | Vanilla JS + HTML + CSS (no framework, no build step)   |
| Auth     | JWT con 3 ruoli: `admin`, `manager`, `staff`            |
| Hosting  | Railway (backend + DB) · Netlify (frontend statico)     |

## Layout del repository

```
backend/
  app/
    main.py            # FastAPI app, lifespan, CORS, endpoint /health
    config.py          # Settings da env (pydantic-settings)
    database.py        # Engine + sessione SQLAlchemy (init pigro)
    models/            # (vuoto)  ORM models
    schemas/           # (vuoto)  Pydantic schemas
    routers/           # (vuoto)  Endpoint per dominio
    services/          # (vuoto)  Logica di business
    utils/             # (vuoto)  Helper trasversali
  alembic/             # Migrazioni (config + cartella versions vuota)
  Dockerfile           # Build production-ready per Railway
  railway.json         # Configurazione deploy Railway
  requirements.txt
  .env.example

frontend/
  public/              # Cartella effettivamente servita
    index.html         # Entry point della PWA
    manifest.json      # PWA manifest
    service-worker.js  # SW cache-first sugli asset shell
    icons/             # icon-192.png, icon-512.png (placeholder)
    css/               # tokens.css (palette/font), base.css
    js/                # api.js (wrapper fetch), router.js, app.js
  src/                 # Riservato a sorgenti pre-build (vedi src/README.md)
  netlify.toml         # Configurazione headers + publish dir = `public`

docs/
  ARCHITECTURE.md      # Questo file
  DEPLOY.md            # Setup locale + deploy step-by-step
```

## Endpoint correnti

| Metodo | Path     | Descrizione                                                 |
|--------|----------|-------------------------------------------------------------|
| GET    | `/`      | Payload meta (status, service, version)                     |
| GET    | `/health`| Stesso payload — usato come healthcheck Railway             |

Risposta di entrambi:
```json
{ "status": "ok", "service": "amodei-api", "version": "0.1.0" }
```

## Configurazione

Tutto via env var. File di riferimento: `backend/.env.example`.

| Variabile             | Descrizione                                                   |
|-----------------------|---------------------------------------------------------------|
| `APP_VERSION`         | Versione semantica della app                                  |
| `ENVIRONMENT`         | `development` / `staging` / `production`                      |
| `ALLOWED_ORIGINS`     | Lista comma-separated di origini CORS                         |
| `DATABASE_URL`        | URL Postgres (Railway lo inietta in produzione)               |
| `JWT_SECRET`          | Chiave per firma JWT (lunga e random)                         |
| `JWT_ALGORITHM`       | `HS256` di default                                            |
| `JWT_EXPIRES_MINUTES` | TTL del token (480 = 8 ore di default)                        |

## Frontend: come parla col backend

`frontend/public/index.html` contiene un meta tag configurabile:

```html
<meta name="amodei-api-url" content="https://<railway-url>" />
```

- `content` vuoto → fallback a `http://localhost:8000` (dev)
- `content` settato → usato dal modulo `js/api.js` come base URL

Niente env var nel frontend (no build step). Per cambiare backend si modifica
il meta tag e si ridepoya `frontend/public/` su Netlify.

## Note di design

- **Lifespan FastAPI**: si usa il pattern `lifespan` moderno, non `on_event`
  (deprecato in pydantic v2 / FastAPI 0.110+).
- **Engine SQLAlchemy lazy**: l'app si avvia anche senza `DATABASE_URL`, utile
  in fase di scaffolding e per healthcheck immediati.
- **Service worker minimale**: cache-first sugli asset di shell; tutte le
  chiamate cross-origin (= backend) bypassano la cache.
- **`frontend/src/` vuota**: dettagli nel `src/README.md`. Sarà usata quando
  introdurremo un build step (Vite, esbuild, …).

## Ruoli (riferimento, ancora da implementare)

- `admin` (Amos): pieno accesso + gestione utenti
- `manager`: cassa + magazzino + report (no utenti)
- `staff`: carico magazzino + segnalazioni + chiusura serale
  (no cassa, no eliminazioni, no report finanziari)
