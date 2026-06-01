"""day_leaves

Revision ID: d4y5l6e7a8v9
Revises: p4y5r6s7l8t9
Create Date: 2026-06-01
"""
from alembic import op
import sqlalchemy as sa


revision = 'd4y5l6e7a8v9'
down_revision = 'p4y5r6s7l8t9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS day_leaves CASCADE")
    op.execute("DROP TYPE IF EXISTS day_leave_kind CASCADE")
    op.create_table(
        'day_leaves',
        sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.BigInteger(), nullable=False, index=True),
        sa.Column('date', sa.Date(), nullable=False, index=True),
        sa.Column(
            'kind',
            sa.Enum('ferie', 'riposo', 'malattia', name='day_leave_kind'),
            nullable=False,
        ),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_by_user_id', sa.BigInteger(), nullable=False, index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='RESTRICT'),
        sa.UniqueConstraint('user_id', 'date', name='uq_day_leaves_user_date'),
    )


def downgrade() -> None:
    op.drop_table('day_leaves')
    op.execute("DROP TYPE IF EXISTS day_leave_kind")
