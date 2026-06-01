"""CRUD endpoints for suppliers."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import (
    get_current_user,
    require_admin,
    require_manager_or_admin,
)
from app.models.inventory import Batch, Product, Supplier
from app.models.invoices import Invoice
from app.models.reorder import SupplierOrder
from app.models.users import User
from app.schemas.suppliers import SupplierCreate, SupplierOut, SupplierUpdate

router = APIRouter(prefix="/suppliers", tags=["suppliers"])
logger = logging.getLogger("amodei.suppliers")


@router.get("", response_model=list[SupplierOut])
def list_suppliers(
    include_inactive: bool = Query(False, description="Includi anche fornitori disattivati"),
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> list[Supplier]:
    stmt = select(Supplier)
    if not include_inactive:
        stmt = stmt.where(Supplier.active.is_(True))
    stmt = stmt.order_by(Supplier.name.asc())
    return list(session.scalars(stmt))


@router.post("", response_model=SupplierOut, status_code=status.HTTP_201_CREATED)
def create_supplier(
    payload: SupplierCreate,
    session: Session = Depends(get_session),
    user: User = Depends(require_manager_or_admin),
) -> Supplier:
    supplier = Supplier(**payload.model_dump(), active=True)
    session.add(supplier)
    session.commit()
    session.refresh(supplier)
    logger.info("Supplier creato id=%d name=%r by user_id=%d", supplier.id, supplier.name, user.id)
    return supplier


@router.get("/{supplier_id}", response_model=SupplierOut)
def get_supplier(
    supplier_id: int,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> Supplier:
    supplier = session.get(Supplier, supplier_id)
    if supplier is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fornitore non trovato")
    return supplier


@router.patch("/{supplier_id}", response_model=SupplierOut)
def update_supplier(
    supplier_id: int,
    payload: SupplierUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(require_manager_or_admin),
) -> Supplier:
    supplier = session.get(Supplier, supplier_id)
    if supplier is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fornitore non trovato")
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(supplier, key, value)
    session.commit()
    session.refresh(supplier)
    logger.info("Supplier aggiornato id=%d fields=%s by user_id=%d", supplier.id, list(changes), user.id)
    return supplier


@router.delete(
    "/{supplier_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def delete_supplier(
    supplier_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(require_admin),
) -> None:
    supplier = session.get(Supplier, supplier_id)
    if supplier is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fornitore non trovato")
    if supplier.active is False:
        # Idempotent: already inactive — nothing to do.
        return
    supplier.active = False
    session.commit()
    logger.info("Supplier soft-deleted id=%d by user_id=%d", supplier.id, user.id)


@router.delete(
    "/{supplier_id}/permanent",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def hard_delete_supplier(
    supplier_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(require_admin),
) -> None:
    """Elimina DEFINITIVAMENTE un fornitore dal DB. Tre vincoli:
    1) deve esistere (404 altrimenti)
    2) deve essere già archiviato (active=False) — niente delete diretto
       di un fornitore attivo, sarebbe troppo facile sparire dati per
       sbaglio. Prima archivia (DELETE soft), poi elimina.
    3) non deve avere righe figlie su products / batches / invoices /
       supplier_orders (le FK sono RESTRICT). Se ne ha, ritorno 409
       con il dettaglio dei conteggi per categoria.
    """
    supplier = session.get(Supplier, supplier_id)
    if supplier is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fornitore non trovato")
    if supplier.active:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Prima archivia il fornitore (DELETE), poi puoi eliminarlo definitivamente.",
        )

    counts = {
        "products": session.scalar(
            select(func.count()).select_from(Product).where(Product.preferred_supplier_id == supplier_id)
        ) or 0,
        "batches": session.scalar(
            select(func.count()).select_from(Batch).where(Batch.supplier_id == supplier_id)
        ) or 0,
        "invoices": session.scalar(
            select(func.count()).select_from(Invoice).where(Invoice.supplier_id == supplier_id)
        ) or 0,
        "orders": session.scalar(
            select(func.count()).select_from(SupplierOrder).where(SupplierOrder.supplier_id == supplier_id)
        ) or 0,
    }
    total = sum(counts.values())
    if total > 0:
        bits = [f"{v} {k}" for k, v in counts.items() if v]
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Impossibile eliminare definitivamente: ci sono ancora riferimenti ({', '.join(bits)}). "
            "Riassegna o cancella prima questi record.",
        )

    session.delete(supplier)
    session.commit()
    logger.warning(
        "Supplier HARD-DELETED id=%d name=%r by user_id=%d",
        supplier_id, supplier.name, user.id,
    )
