"""movement_source + staff_meal_cancellation

Revision ID: eda965f7aa6c
Revises: fedf57c3bd43
Create Date: 2026-05-23 20:47:37.890326

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'eda965f7aa6c'
down_revision = 'fedf57c3bd43'
branch_labels = None
depends_on = None


movement_source_enum = sa.Enum(
    'load', 'sale', 'waste', 'staff_meal', 'adjustment',
    name='movement_source',
)


def upgrade() -> None:
    # Create the new Postgres enum type up-front (Alembic autogenerate
    # doesn't always emit it when used inline in add_column).
    movement_source_enum.create(op.get_bind(), checkfirst=True)

    op.add_column('movements', sa.Column('source_type', movement_source_enum, nullable=True))
    op.add_column('movements', sa.Column('source_id', sa.BigInteger(), nullable=True))
    op.create_index('ix_movements_source', 'movements', ['source_type', 'source_id'], unique=False)

    op.add_column('staff_meals', sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('staff_meals', sa.Column('cancelled_by_user_id', sa.BigInteger(), nullable=True))
    op.create_index(op.f('ix_staff_meals_cancelled_by_user_id'), 'staff_meals', ['cancelled_by_user_id'], unique=False)
    op.create_foreign_key(
        'fk_staff_meals_cancelled_by_user_id',
        'staff_meals', 'users',
        ['cancelled_by_user_id'], ['id'], ondelete='RESTRICT',
    )


def downgrade() -> None:
    op.drop_constraint('fk_staff_meals_cancelled_by_user_id', 'staff_meals', type_='foreignkey')
    op.drop_index(op.f('ix_staff_meals_cancelled_by_user_id'), table_name='staff_meals')
    op.drop_column('staff_meals', 'cancelled_by_user_id')
    op.drop_column('staff_meals', 'cancelled_at')

    op.drop_index('ix_movements_source', table_name='movements')
    op.drop_column('movements', 'source_id')
    op.drop_column('movements', 'source_type')
    movement_source_enum.drop(op.get_bind(), checkfirst=True)
