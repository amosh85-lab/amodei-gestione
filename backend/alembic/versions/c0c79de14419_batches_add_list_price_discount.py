"""batches_add_list_price_discount

Revision ID: c0c79de14419
Revises: 6aadac2f0aa5
Create Date: 2026-05-25 19:01:52.864650

Aggiunge a `batches` due colonne opzionali per gestire lo sconto:
- list_price_unit: prezzo unitario di LISTINO (pre-sconto)
- discount_pct: percentuale sconto applicato (es. 15.00)

Il campo esistente `purchase_price_unit` continua a essere il NETTO finale
unitario — alimenta food cost, margini, valorizzazione magazzino.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c0c79de14419'
down_revision = '6aadac2f0aa5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("batches", sa.Column("list_price_unit", sa.Numeric(10, 4), nullable=True))
    op.add_column("batches", sa.Column("discount_pct", sa.Numeric(5, 2), nullable=True))


def downgrade() -> None:
    op.drop_column("batches", "discount_pct")
    op.drop_column("batches", "list_price_unit")
