"""work_shifts_add_service_start_time

Revision ID: bde2d4930efc
Revises: c0c79de14419
Create Date: 2026-05-26 22:21:35.184738

Amodei: porting modello turni come Cavour (ma SENZA department).
- aggiunge `service` (lunch/dinner) + `start_time` a work_shifts
- backfilla i turni esistenti con service='dinner' e start_time='18:00'
  come default ragionevole (modello legacy = "1 turno = chiusura giornata")
- sposta l'unique da (date, user_id) a (date, user_id, service): una
  persona può ora avere 2 turni nello stesso giorno (pranzo + cena).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'bde2d4930efc'
down_revision = 'c0c79de14419'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Add columns as NULLABLE so we can backfill before SET NOT NULL.
    op.add_column(
        "work_shifts",
        sa.Column(
            "service",
            postgresql.ENUM(name="service_kind", create_type=False),
            nullable=True,
        ),
    )
    op.add_column(
        "work_shifts",
        sa.Column("start_time", sa.Time(), nullable=True),
    )

    # 2) Backfill: tutti i turni esistenti diventano "dinner alle 18:00".
    op.execute("UPDATE work_shifts SET service = 'dinner' WHERE service IS NULL")
    op.execute("UPDATE work_shifts SET start_time = '18:00' WHERE start_time IS NULL")

    # 3) Now they're populated, enforce NOT NULL.
    op.alter_column("work_shifts", "service", nullable=False)
    op.alter_column("work_shifts", "start_time", nullable=False)

    # 4) Swap unique constraint: (date, user_id) → (date, user_id, service).
    op.drop_constraint("uq_work_shifts_date_user", "work_shifts", type_="unique")
    op.create_unique_constraint(
        "uq_work_shifts_date_user_service",
        "work_shifts",
        ["date", "user_id", "service"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_work_shifts_date_user_service", "work_shifts", type_="unique")
    op.create_unique_constraint(
        "uq_work_shifts_date_user", "work_shifts", ["date", "user_id"]
    )
    op.drop_column("work_shifts", "start_time")
    op.drop_column("work_shifts", "service")
