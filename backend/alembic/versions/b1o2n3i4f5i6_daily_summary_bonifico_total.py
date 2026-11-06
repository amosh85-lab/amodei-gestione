"""daily_summary_bonifico_total

Revision ID: b1o2n3i4f5i6
Revises: p1a2y3r4a5t6
Create Date: 2026-11-06

Aggiunge bonifico_total a daily_summaries: incassi ricevuti via bonifico
bancario durante la giornata (eventi, catering, fatture B2B), che finora
non entravano nel totale calcolato (non passano da POS né da contante).
"""
from alembic import op
import sqlalchemy as sa


revision = 'b1o2n3i4f5i6'
down_revision = 'p1a2y3r4a5t6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "daily_summaries",
        sa.Column("bonifico_total", sa.Numeric(10, 2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("daily_summaries", "bonifico_total")
