"""cash_vault_movements

Revision ID: v1a2u3l4t5c6
Revises: p1u2s3h4s5u6
Create Date: 2026-05-31 03:30:00.000000

Tabella per la cassaforte (cash vault): saldo cumulativo del contante
"fuori cassa" gestito dall'admin. Tre tipi di movimento (baseline /
auto_daily / manual_out) discriminati dall'enum ``cash_vault_movement_kind``.

Unique constraint su (kind, source_date) garantisce che per ogni giorno
esista al più UNA entrata automatica → permette l'upsert idempotente
quando l'admin aggiorna ``cash_dinner_above_float`` del DailySummary.
"""
from alembic import op
import sqlalchemy as sa


revision = 'v1a2u3l4t5c6'
down_revision = 'p1u2s3h4s5u6'
branch_labels = None
depends_on = None


movement_kind_enum = sa.Enum(
    'baseline', 'auto_daily', 'manual_out',
    name='cash_vault_movement_kind',
)


def upgrade() -> None:
    movement_kind_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "cash_vault_movements",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("kind", movement_kind_enum, nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("movement_date", sa.Date(), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("source_date", sa.Date(), nullable=True),
        sa.Column("created_by_user_id", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("kind", "source_date", name="uq_cash_vault_auto_per_day"),
    )
    op.create_index("ix_cash_vault_movements_kind", "cash_vault_movements", ["kind"])
    op.create_index("ix_cash_vault_movements_movement_date", "cash_vault_movements", ["movement_date"])


def downgrade() -> None:
    op.drop_index("ix_cash_vault_movements_movement_date", table_name="cash_vault_movements")
    op.drop_index("ix_cash_vault_movements_kind", table_name="cash_vault_movements")
    op.drop_table("cash_vault_movements")
    movement_kind_enum.drop(op.get_bind(), checkfirst=True)
