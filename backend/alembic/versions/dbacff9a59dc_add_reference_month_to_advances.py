"""add_reference_month_to_advances

Revision ID: dbacff9a59dc
Revises: 0c9acbd43bcb
Create Date: 2026-05-24 15:28:30.357698

Additive strategy (safe to apply with data, even though today the table
only holds test rows):
  1. Add reference_month as NULLABLE.
  2. Backfill: each existing row gets reference_month = TO_CHAR(date, 'YYYY-MM').
     For test rows this is a sensible default — same month the advance was given.
  3. ALTER COLUMN SET NOT NULL.
  4. Add CHECK constraint on the YYYY-MM regex.
  5. Add the two indices used by the queries (ref_month alone, and
     composite user_id + ref_month).

Downgrade reverses the steps.
"""
from alembic import op
import sqlalchemy as sa


revision = 'dbacff9a59dc'
down_revision = '0c9acbd43bcb'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add column nullable
    op.add_column(
        'employee_advances',
        sa.Column('reference_month', sa.String(length=7), nullable=True),
    )
    # 2. Backfill: derive YYYY-MM from existing date
    op.execute(
        "UPDATE employee_advances "
        "SET reference_month = TO_CHAR(date, 'YYYY-MM') "
        "WHERE reference_month IS NULL"
    )
    # 3. Enforce NOT NULL now that every row has a value
    op.alter_column('employee_advances', 'reference_month', nullable=False)
    # 4. CHECK constraint on the YYYY-MM format
    op.create_check_constraint(
        'ck_employee_advances_reference_month_format',
        'employee_advances',
        r"reference_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'",
    )
    # 5. Indices for the new query patterns (filter by reference_month;
    #    "what does user X owe to which payroll")
    op.create_index(
        'ix_employee_advances_reference_month',
        'employee_advances', ['reference_month'], unique=False,
    )
    op.create_index(
        'ix_employee_advances_user_reference_month',
        'employee_advances', ['user_id', 'reference_month'], unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_employee_advances_user_reference_month', table_name='employee_advances')
    op.drop_index('ix_employee_advances_reference_month', table_name='employee_advances')
    op.drop_constraint('ck_employee_advances_reference_month_format', 'employee_advances', type_='check')
    op.drop_column('employee_advances', 'reference_month')
