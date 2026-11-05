"""pay_rate_history

Revision ID: p1a2y3r4a5t6
Revises: ddt1n2o3t4e5
Create Date: 2026-11-05

Storico delle modifiche al compenso (tariffa oraria o stipendio fisso) di
un dipendente, con la data da cui vale ogni modifica. users.pay_type /
hourly_rate / monthly_salary restano la tariffa CORRENTE (sincronizzata
quando si aggiunge una riga qui); il calcolo busta paga mensile usa questa
tabella per applicare la tariffa giusta a ogni sotto-periodo del mese se
cambia a meta' mese.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'p1a2y3r4a5t6'
down_revision = 'ddt1n2o3t4e5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    pay_type_enum = postgresql.ENUM("hourly", "fixed", name="pay_type", create_type=False)
    op.create_table(
        'pay_rate_history',
        sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.BigInteger(), nullable=False, index=True),
        sa.Column('effective_from', sa.Date(), nullable=False, index=True),
        sa.Column('pay_type', pay_type_enum, nullable=False),
        sa.Column('hourly_rate', sa.Numeric(8, 2), nullable=True),
        sa.Column('monthly_salary', sa.Numeric(10, 2), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_by_user_id', sa.BigInteger(), nullable=False, index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='RESTRICT'),
        sa.UniqueConstraint('user_id', 'effective_from', name='uq_pay_rate_history_user_date'),
    )


def downgrade() -> None:
    op.drop_table('pay_rate_history')
