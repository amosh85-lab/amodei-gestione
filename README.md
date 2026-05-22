# Amodei — Gestionale Wine Bar

PWA gestionale per **Amodei Wine Bar**: cassa, magazzino, chiusure serali, report.

## Stack

- **Backend**: Python 3.11+ · FastAPI · SQLAlchemy 2 · Alembic · PostgreSQL
- **Frontend**: Vanilla JS + HTML + CSS (no framework, no build step), PWA
- **Auth**: JWT con 3 ruoli — `admin`, `manager`, `staff`
- **Hosting**: Railway (backend + Postgres) · Netlify (frontend statico)

## Quickstart locale

**Backend**
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
# → http://localhost:8000/health
```

**Frontend**
```bash
cd frontend/public
python3 -m http.server 5500
# → http://localhost:5500
```

Apri il frontend: deve mostrare **Connesso al backend ✓**.

## Documentazione

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — layout repo, stack, endpoint, configurazione
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — setup locale + deploy Railway/Netlify step-by-step

## Stato

`v0.1.0` — scaffold iniziale. Backend espone `/health`; frontend mostra lo stato
di connessione. Il resto arriva nelle prossime tappe (auth, modelli, cassa,
magazzino, report).
