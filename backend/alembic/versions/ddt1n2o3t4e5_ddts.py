"""ddts (documenti di trasporto)

Revision ID: ddt1n2o3t4e5
Revises: s1h2i3f4t5p6
Create Date: 2026-06-24
"""
from alembic import op
import sqlalchemy as sa


revision = 'ddt1n2o3t4e5'
down_revision = 's1h2i3f4t5p6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'ddts',
        sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column('supplier_id', sa.BigInteger(), nullable=False, index=True),
        sa.Column('ddt_number', sa.String(length=50), nullable=False),
        sa.Column('ddt_date', sa.Date(), nullable=False, index=True),
        sa.Column('amount_total', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('photo_url', sa.Text(), nullable=True),
        sa.Column('invoice_id', sa.BigInteger(), nullable=True, index=True),
        sa.Column('created_by_user_id', sa.BigInteger(), nullable=False, index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['supplier_id'], ['suppliers.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['invoice_id'], ['invoices.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='RESTRICT'),
        sa.UniqueConstraint('supplier_id', 'ddt_number', name='uq_ddts_supplier_number'),
        sa.CheckConstraint('amount_total > 0', name='ck_ddts_amount_positive'),
    )
    op.create_index('ix_ddts_supplier_date', 'ddts', ['supplier_id', 'ddt_date'])


def downgrade() -> None:
    op.drop_table('ddts')
