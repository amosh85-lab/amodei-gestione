"""user_pay_type_monthly_salary

Revision ID: a1b2c3d4e5f6
Revises: bde2d4930efc
Create Date: 2026-05-27

Aggiunge pay_type (hourly/fixed) e monthly_salary alla tabella users.
Dipendenti esistenti: pay_type='hourly' (default), monthly_salary=NULL.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'a1b2c3d4e5f6'
down_revision = 'bde2d4930efc'
branch_labels = None
depends_on = None


def upgrade() -> None:
    pay_type_enum = postgresql.ENUM("hourly", "fixed", name="pay_type", create_type=False)
    op.execute("CREATE TYPE pay_type AS ENUM ('hourly', 'fixed')")

    op.add_column(
        "users",
        sa.Column("pay_type", pay_type_enum, nullable=False, server_default="hourly"),
    )
    op.add_column(
        "users",
        sa.Column("monthly_salary", sa.Numeric(10, 2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "monthly_salary")
    op.drop_column("users", "pay_type")
    op.execute("DROP TYPE pay_type")
