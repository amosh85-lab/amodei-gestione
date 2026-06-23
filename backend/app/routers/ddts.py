"""/ddts router — documenti di trasporto CRUD + generazione fattura.

Permission model (identico alle fatture):
- Manager + admin: create / read list / read summary / read detail /
  update DDT non fatturati / generare la fattura di fine mese.
- Admin only: delete DDT (solo se non fatturato).
- Staff: 403 su ogni endpoint.

Vincolo manager: può modificare un DDT solo se ddt_date è nel mese corrente.

Un DDT con invoice_id valorizzato è "fatturato": è di sola lettura finché la
fattura collegata non viene annullata (ondelete='SET NULL' libera i DDT).
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
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import require_admin, require_manager_or_admin
from app.models.ddts import Ddt
from app.models.invoices import Invoice
from app.models.inventory import Supplier
from app.models.users import User, UserRole
from app.schemas.ddts import (
    DdtBySupplierRow,
    DdtMini,
    DdtOut,
    DdtSummaryOut,
    DdtUpdate,
    GenerateInvoiceIn,
    GenerateInvoiceOut,
)
from app.services.storage import UploadError, upload_image

router = APIRouter(prefix="/ddts", tags=["ddts"])
logger = logging.getLogger("amodei.ddts")


def _current_month_range(today: date_type | None = None) -> tuple[date_type, date_type]:
    today = today or date_type.today()
    first = today.replace(day=1)
    if today.month == 12:
        next_first = date_type(today.year + 1, 1, 1)
    else:
        next_first = date_type(today.year, today.month + 1, 1)
    return first, next_first


def _hydrate(ddt: Ddt, session: Session) -> DdtOut:
    supplier = session.get(Supplier, ddt.supplier_id)
    created_by = session.get(User, ddt.created_by_user_id)
    invoice_ref = None
    if ddt.invoice_id is not None:
        inv = session.get(Invoice, ddt.invoice_id)
        if inv is not None:
            invoice_ref = {"id": inv.id, "invoice_number": inv.invoice_number,
                           "invoice_date": inv.invoice_date}
    return DdtOut(
        id=ddt.id,
        supplier={"id": supplier.id, "name": supplier.name,
                  "category": supplier.category.value if hasattr(supplier.category, "value") else supplier.category},
        ddt_number=ddt.ddt_number,
        ddt_date=ddt.ddt_date,
        amount_total=ddt.amount_total,
        notes=ddt.notes,
        photo_url=ddt.photo_url,
        is_billed=ddt.invoice_id is not None,
        invoice=invoice_ref,
        created_by=created_by,
        created_at=ddt.created_at,
        updated_at=ddt.updated_at,
    )


# ---------------------------------------------------------------------
# POST /ddts


@router.post("", status_code=status.HTTP_201_CREATED)
def create_ddt(
    supplier_id: int = Form(..., gt=0),
    ddt_number: str = Form(..., min_length=1, max_length=50),
    ddt_date: date_type = Form(...),
    amount_total: Decimal = Form(..., gt=0),
    notes: str | None = Form(None),
    photo: UploadFile | None = File(None),
    session: Session = Depends(get_session),
    actor: User = Depends(require_manager_or_admin),
):
    supplier = session.get(Supplier, supplier_id)
    if supplier is None or not supplier.active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Fornitore inesistente o disattivato.")

    # Pre-check uniqueness on (supplier_id, ddt_number).
    dup = session.scalar(
        select(Ddt).where(
            Ddt.supplier_id == supplier_id,
            Ddt.ddt_number == ddt_number.strip(),
        )
    )
    if dup is not None:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "DDT già registrato per questo fornitore.")

    photo_url: str | None = None
    if photo is not None and photo.filename:
        try:
            photo_url = upload_image(photo, "ddts")
        except UploadError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))

    ddt = Ddt(
        supplier_id=supplier_id,
        ddt_number=ddt_number.strip(),
        ddt_date=ddt_date,
        amount_total=amount_total,
        notes=notes,
        photo_url=photo_url,
        created_by_user_id=actor.id,
    )
    session.add(ddt)
    session.commit()
    session.refresh(ddt)
    logger.info("Ddt created: id=%d supplier_id=%d number=%s amount=%s by=%d",
                ddt.id, supplier_id, ddt_number, amount_total, actor.id)
    return _hydrate(ddt, session)


# ---------------------------------------------------------------------
# GET /ddts


@router.get("")
def list_ddts(
    from_date: date_type | None = Query(None, alias="from_date"),
    to_date: date_type | None = Query(None, alias="to_date"),
    supplier_id: int | None = Query(None),
    category: Literal["food", "beverage", "consumo"] | None = Query(None),
    billed: bool | None = Query(None),
    search: str | None = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
    _actor: User = Depends(require_manager_or_admin),
):
    if from_date is None and to_date is None:
        from_date, end_excl = _current_month_range()
        to_date = end_excl

    stmt = select(Ddt).join(Supplier, Ddt.supplier_id == Supplier.id)
    if from_date is not None:
        stmt = stmt.where(Ddt.ddt_date >= from_date)
    if to_date is not None:
        stmt = stmt.where(Ddt.ddt_date < to_date)
    if supplier_id is not None:
        stmt = stmt.where(Ddt.supplier_id == supplier_id)
    if category is not None:
        stmt = stmt.where(Supplier.category == category)
    if billed is not None:
        if billed:
            stmt = stmt.where(Ddt.invoice_id.is_not(None))
        else:
            stmt = stmt.where(Ddt.invoice_id.is_(None))
    if search:
        stmt = stmt.where(Ddt.ddt_number.ilike(f"%{search.strip()}%"))

    stmt = stmt.order_by(Ddt.ddt_date.desc(), Ddt.created_at.desc()).limit(limit).offset(offset)

    return [_hydrate(ddt, session) for ddt in session.scalars(stmt)]


# ---------------------------------------------------------------------
# GET /ddts/summary — non fatturati raggruppati per fornitore.
# Deve stare PRIMA di /{id} per non farsi catturare dalla route dinamica.


@router.get("/summary", response_model=DdtSummaryOut)
def ddts_summary(
    session: Session = Depends(get_session),
    _actor: User = Depends(require_manager_or_admin),
) -> DdtSummaryOut:
    ddts = list(session.scalars(
        select(Ddt).where(Ddt.invoice_id.is_(None)).order_by(Ddt.ddt_date.asc())
    ))
    if not ddts:
        return DdtSummaryOut(total_unbilled=Decimal("0"), count=0, by_supplier=[])

    suppliers_by_id = {
        s.id: s for s in session.scalars(
            select(Supplier).where(Supplier.id.in_({d.supplier_id for d in ddts}))
        )
    }
    groups: dict[int, DdtBySupplierRow] = {}
    total = Decimal("0")
    for d in ddts:
        s = suppliers_by_id.get(d.supplier_id)
        if not s:
            continue
        if s.id not in groups:
            groups[s.id] = DdtBySupplierRow(
                supplier={"id": s.id, "name": s.name,
                          "category": s.category.value if hasattr(s.category, "value") else s.category},
                total=Decimal("0"), count=0, ddts=[],
            )
        groups[s.id].total += d.amount_total
        groups[s.id].count += 1
        groups[s.id].ddts.append(DdtMini(
            id=d.id, ddt_number=d.ddt_number,
            ddt_date=d.ddt_date, amount_total=d.amount_total,
        ))
        total += d.amount_total

    rows = sorted(groups.values(), key=lambda r: r.total, reverse=True)
    return DdtSummaryOut(total_unbilled=total, count=len(ddts), by_supplier=rows)


# ---------------------------------------------------------------------
# POST /ddts/generate-invoice — crea UNA fattura da N DDT non fatturati.


@router.post("/generate-invoice", status_code=status.HTTP_201_CREATED,
             response_model=GenerateInvoiceOut)
def generate_invoice(
    payload: GenerateInvoiceIn,
    session: Session = Depends(get_session),
    actor: User = Depends(require_manager_or_admin),
) -> GenerateInvoiceOut:
    supplier = session.get(Supplier, payload.supplier_id)
    if supplier is None or not supplier.active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Fornitore inesistente o disattivato.")

    wanted = list(dict.fromkeys(payload.ddt_ids))  # dedup, preserva ordine
    ddts = list(session.scalars(select(Ddt).where(Ddt.id.in_(wanted))))
    if len(ddts) != len(wanted):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Uno o più DDT non trovati.")

    for d in ddts:
        if d.supplier_id != payload.supplier_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "Tutti i DDT devono essere dello stesso fornitore selezionato.")
        if d.invoice_id is not None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                f"Il DDT {d.ddt_number} è già fatturato.")

    num = payload.invoice_number.strip()
    dup = session.scalar(
        select(Invoice).where(
            Invoice.supplier_id == payload.supplier_id,
            Invoice.invoice_number == num,
        )
    )
    if dup is not None:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Esiste già una fattura con questo numero per questo fornitore.")

    total = sum((d.amount_total for d in ddts), Decimal("0"))
    notes = payload.notes
    if not notes:
        nums = ", ".join(d.ddt_number for d in ddts)
        notes = f"Generata da {len(ddts)} DDT: {nums}"

    inv = Invoice(
        supplier_id=payload.supplier_id,
        invoice_number=num,
        invoice_date=payload.invoice_date,
        amount_total=total,
        notes=notes,
        created_by_user_id=actor.id,
    )
    session.add(inv)
    session.flush()  # serve inv.id per collegare i DDT
    for d in ddts:
        d.invoice_id = inv.id
    session.commit()
    logger.info("Invoice generated from DDT: invoice_id=%d supplier_id=%d ddt_count=%d total=%s by=%d",
                inv.id, payload.supplier_id, len(ddts), total, actor.id)
    return GenerateInvoiceOut(invoice_id=inv.id, amount_total=total, ddt_count=len(ddts))


# ---------------------------------------------------------------------
# GET /ddts/{id}


@router.get("/{ddt_id}")
def get_ddt(
    ddt_id: int,
    session: Session = Depends(get_session),
    _actor: User = Depends(require_manager_or_admin),
):
    ddt = session.get(Ddt, ddt_id)
    if ddt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "DDT non trovato.")
    return _hydrate(ddt, session)


# ---------------------------------------------------------------------
# PATCH /ddts/{id}


@router.patch("/{ddt_id}")
def update_ddt(
    ddt_id: int,
    payload: DdtUpdate,
    session: Session = Depends(get_session),
    actor: User = Depends(require_manager_or_admin),
):
    ddt = session.get(Ddt, ddt_id)
    if ddt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "DDT non trovato.")

    # DDT fatturato → sola lettura.
    if ddt.invoice_id is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "DDT già fatturato: per modificarlo annulla prima la fattura collegata.")

    is_admin = actor.role == UserRole.admin
    # Il manager può modificare solo DDT del mese corrente.
    if not is_admin:
        first, end_excl = _current_month_range()
        if not (first <= ddt.ddt_date < end_excl):
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                "Il manager può modificare solo DDT del mese corrente.")

    changes = payload.model_dump(exclude_unset=True)

    # Uniqueness check on (supplier_id, ddt_number) if number is changing.
    if "ddt_number" in changes and changes["ddt_number"] is not None:
        new_num = changes["ddt_number"].strip()
        if new_num != ddt.ddt_number:
            dup = session.scalar(
                select(Ddt).where(
                    Ddt.supplier_id == ddt.supplier_id,
                    Ddt.ddt_number == new_num,
                    Ddt.id != ddt.id,
                )
            )
            if dup is not None:
                raise HTTPException(status.HTTP_409_CONFLICT,
                                    "Esiste già un DDT con questo numero per questo fornitore.")
            ddt.ddt_number = new_num
        del changes["ddt_number"]
    for k, v in changes.items():
        setattr(ddt, k, v)
    session.commit()
    session.refresh(ddt)
    logger.info("Ddt updated: id=%d by=%d", ddt.id, actor.id)
    return _hydrate(ddt, session)


# ---------------------------------------------------------------------
# DELETE /ddts/{id} (admin only)


@router.delete("/{ddt_id}")
def delete_ddt(
    ddt_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(require_admin),
) -> dict:
    ddt = session.get(Ddt, ddt_id)
    if ddt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "DDT non trovato.")
    if ddt.invoice_id is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "DDT collegato a una fattura. Annulla prima la fattura associata.")
    session.delete(ddt)
    session.commit()
    logger.info("Ddt deleted: id=%d by_admin=%d", ddt_id, actor.id)
    return {"deleted_id": ddt_id}
