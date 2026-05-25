"""CRUD endpoints for batches (stock loading)."""
from __future__ import annotations

import logging
from datetime import date as date_type, timedelta
from decimal import Decimal

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import (
    get_current_user,
    require_admin,
    require_manager_or_admin,
)
from app.models.inventory import Batch, Movement, MovementType, Product, Supplier
from app.models.users import User
from app.schemas.batches import (
    BatchOut,
    BatchPatch,
    ProductSummary,
    SupplierSummary,
)
from app.services.storage import UploadError, upload_image

router = APIRouter(prefix="/batches", tags=["batches"])
logger = logging.getLogger("amodei.batches")


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------


def _batch_to_out(
    session: Session, batch: Batch, *, product: Product | None = None
) -> BatchOut:
    """Hydrate a Batch into BatchOut with product + supplier summaries."""
    out = BatchOut.model_validate(batch)
    prod = product if product is not None else session.get(Product, batch.product_id)
    if prod is not None:
        out.product = ProductSummary.model_validate(prod)
    if batch.supplier_id is not None:
        sup = session.get(Supplier, batch.supplier_id)
        if sup is not None:
            out.supplier = SupplierSummary.model_validate(sup)
    return out


# ----------------------------------------------------------------------
# POST /batches — create a batch (multipart, optional photo)
# ----------------------------------------------------------------------
@router.post("", response_model=BatchOut, status_code=status.HTTP_201_CREATED)
def create_batch(
    product_id: int = Form(..., gt=0),
    initial_qty: Decimal = Form(..., gt=0),
    purchase_price_unit: Decimal = Form(..., ge=0),
    list_price_unit: Decimal | None = Form(None, ge=0),
    discount_pct: Decimal | None = Form(None, ge=0, le=100),
    supplier_id: int | None = Form(None),
    load_date: date_type | None = Form(None),
    expiry_date: date_type | None = Form(None),
    notes: str | None = Form(None),
    receipt_photo: UploadFile | None = File(None),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> BatchOut:
    product = session.get(Product, product_id)
    if product is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Prodotto non trovato.")
    if not product.active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Il prodotto è disattivato.")

    if supplier_id is not None:
        supplier = session.get(Supplier, supplier_id)
        if supplier is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Fornitore non trovato.")

    receipt_url: str | None = None
    if receipt_photo is not None and receipt_photo.filename:
        try:
            receipt_url = upload_image(receipt_photo, folder="receipts")
        except UploadError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    batch = Batch(
        product_id=product_id,
        supplier_id=supplier_id,
        initial_qty=initial_qty,
        current_qty=initial_qty,
        purchase_price_unit=purchase_price_unit,
        list_price_unit=list_price_unit,
        discount_pct=discount_pct,
        load_date=load_date or date_type.today(),
        expiry_date=expiry_date,
        receipt_photo_url=receipt_url,
        notes=notes,
        created_by_user_id=user.id,
    )
    session.add(batch)
    session.flush()  # need batch.id for the Movement FK

    movement = Movement(
        batch_id=batch.id,
        product_id=product_id,
        type=MovementType.load,
        qty=initial_qty,
        reason="Carico iniziale",
        user_id=user.id,
    )
    session.add(movement)

    # Update product's last seen purchase price (per the prompt-1 promise).
    product.last_purchase_price = purchase_price_unit

    session.commit()
    session.refresh(batch)
    logger.info(
        "Batch creato id=%d product_id=%d qty=%s by user_id=%d",
        batch.id, product_id, initial_qty, user.id,
    )
    return _batch_to_out(session, batch, product=product)


# ----------------------------------------------------------------------
# GET /batches — list with filters
# ----------------------------------------------------------------------
@router.get("", response_model=list[BatchOut])
def list_batches(
    product_id: int | None = Query(None),
    supplier_id: int | None = Query(None),
    expiring_within_days: int | None = Query(None, ge=0, le=365),
    include_empty: bool = Query(False, description="Include batches con current_qty = 0"),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> list[BatchOut]:
    stmt = select(Batch)
    if product_id is not None:
        stmt = stmt.where(Batch.product_id == product_id)
    if supplier_id is not None:
        stmt = stmt.where(Batch.supplier_id == supplier_id)
    if not include_empty:
        stmt = stmt.where(Batch.current_qty > 0)
    if expiring_within_days is not None:
        threshold = date_type.today() + timedelta(days=expiring_within_days)
        stmt = stmt.where(
            Batch.expiry_date.isnot(None),
            Batch.expiry_date <= threshold,
        )
    stmt = stmt.order_by(
        Batch.expiry_date.asc().nulls_last(),
        Batch.load_date.desc(),
    ).limit(limit).offset(offset)

    batches = list(session.scalars(stmt))
    return [_batch_to_out(session, b) for b in batches]


# ----------------------------------------------------------------------
# GET /batches/{id} — detail
# ----------------------------------------------------------------------
@router.get("/{batch_id}", response_model=BatchOut)
def get_batch(
    batch_id: int,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> BatchOut:
    batch = session.get(Batch, batch_id)
    if batch is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lotto non trovato.")
    return _batch_to_out(session, batch)


# ----------------------------------------------------------------------
# PATCH /batches/{id} — admin/manager, limited fields
# ----------------------------------------------------------------------
@router.patch("/{batch_id}", response_model=BatchOut)
def update_batch(
    batch_id: int,
    payload: BatchPatch,
    session: Session = Depends(get_session),
    user: User = Depends(require_manager_or_admin),
) -> BatchOut:
    batch = session.get(Batch, batch_id)
    if batch is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lotto non trovato.")
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        # Allow clearing receipt_photo_url with explicit "" → None
        if key == "receipt_photo_url" and value == "":
            value = None
        setattr(batch, key, value)
    session.commit()
    session.refresh(batch)
    logger.info(
        "Batch aggiornato id=%d fields=%s by user_id=%d",
        batch.id, list(changes), user.id,
    )
    return _batch_to_out(session, batch)


# ----------------------------------------------------------------------
# DELETE /batches/{id} — admin only, strict conditions
# ----------------------------------------------------------------------
@router.delete(
    "/{batch_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def delete_batch(
    batch_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(require_admin),
) -> None:
    batch = session.get(Batch, batch_id)
    if batch is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lotto non trovato.")

    if batch.current_qty != batch.initial_qty:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Il lotto è già stato movimentato: non si può eliminare. Usa una rettifica per azzerarlo.",
        )

    # Only the initial "load" movement allowed.
    non_load_exists = session.scalar(
        select(exists().where(
            Movement.batch_id == batch_id,
            Movement.type != MovementType.load,
        ))
    )
    if non_load_exists:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Esistono movimenti diversi dal carico iniziale: non si può eliminare il lotto.",
        )

    # Delete the initial load movement first (it's the only one allowed).
    session.execute(
        Movement.__table__.delete().where(Movement.batch_id == batch_id)
    )
    session.delete(batch)
    session.commit()
    logger.info("Batch eliminato id=%d by user_id=%d", batch.id, user.id)
