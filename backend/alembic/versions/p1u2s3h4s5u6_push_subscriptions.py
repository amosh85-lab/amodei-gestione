"""push_subscriptions

Revision ID: p1u2s3h4s5u6
Revises: a1b2c3d4e5f6
Create Date: 2026-05-30 12:00:00.000000

Crea la tabella push_subscriptions: una riga per (utente, browser/dispositivo).
L'endpoint è univoco — upsert lato API quando arriva una nuova subscribe per
un endpoint già esistente. ON DELETE CASCADE: se rimuovi l'utente, scompaiono
anche le sue subscription.
"""
from alembic import op
import sqlalchemy as sa


revision = 'p1u2s3h4s5u6'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("p256dh", sa.Text(), nullable=False),
        sa.Column("auth", sa.Text(), nullable=False),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("endpoint", name="uq_push_subscriptions_endpoint"),
    )
    op.create_index(
        "ix_push_subscriptions_user_id",
        "push_subscriptions",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_push_subscriptions_user_id", table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
