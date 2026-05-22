"""Interactive helper: write backend/.env with the Railway DATABASE_URL.

Run from the backend/ directory:
    .venv/bin/python scripts/set_db_url.py

The URL is read via getpass (input hidden in the terminal) and never echoed.
"""
from __future__ import annotations

import getpass
import sys
from pathlib import Path


ENV_PATH = Path(__file__).resolve().parent.parent / ".env"

TEMPLATE = """APP_VERSION=0.1.0
ENVIRONMENT=development
ALLOWED_ORIGINS=http://localhost:5500,http://127.0.0.1:5500
DATABASE_URL={url}
JWT_SECRET=local-dev-only-not-secure
JWT_ALGORITHM=HS256
JWT_EXPIRES_MINUTES=480
"""


def main() -> None:
    print(f"Scrivo: {ENV_PATH}")
    url = getpass.getpass("Incolla DATABASE_PUBLIC_URL (input nascosto, poi Invio): ").strip()
    if not url:
        sys.exit("URL vuota, niente scritto.")
    if not (url.startswith("postgres://") or url.startswith("postgresql://")):
        sys.exit(f"URL non sembra valida (deve iniziare con postgres:// o postgresql://). Niente scritto.")

    ENV_PATH.write_text(TEMPLATE.format(url=url), encoding="utf-8")

    scheme = url.split(":", 1)[0]
    # Estraiamo host:port solo per dare conferma visiva senza esporre password.
    rest = url.split("@", 1)[-1] if "@" in url else url
    host_port = rest.split("/", 1)[0]
    print(f"OK .env scritto: scheme={scheme}, host={host_port}, totale {len(url)} caratteri")


if __name__ == "__main__":
    main()
