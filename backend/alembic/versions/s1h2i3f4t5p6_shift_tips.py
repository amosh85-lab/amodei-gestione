"""shift_tips

Revision ID: s1h2i3f4t5p6
Revises: d4y5l6e7a8v9
Create Date: 2026-06-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 's1h2i3f4t5p6'
down_revision = 'd4y5l6e7a8v9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'shift_tips',
        sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column('date', sa.Date(), nullable=False, index=True),
        sa.Column(
            'service',
            postgresql.ENUM(name='service_kind', create_type=False),
            nullable=False,
        ),
        sa.Column('amount', sa.Numeric(8, 2), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_by_user_id', sa.BigInteger(), nullable=False, index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='RESTRICT'),
        sa.UniqueConstraint('date', 'service', name='uq_shift_tips_date_service'),
        sa.CheckConstraint('amount > 0', name='ck_shift_tips_amount_positive'),
    )


def downgrade() -> None:
    op.drop_table('shift_tips')
