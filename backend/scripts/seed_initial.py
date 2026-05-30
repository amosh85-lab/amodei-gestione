"""Idempotent seed script for the Amodei database.

Inserts the bare minimum needed to bootstrap the app:
  - one ``admin`` user (email + password from interactive prompts)
  - six expense categories
  - one app setting (``cash_float`` default = 100.00)

Safe to re-run: every insert checks for an existing row first and skips it.

Run from the backend/ directory:
    .venv/bin/python -m scripts.seed_initial
"""
from __future__ import annotations

import getpass
import logging
import sys

from sqlalchemy.orm import Session

from app.database import get_engine
from app.models import (
    AppSetting,
    AppSettingValueType,
    ExpenseCategory,
    User,
    UserRole,
)
from app.utils.passwords import hash_password

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("amodei.seed")

# (name, lucide-icon, hex-color) — colours pulled from the Amodei palette.
EXPENSE_CATEGORIES: list[tuple[str, str, str]] = [
    ("Frutta e verdura", "apple",   "#3D5A3D"),
    ("Bevande",          "wine",    "#B5391F"),
    ("Materiali",        "package", "#8A7A6E"),
    ("Utenze",           "zap",     "#D4A155"),
    ("Extra",            "star",    "#A24E2A"),
    ("Varie",            "ellipsis","#2A1F1A"),
]


def seed_admin(session: Session) -> None:
    existing = session.query(User).filter(User.role == UserRole.admin).first()
    if existing is not None:
        logger.info("Admin già presente (%s) — skip", existing.email)
        return

    print("\n— Creazione utente admin —")
    email = input("Email admin: ").strip().lower()
    if not email or "@" not in email:
        sys.exit("Email non valida. Niente scritto.")

    duplicate = session.query(User).filter(User.email == email).first()
    if duplicate is not None:
        sys.exit(f"Utente con email {email!r} già esiste (ruolo={duplicate.role.value}). Niente scritto.")

    password = getpass.getpass("Password (min 8 caratteri, input nascosto): ")
    if len(password) < 8:
        sys.exit("Password troppo corta (minimo 8 caratteri). Niente scritto.")
    confirm = getpass.getpass("Conferma password: ")
    if password != confirm:
        sys.exit("Le password non coincidono. Niente scritto.")

    user = User(
        email=email,
        password_hash=hash_password(password),
        full_name="Amos",
        role=UserRole.admin,
        active=True,
    )
    session.add(user)
    session.commit()
    logger.info("Admin creato: %s (id=%d)", user.email, user.id)


def seed_expense_categories(session: Session) -> None:
    existing_names = {c.name for c in session.query(ExpenseCategory).all()}
    added = 0
    for name, icon, color in EXPENSE_CATEGORIES:
        if name in existing_names:
            continue
        session.add(ExpenseCategory(name=name, icon=icon, color=color, active=True))
        added += 1
    if added == 0:
        logger.info("Tutte le %d categorie spese già presenti — skip", len(EXPENSE_CATEGORIES))
        return
    session.commit()
    logger.info("Categorie spese: aggiunte %d, totali ora %d", added, len(existing_names) + added)


def seed_app_settings(session: Session) -> None:
    cash_float = session.query(AppSetting).filter(AppSetting.key == "cash_float").first()
    if cash_float is not None:
        logger.info("Setting cash_float già presente (valore=%s) — skip", cash_float.value)
        return
    session.add(
        AppSetting(
            key="cash_float",
            value="100.00",
            value_type=AppSettingValueType.number,
            description="Fondo cassa iniziale fisso in €",
        )
    )
    session.commit()
    logger.info("Setting cash_float creato (default=100.00 €)")


def main() -> None:
    engine = get_engine()
    logger.info("Avvio seed su %s", engine.url.render_as_string(hide_password=True))
    with Session(engine) as session:
        seed_admin(session)
        seed_expense_categories(session)
        seed_app_settings(session)
    logger.info("Seed completato.")


if __name__ == "__main__":
    main()
