"""cash_vault_movement_kind: add 'manual_in'

Revision ID: v2a3u4l5t6m
Revises: v1a2u3l4t5c6
Create Date: 2026-05-31 20:00:00.000000

Aggiunge il valore 'manual_in' all'enum cash_vault_movement_kind, per
permettere all'admin di registrare entrate in cassaforte indipendenti
dagli incassi giornalieri (es. versamento da conto personale, prelievo
bancomat). Simmetrico a 'manual_out'.

ALTER TYPE ... ADD VALUE IF NOT EXISTS è supportato da Postgres 9.6+ ed
è idempotente: se il valore esiste già, è un no-op silenzioso.
"""
from alembic import op


revision = 'v2a3u4l5t6m'
down_revision = 'v1a2u3l4t5c6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE cash_vault_movement_kind ADD VALUE IF NOT EXISTS 'manual_in'")


def downgrade() -> None:
    # Postgres non supporta DROP VALUE da un ENUM. Per "annullare" si
    # ricrea il tipo da zero (con tutti gli usi) — operazione invasiva
    # e qui non utile. No-op consapevole.
    pass
