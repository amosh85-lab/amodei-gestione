"""/invoices router — supplier invoices CRUD with role-aware response shape.

Permission model:
- Manager + admin: create / read list / read detail / update unpaid invoices
  → response is InvoiceOut (no payment info).
- Admin only: delete invoice (only if unpaid) + see is_paid/payment in response
  → response is InvoiceOutWithPayment.
- Staff: 403 on every endpoint.

Manager constraint: can update invoice only if invoice_date is in current month.
"""
from __future__ import annotations

import logging
from datetime import date as date_type
from decimal import Decimal
from typing import Literal

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
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import require_admin, require_manager_or_admin
from app.models.invoices import Invoice, InvoicePayment, Payment
from app.models.inventory import Supplier, SupplierCategory
from app.models.users import User, UserRole
from app.schemas.invoices import (
    InvoiceCreate,
    InvoiceMini,
    InvoiceOut,
    InvoiceOutWithPayment,
    InvoiceUpdate,
    UnpaidBySupplierRow,
    UnpaidSummaryOut,
)
from app.services.storage import UploadError, upload_image

router = APIRouter(prefix="/invoices", tags=["invoices"])
logger = logging.getLogger("amodei.invoices")


def _current_month_range(today: date_type | None = None) -> tuple[date_type, date_type]:
    today = today or date_type.today()
    first = today.replace(day=1)
    if today.month == 12:
        next_first = date_type(today.year + 1, 1, 1)
    else:
        next_first = date_type(today.year, today.month + 1, 1)
    return first, next_first


def _hydrate(inv: Invoice, session: Session, *, include_payment: bool):
    """Build InvoiceOut or InvoiceOutWithPayment depending on the caller role."""
    supplier = session.get(Supplier, inv.supplier_id)
    created_by = session.get(User, inv.created_by_user_id)
    base = {
        "id": inv.id,
        "supplier": {"id": supplier.id, "name": supplier.name,
                     "category": supplier.category.value if hasattr(supplier.category, "value") else supplier.category},
        "invoice_number": inv.invoice_number,
        "invoice_date": inv.invoice_date,
        "amount_total": inv.amount_total,
        "notes": inv.notes,
        "photo_url": inv.photo_url,
        "created_by": created_by,
        "created_at": inv.created_at,
        "updated_at": inv.updated_at,
    }
    if not include_payment:
        return InvoiceOut(**base)
    ip = inv.invoice_payment
    if ip is None:
        return InvoiceOutWithPayment(**base, is_paid=False, payment=None)
    p = session.get(Payment, ip.payment_id)
    return InvoiceOutWithPayment(
        **base, is_paid=True,
        payment={"id": p.id, "payment_date": p.payment_date,
                 "method": p.method.value if hasattr(p.method, "value") else p.method,
                 "check_number": p.check_number},
    )


# ---------------------------------------------------------------------
# POST /invoices


@router.post("", status_code=status.HTTP_201_CREATED)
def create_invoice(
    supplier_id: int = Form(..., gt=0),
    invoice_number: str = Form(..., min_length=1, max_length=50),
    invoice_date: date_type = Form(...),
    amount_total: Decimal = Form(..., gt=0),
    notes: str | None = Form(None),
    photo: UploadFile | None = File(None),
    session: Session = Depends(get_session),
    actor: User = Depends(require_manager_or_admin),
):
    supplier = session.get(Supplier, supplier_id)
    if supplier is None or not supplier.active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Fornitore inesistente o disattivato.")

    # Pre-check uniqueness on (supplier_id, invoice_number) to return 409 with
    # a user-friendly message rather than let the DB constraint fire.
    dup = session.scalar(
        select(Invoice).where(
            Invoice.supplier_id == supplier_id,
            Invoice.invoice_number == invoice_number.strip(),
        )
    )
    if dup is not None:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Fattura già registrata per questo fornitore.")

    photo_url: str | None = None
    if photo is not None and photo.filename:
        try:
            photo_url = upload_image(photo, "invoices")
        except UploadError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))

    inv = Invoice(
        supplier_id=supplier_id,
        invoice_number=invoice_number.strip(),
        invoice_date=invoice_date,
        amount_total=amount_total,
        notes=notes,
        photo_url=photo_url,
        created_by_user_id=actor.id,
    )
    session.add(inv)
    session.commit()
    session.refresh(inv)
    logger.info("Invoice created: id=%d supplier_id=%d number=%s amount=%s by=%d",
                inv.id, supplier_id, invoice_number, amount_total, actor.id)
    is_admin = actor.role == UserRole.admin
    return _hydrate(inv, session, include_payment=is_admin)


# ---------------------------------------------------------------------
# GET /invoices


@router.get("")
def list_invoices(
    from_date: date_type | None = Query(None, alias="from_date"),
    to_date: date_type | None = Query(None, alias="to_date"),
    supplier_id: int | None = Query(None),
    category: Literal["food", "beverage", "consumo"] | None = Query(None),
    paid: bool | None = Query(None),
    search: str | None = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
    actor: User = Depends(require_manager_or_admin),
):
    is_admin = actor.role == UserRole.admin

    if from_date is None and to_date is None:
        from_date, end_excl = _current_month_range()
        to_date = end_excl

    stmt = select(Invoice).join(Supplier, Invoice.supplier_id == Supplier.id)
    if from_date is not None:
        stmt = stmt.where(Invoice.invoice_date >= from_date)
    if to_date is not None:
        stmt = stmt.where(Invoice.invoice_date < to_date)
    if supplier_id is not None:
        stmt = stmt.where(Invoice.supplier_id == supplier_id)
    if category is not None:
        stmt = stmt.where(Supplier.category == category)
    if search:
        stmt = stmt.where(Invoice.invoice_number.ilike(f"%{search.strip()}%"))
    # Paid filter is ADMIN ONLY (silently ignored for manager).
    if paid is not None and is_admin:
        if paid:
            stmt = stmt.where(Invoice.id.in_(select(InvoicePayment.invoice_id)))
        else:
            stmt = stmt.where(~Invoice.id.in_(select(InvoicePayment.invoice_id)))

    stmt = stmt.order_by(Invoice.invoice_date.desc(), Invoice.created_at.desc()).limit(limit).offset(offset)

    return [_hydrate(inv, session, include_payment=is_admin) for inv in session.scalars(stmt)]


# ---------------------------------------------------------------------
# GET /invoices/unpaid (admin only) — must be BEFORE /{id} to avoid match


@router.get("/unpaid", response_model=UnpaidSummaryOut)
def unpaid_invoices(
    session: Session = Depends(get_session),
    _actor: User = Depends(require_admin),
) -> UnpaidSummaryOut:
    paid_ids = select(InvoicePayment.invoice_id)
    invoices = list(session.scalars(
        select(Invoice).where(~Invoice.id.in_(paid_ids)).order_by(Invoice.invoice_date.asc())
    ))
    if not invoices:
        return UnpaidSummaryOut(total_unpaid=Decimal("0"), count=0, by_supplier=[])

    # Group by supplier
    suppliers_by_id = {
        s.id: s for s in session.scalars(
            select(Supplier).where(Supplier.id.in_({inv.supplier_id for inv in invoices}))
        )
    }
    groups: dict[int, UnpaidBySupplierRow] = {}
    total = Decimal("0")
    for inv in invoices:
        s = suppliers_by_id.get(inv.supplier_id)
        if not s:
            continue
        if s.id not in groups:
            groups[s.id] = UnpaidBySupplierRow(
                supplier={"id": s.id, "name": s.name,
                          "category": s.category.value if hasattr(s.category, "value") else s.category},
                total=Decimal("0"), count=0, invoices=[],
            )
        groups[s.id].total += inv.amount_total
        groups[s.id].count += 1
        groups[s.id].invoices.append(InvoiceMini(
            id=inv.id, invoice_number=inv.invoice_number,
            invoice_date=inv.invoice_date, amount_total=inv.amount_total,
        ))
        total += inv.amount_total

    rows = sorted(groups.values(), key=lambda r: r.total, reverse=True)
    return UnpaidSummaryOut(total_unpaid=total, count=len(invoices), by_supplier=rows)


# ---------------------------------------------------------------------
# GET /invoices/{id}


@router.get("/{invoice_id}")
def get_invoice(
    invoice_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(require_manager_or_admin),
):
    inv = session.get(Invoice, invoice_id)
    if inv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fattura non trovata.")
    return _hydrate(inv, session, include_payment=actor.role == UserRole.admin)


# ---------------------------------------------------------------------
# PATCH /invoices/{id}


@router.patch("/{invoice_id}")
def update_invoice(
    invoice_id: int,
    payload: InvoiceUpdate,
    session: Session = Depends(get_session),
    actor: User = Depends(require_manager_or_admin),
):
    inv = session.get(Invoice, invoice_id)
    if inv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fattura non trovata.")
    is_admin = actor.role == UserRole.admin
    is_paid = inv.invoice_payment is not None

    # Manager may only patch invoices of the current month.
    if not is_admin:
        first, end_excl = _current_month_range()
        if not (first <= inv.invoice_date < end_excl):
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                "Il manager può modificare solo fatture del mese corrente.")

    changes = payload.model_dump(exclude_unset=True)

    # amount_total cannot change once paid (otherwise the payment total no longer matches).
    if is_paid and "amount_total" in changes and changes["amount_total"] is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Fattura già pagata: non puoi modificare l'importo. Annulla prima il pagamento.")

    # Uniqueness check on (supplier_id, invoice_number) if number is changing.
    if "invoice_number" in changes and changes["invoice_number"] is not None:
        new_num = changes["invoice_number"].strip()
        if new_num != inv.invoice_number:
            dup = session.scalar(
                select(Invoice).where(
                    Invoice.supplier_id == inv.supplier_id,
                    Invoice.invoice_number == new_num,
                    Invoice.id != inv.id,
                )
            )
            if dup is not None:
                raise HTTPException(status.HTTP_409_CONFLICT,
                                    "Esiste già una fattura con questo numero per questo fornitore.")
            inv.invoice_number = new_num
        del changes["invoice_number"]
    for k, v in changes.items():
        setattr(inv, k, v)
    session.commit()
    session.refresh(inv)
    logger.info("Invoice updated: id=%d by=%d", inv.id, actor.id)
    return _hydrate(inv, session, include_payment=is_admin)


# ---------------------------------------------------------------------
# DELETE /invoices/{id} (admin only)


@router.delete("/{invoice_id}")
def delete_invoice(
    invoice_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(require_admin),
) -> dict:
    inv = session.get(Invoice, invoice_id)
    if inv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fattura non trovata.")
    if inv.invoice_payment is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Fattura collegata a un pagamento. Annulla prima il pagamento associato.")
    session.delete(inv)
    session.commit()
    logger.info("Invoice deleted: id=%d by_admin=%d", invoice_id, actor.id)
    return {"deleted_id": invoice_id}
