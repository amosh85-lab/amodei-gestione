"""CRUD endpoints for products + per-product detail with batches."""
from __future__ import annotations

import logging
from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import distinct, exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import (
    get_current_user,
    require_admin,
    require_manager_or_admin,
)
from app.models.inventory import Batch, Product, Supplier
from app.models.users import User
from app.schemas.products import (
    ProductBatchSummary,
    ProductCreate,
    ProductDetail,
    ProductOutWithStock,
    ProductUpdate,
)

router = APIRouter(prefix="/products", tags=["products"])
logger = logging.getLogger("amodei.products")

# Fixed threshold for the always-on ``expiring_soon_count`` aggregate
# (the dynamic ?expiring_within_days filter is independent of this).
EXPIRING_SOON_DAYS = 5


def _conflict_code_exception() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Codice prodotto già usato da un altro prodotto.",
    )


def _is_code_uniqueness_violation(exc: IntegrityError) -> bool:
    """Heuristic check: distinguish the partial-unique on Product.code from
    other integrity errors (e.g. FK violation on preferred_supplier_id)."""
    orig = str(exc.orig or "")
    return "uq_products_code_when_not_null" in orig or 'products' in orig and 'code' in orig


def _compute_aggregates(
    session: Session, product_id: int, today: date
) -> tuple[Decimal, int, date | None]:
    threshold = today + timedelta(days=EXPIRING_SOON_DAYS)
    qty_total = session.scalar(
        select(func.coalesce(func.sum(Batch.current_qty), 0))
        .where(Batch.product_id == product_id)
    ) or Decimal("0")
    exp_count = session.scalar(
        select(func.count(Batch.id))
        .where(
            Batch.product_id == product_id,
            Batch.current_qty > 0,
            Batch.expiry_date.isnot(None),
            Batch.expiry_date <= threshold,
        )
    ) or 0
    next_expiry = session.scalar(
        select(func.min(Batch.expiry_date))
        .where(
            Batch.product_id == product_id,
            Batch.current_qty > 0,
            Batch.expiry_date.isnot(None),
        )
    )
    return Decimal(qty_total), int(exp_count), next_expiry


# -------------------------------------------------------------------
# GET /products/categories — distinct list of non-null categories
# -------------------------------------------------------------------
@router.get("/categories", response_model=list[str])
def list_categories(
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> list[str]:
    stmt = (
        select(distinct(Product.category))
        .where(Product.category.isnot(None))
        .order_by(Product.category.asc())
    )
    return [row[0] for row in session.execute(stmt).all()]


# -------------------------------------------------------------------
# GET /products — list with aggregates and filters
# -------------------------------------------------------------------
@router.get("", response_model=list[ProductOutWithStock])
def list_products(
    category: str | None = Query(None, description="Filtra per categoria esatta"),
    active: bool | None = Query(True, description="Filtra per stato attivo. Passa esplicitamente 'false' per vedere i disattivati."),
    search: str | None = Query(None, min_length=1, max_length=80, description="Match case-insensitive su name o code"),
    supplier_id: int | None = Query(None, description="Solo prodotti con questo fornitore preferito"),
    expiring_within_days: int | None = Query(
        None, ge=0, le=365,
        description="Solo prodotti con almeno un lotto in scadenza entro N giorni (e current_qty > 0)",
    ),
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> list[ProductOutWithStock]:
    today = date.today()
    expiring_threshold = today + timedelta(days=EXPIRING_SOON_DAYS)

    # Subquery: sum of current_qty per product
    qty_subq = (
        select(
            Batch.product_id.label("product_id"),
            func.sum(Batch.current_qty).label("qty_total"),
        )
        .group_by(Batch.product_id)
        .subquery()
    )

    # Subquery: count of batches expiring within EXPIRING_SOON_DAYS (and still in stock)
    exp_subq = (
        select(
            Batch.product_id.label("product_id"),
            func.count(Batch.id).label("expiring_count"),
        )
        .where(
            Batch.current_qty > 0,
            Batch.expiry_date.isnot(None),
            Batch.expiry_date <= expiring_threshold,
        )
        .group_by(Batch.product_id)
        .subquery()
    )

    # Subquery: earliest expiry across in-stock batches per product
    next_exp_subq = (
        select(
            Batch.product_id.label("product_id"),
            func.min(Batch.expiry_date).label("next_expiry_date"),
        )
        .where(
            Batch.current_qty > 0,
            Batch.expiry_date.isnot(None),
        )
        .group_by(Batch.product_id)
        .subquery()
    )

    stmt = (
        select(
            Product,
            func.coalesce(qty_subq.c.qty_total, 0).label("qty_total"),
            func.coalesce(exp_subq.c.expiring_count, 0).label("expiring_count"),
            next_exp_subq.c.next_expiry_date.label("next_expiry_date"),
        )
        .outerjoin(qty_subq, qty_subq.c.product_id == Product.id)
        .outerjoin(exp_subq, exp_subq.c.product_id == Product.id)
        .outerjoin(next_exp_subq, next_exp_subq.c.product_id == Product.id)
    )

    if active is not None:
        stmt = stmt.where(Product.active.is_(active))
    if category:
        stmt = stmt.where(Product.category == category)
    if supplier_id is not None:
        stmt = stmt.where(Product.preferred_supplier_id == supplier_id)
    if search:
        like = f"%{search.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Product.name).like(like),
                func.lower(Product.code).like(like),
            )
        )
    if expiring_within_days is not None:
        threshold = today + timedelta(days=expiring_within_days)
        stmt = stmt.where(
            exists().where(
                Batch.product_id == Product.id,
                Batch.current_qty > 0,
                Batch.expiry_date.isnot(None),
                Batch.expiry_date <= threshold,
            )
        )

    stmt = stmt.order_by(func.lower(Product.name).asc())

    out: list[ProductOutWithStock] = []
    for product, qty_total, exp_count, next_expiry in session.execute(stmt).all():
        item = ProductOutWithStock.model_validate(product)
        item.qty_total = Decimal(qty_total or 0)
        item.expiring_soon_count = int(exp_count or 0)
        item.next_expiry_date = next_expiry
        out.append(item)
    return out


# -------------------------------------------------------------------
# POST /products — create
# -------------------------------------------------------------------
@router.post("", response_model=ProductOutWithStock, status_code=status.HTTP_201_CREATED)
def create_product(
    payload: ProductCreate,
    session: Session = Depends(get_session),
    user: User = Depends(require_manager_or_admin),
) -> ProductOutWithStock:
    product = Product(**payload.model_dump(), active=True)
    session.add(product)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        if _is_code_uniqueness_violation(exc):
            raise _conflict_code_exception() from exc
        logger.exception("IntegrityError su POST /products: %s", exc.orig)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Vincolo violato. Controlla i campi (es. preferred_supplier_id deve esistere).",
        ) from exc
    session.refresh(product)
    logger.info("Product creato id=%d name=%r by user_id=%d", product.id, product.name, user.id)

    out = ProductOutWithStock.model_validate(product)
    out.qty_total = Decimal("0")
    out.expiring_soon_count = 0
    return out


# -------------------------------------------------------------------
# GET /products/{id} — detail with batches
# -------------------------------------------------------------------
@router.get("/{product_id}", response_model=ProductDetail)
def get_product(
    product_id: int,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> ProductDetail:
    product = session.get(Product, product_id)
    if product is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prodotto non trovato")

    today = date.today()
    qty_total, exp_count, next_expiry = _compute_aggregates(session, product_id, today)

    batches_stmt = (
        select(Batch, Supplier.name)
        .outerjoin(Supplier, Supplier.id == Batch.supplier_id)
        .where(Batch.product_id == product_id)
        .order_by(
            Batch.expiry_date.asc().nulls_last(),
            Batch.load_date.desc(),
        )
    )
    batches: list[ProductBatchSummary] = []
    for batch, supplier_name in session.execute(batches_stmt).all():
        item = ProductBatchSummary.model_validate(batch)
        item.supplier_name = supplier_name
        batches.append(item)

    detail = ProductDetail.model_validate(product)
    detail.qty_total = qty_total
    detail.expiring_soon_count = exp_count
    detail.next_expiry_date = next_expiry
    detail.batches = batches
    return detail


# -------------------------------------------------------------------
# PATCH /products/{id} — update
# -------------------------------------------------------------------
@router.patch("/{product_id}", response_model=ProductOutWithStock)
def update_product(
    product_id: int,
    payload: ProductUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(require_manager_or_admin),
) -> ProductOutWithStock:
    product = session.get(Product, product_id)
    if product is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prodotto non trovato")

    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(product, key, value)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        if _is_code_uniqueness_violation(exc):
            raise _conflict_code_exception() from exc
        logger.exception("IntegrityError su PATCH /products/%d: %s", product_id, exc.orig)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Vincolo violato. Controlla i campi.",
        ) from exc
    session.refresh(product)
    logger.info(
        "Product aggiornato id=%d fields=%s by user_id=%d",
        product.id, list(changes), user.id,
    )

    qty_total, exp_count, next_expiry = _compute_aggregates(session, product_id, date.today())
    out = ProductOutWithStock.model_validate(product)
    out.qty_total = qty_total
    out.expiring_soon_count = exp_count
    out.next_expiry_date = next_expiry
    return out


# -------------------------------------------------------------------
# DELETE /products/{id} — soft delete with open-batch check
# -------------------------------------------------------------------
@router.delete(
    "/{product_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def delete_product(
    product_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(require_admin),
) -> None:
    product = session.get(Product, product_id)
    if product is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prodotto non trovato")

    open_batches = session.scalar(
        select(func.count(Batch.id)).where(
            Batch.product_id == product_id,
            Batch.current_qty > 0,
        )
    ) or 0
    if open_batches > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Esistono lotti con scorta residua. Smaltirli prima di disattivare il prodotto.",
        )

    if product.active is False:
        # Idempotent.
        return
    product.active = False
    session.commit()
    logger.info("Product soft-deleted id=%d by user_id=%d", product.id, user.id)
