"""Manual DB backup — dumps the production Postgres to a local file.

Usage:
    cd backend
    .venv/bin/python -m scripts.backup_db

Reads DATABASE_URL from the same .env the app uses. Output goes to
    backend/backups/amodei_YYYY-MM-DD_HH-MM-SS.sql
which is .gitignored.

Run this before:
- applying a non-trivial migration
- bulk-editing data via a Python script
- any operation you'd hate to redo from scratch

For automatic daily backups Railway already keeps Postgres snapshots —
see docs/DEPLOY.md §6 for retention and how to download a snapshot.

Requires `pg_dump` on PATH. Install on macOS:
    brew install libpq && brew link --force libpq
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")

DATABASE_URL = os.environ.get("DATABASE_URL")


def main() -> int:
    if not DATABASE_URL:
        print("ERRORE: DATABASE_URL non impostato. Controlla backend/.env", file=sys.stderr)
        return 1

    pg_dump = shutil.which("pg_dump")
    if not pg_dump:
        print(
            "ERRORE: pg_dump non trovato sul PATH.\n"
            "Installa con: brew install libpq && brew link --force libpq",
            file=sys.stderr,
        )
        return 1

    # Sanity: never print the password
    parsed = urlparse(DATABASE_URL)
    print(f"Backup da: {parsed.hostname}:{parsed.port or 5432}/{(parsed.path or '/').lstrip('/')}")

    backups_dir = BACKEND_DIR / "backups"
    backups_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    out_path = backups_dir / f"amodei_{ts}.sql"

    # --no-owner / --no-acl: dump portable across roles
    # --clean / --if-exists: dump is self-contained re-importable
    cmd = [
        pg_dump,
        "--no-owner", "--no-acl",
        "--clean", "--if-exists",
        "--format=plain",
        "--file", str(out_path),
        DATABASE_URL,
    ]
    print(f"Comando: pg_dump … --file {out_path}")
    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as exc:
        print(f"pg_dump fallito (exit={exc.returncode}). Backup NON salvato.", file=sys.stderr)
        if out_path.exists():
            out_path.unlink()
        return exc.returncode

    size_kb = out_path.stat().st_size / 1024
    print(f"\n✅ Backup completato: {out_path} ({size_kb:.1f} KB)")
    print(f"\nPer ripristinare in caso di emergenza:")
    print(f"    psql <DATABASE_URL> < {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
