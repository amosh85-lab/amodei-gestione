"""payroll_splits + employee_advances.payment_method

Revision ID: p4y5r6s7l8t9
Revises: v2a3u4l5t6m
Create Date: 2026-06-01
"""
from alembic import op
import sqlalchemy as sa


revision = 'p4y5r6s7l8t9'
down_revision = 'v2a3u4l5t6m'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. employee_advances.payment_method
    op.add_column(
        'employee_advances',
        sa.Column('payment_method', sa.String(length=16), nullable=False,
                  server_default='cash'),
    )
    op.create_check_constraint(
        'ck_employee_advances_payment_method',
        'employee_advances',
        "payment_method IN ('cash', 'bonifico')",
    )

    # 2. payroll_splits
    op.execute("DROP TABLE IF EXISTS payroll_splits CASCADE")
    op.create_table(
        'payroll_splits',
        sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.BigInteger(), nullable=False, index=True),
        sa.Column('payroll_month', sa.String(length=7), nullable=False),
        sa.Column('ben_amount', sa.Numeric(10, 2), nullable=False, server_default='0'),
        sa.Column('dan_amount', sa.Numeric(10, 2), nullable=False, server_default='0'),
        sa.Column('created_by_user_id', sa.BigInteger(), nullable=False, index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='RESTRICT'),
        sa.CheckConstraint('ben_amount >= 0', name='ck_payroll_splits_ben_nonneg'),
        sa.CheckConstraint('dan_amount >= 0', name='ck_payroll_splits_dan_nonneg'),
        sa.CheckConstraint(
            r"payroll_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'",
            name='ck_payroll_splits_month_format',
        ),
        sa.UniqueConstraint('user_id', 'payroll_month', name='uq_payroll_splits_user_month'),
    )


def downgrade() -> None:
    op.drop_table('payroll_splits')
    op.drop_constraint('ck_employee_advances_payment_method',
                       'employee_advances', type_='check')
    op.drop_column('employee_advances', 'payment_method')
