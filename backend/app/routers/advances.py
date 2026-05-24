"""/advances router: employee cash advances + settlement workflow.

Access rules:
- read / create / update unsettled: manager + admin
- mark settled / unsettle / delete: admin only
- staff: 403 on every endpoint (these are sensitive payroll-adjacent data)

Concept reminder:
- `date` = when the advance left the drawer
- `reference_month` (YYYY-MM) = which payroll the advance belongs to
  (es. 3 giugno do 100€ a Marco per la busta di MAGGIO → date=2026-06-03,
   reference_month="2026-05"). Default basato su `date`:
   - day <= 10 → mese precedente
   - else → mese corrente
"""
from __future__ import annotations

import logging
from datetime import date as date_type, datetime, timezone
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
from app.models.cash import EmployeeAdvance
from app.models.users import User, UserRole
from app.schemas.advances import (
    AdvanceSettleRequest,
    AdvanceSettleResult,
    AdvancesByEmployeeResponse,
    AdvancesByReferenceMonth,
    AdvancesByUserMonthly,
    AdvancesMonthlySummary,
    EmployeeAdvanceCreate,
    EmployeeAdvanceOut,
    EmployeeAdvanceUpdate,
    REFERENCE_MONTH_PATTERN,
    _UserAdvanceGroup,
)
from app.services.storage import UploadError, upload_image

router = APIRouter(prefix="/advances", tags=["advances"])
logger = logging.getLogger("amodei.advances")


ALLOWED_ROLES = (UserRole.staff, UserRole.manager)

MONTH_LABELS_IT = [
    "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
    "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
]


def _month_label(reference_month: str) -> str:
    """Convert 'YYYY-MM' → 'Maggio 2026' (per i frontend, evitando rework)."""
    try:
        y, m = reference_month.split("-")
        return f"{MONTH_LABELS_IT[int(m) - 1]} {y}"
    except (ValueError, IndexError):
        return reference_month


def _default_reference_month(d: date_type) -> str:
    """Default smart in base alla data:
    - day <= 10 → mese precedente
    - else → mese corrente"""
    if d.day <= 10:
        if d.month == 1:
            return f"{d.year - 1:04d}-12"
        return f"{d.year:04d}-{d.month - 1:02d}"
    return f"{d.year:04d}-{d.month:02d}"


def _hydrate(advance: EmployeeAdvance, session: Session) -> EmployeeAdvanceOut:
    """Build the EmployeeAdvanceOut by loading the related users."""
    user = session.get(User, advance.user_id)
    created_by = session.get(User, advance.created_by_user_id)
    settled_by = session.get(User, advance.settled_by_user_id) if advance.settled_by_user_id else None
    return EmployeeAdvanceOut(
        id=advance.id,
        date=advance.date,
        service=advance.service.value if hasattr(advance.service, "value") else advance.service,
        user=user,
        amount=advance.amount,
        notes=advance.notes,
        receipt_photo_url=advance.receipt_photo_url,
        created_by=created_by,
        created_at=advance.created_at,
        reference_month=advance.reference_month,
        reference_month_label=_month_label(advance.reference_month),
        settled_at=advance.settled_at,
        settled_in_payroll_month=advance.settled_in_payroll_month,
        settled_by=settled_by,
    )


# ---------------------------------------------------------------------
# POST / — create


@router.post("", response_model=EmployeeAdvanceOut, status_code=status.HTTP_201_CREATED)
def create_advance(
    user_id: int = Form(..., gt=0),
    amount: Decimal = Form(..., gt=0),
    service: Literal["lunch", "dinner"] = Form(...),
    date: date_type | None = Form(None),
    notes: str | None = Form(None),
    reference_month: str | None = Form(None, pattern=REFERENCE_MONTH_PATTERN,
                                         description="YYYY-MM. Se omesso → default da date."),
    receipt_photo: UploadFile | None = File(None),
    session: Session = Depends(get_session),
    actor: User = Depends(require_manager_or_admin),
) -> EmployeeAdvanceOut:
    target = session.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dipendente non trovato.")
    if target.role not in ALLOWED_ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Acconti consentiti solo per staff e manager.")
    if not target.active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Il dipendente è disattivato.")

    photo_url: str | None = None
    if receipt_photo is not None and receipt_photo.filename:
        try:
            photo_url = upload_image(receipt_photo, "advances")
        except UploadError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))

    eff_date = date or date_type.today()
    eff_ref_month = reference_month or _default_reference_month(eff_date)

    adv = EmployeeAdvance(
        date=eff_date,
        service=service,
        user_id=user_id,
        amount=amount,
        notes=notes,
        receipt_photo_url=photo_url,
        created_by_user_id=actor.id,
        reference_month=eff_ref_month,
    )
    session.add(adv)
    session.commit()
    session.refresh(adv)
    logger.info("Advance created: id=%d user_id=%d amount=%s ref_month=%s by=%d",
                adv.id, adv.user_id, adv.amount, adv.reference_month, actor.id)
    return _hydrate(adv, session)


# ---------------------------------------------------------------------
# GET / — list with filters


@router.get("", response_model=list[EmployeeAdvanceOut])
def list_advances(
    from_date: date_type | None = Query(None, alias="from_date"),
    to_date: date_type | None = Query(None, alias="to_date"),
    user_id: int | None = Query(None),
    settled: bool | None = Query(None),
    payroll_month: str | None = Query(None, pattern=REFERENCE_MONTH_PATTERN),
    reference_month: str | None = Query(None, pattern=REFERENCE_MONTH_PATTERN),
    service: Literal["lunch", "dinner"] | None = Query(None),
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> list[EmployeeAdvanceOut]:
    if from_date is None and to_date is None and reference_month is None:
        today = date_type.today()
        from_date = today.replace(day=1)

    stmt = select(EmployeeAdvance)
    if from_date is not None:
        stmt = stmt.where(EmployeeAdvance.date >= from_date)
    if to_date is not None:
        stmt = stmt.where(EmployeeAdvance.date <= to_date)
    if user_id is not None:
        stmt = stmt.where(EmployeeAdvance.user_id == user_id)
    if settled is True:
        stmt = stmt.where(EmployeeAdvance.settled_at.isnot(None))
    elif settled is False:
        stmt = stmt.where(EmployeeAdvance.settled_at.is_(None))
    if payroll_month is not None:
        stmt = stmt.where(EmployeeAdvance.settled_in_payroll_month == payroll_month)
    if reference_month is not None:
        stmt = stmt.where(EmployeeAdvance.reference_month == reference_month)
    if service is not None:
        stmt = stmt.where(EmployeeAdvance.service == service)
    stmt = stmt.order_by(EmployeeAdvance.date.desc(), EmployeeAdvance.created_at.desc())

    return [_hydrate(a, session) for a in session.scalars(stmt)]


# ---------------------------------------------------------------------
# GET /by-employee — primary grouping by reference_month → then by user


@router.get("/by-employee", response_model=AdvancesByEmployeeResponse)
def advances_by_employee(
    settled: bool | None = Query(False, description="Default false (unsettled)"),
    reference_month: str | None = Query(None, pattern=REFERENCE_MONTH_PATTERN),
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> AdvancesByEmployeeResponse:
    stmt = select(EmployeeAdvance)
    if settled is True:
        stmt = stmt.where(EmployeeAdvance.settled_at.isnot(None))
    elif settled is False:
        stmt = stmt.where(EmployeeAdvance.settled_at.is_(None))
    if reference_month is not None:
        stmt = stmt.where(EmployeeAdvance.reference_month == reference_month)
    # Order: oldest reference_month first so admin pays "older" payroll first.
    stmt = stmt.order_by(
        EmployeeAdvance.reference_month.asc(),
        EmployeeAdvance.user_id,
        EmployeeAdvance.date.desc(),
    )

    advances = list(session.scalars(stmt))

    # Primary group: reference_month → user_id → list[EmployeeAdvanceOut]
    by_ref: dict[str, dict] = {}
    for adv in advances:
        hydrated = _hydrate(adv, session)
        rm = adv.reference_month
        if rm not in by_ref:
            by_ref[rm] = {"reference_month": rm, "label": _month_label(rm),
                          "total_amount": Decimal("0"), "by_user": {}}
        bucket = by_ref[rm]
        bucket["total_amount"] += hydrated.amount
        ug = bucket["by_user"].setdefault(adv.user_id, {
            "user": hydrated.user, "total_amount": Decimal("0"),
            "count": 0, "advances": [],
        })
        ug["total_amount"] += hydrated.amount
        ug["count"] += 1
        ug["advances"].append(hydrated)

    out_groups: list[AdvancesByReferenceMonth] = []
    for rm in sorted(by_ref.keys()):
        bucket = by_ref[rm]
        users_sorted = sorted(bucket["by_user"].values(),
                              key=lambda u: u["total_amount"], reverse=True)
        out_groups.append(AdvancesByReferenceMonth(
            reference_month=bucket["reference_month"],
            label=bucket["label"],
            total_amount=bucket["total_amount"],
            by_user=[_UserAdvanceGroup(**u) for u in users_sorted],
        ))
    return AdvancesByEmployeeResponse(by_reference_month=out_groups)


# ---------------------------------------------------------------------
# GET /summary/monthly — for_month vs given_in_month + settled


@router.get("/summary/monthly", response_model=AdvancesMonthlySummary)
def monthly_summary(
    year: int | None = Query(None, ge=2024, le=2100),
    month: int | None = Query(None, ge=1, le=12),
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> AdvancesMonthlySummary:
    today = date_type.today()
    y = year or today.year
    m = month or today.month
    ref_str = f"{y:04d}-{m:02d}"

    # 1) FOR_MONTH: advances WITH reference_month = X (regardless of when given)
    for_month = session.scalar(
        select(func.coalesce(func.sum(EmployeeAdvance.amount), 0))
        .where(EmployeeAdvance.reference_month == ref_str)
    ) or Decimal("0")

    # 2) GIVEN_IN_MONTH: advances whose .date falls in the month
    next_m_first = date_type(y if m < 12 else y + 1, (m % 12) + 1, 1)
    month_first = date_type(y, m, 1)
    given = session.scalar(
        select(func.coalesce(func.sum(EmployeeAdvance.amount), 0))
        .where(EmployeeAdvance.date >= month_first)
        .where(EmployeeAdvance.date < next_m_first)
    ) or Decimal("0")

    # 3) SETTLED: with this payroll_month tag (regardless of original date/ref)
    settled = session.scalar(
        select(func.coalesce(func.sum(EmployeeAdvance.amount), 0))
        .where(EmployeeAdvance.settled_in_payroll_month == ref_str)
    ) or Decimal("0")

    # 4) UNSETTLED total (as-of now)
    unsettled = session.scalar(
        select(func.coalesce(func.sum(EmployeeAdvance.amount), 0))
        .where(EmployeeAdvance.settled_at.is_(None))
    ) or Decimal("0")

    # Per-user breakdown: users with any relevance to this month
    user_ids = set(session.scalars(
        select(EmployeeAdvance.user_id).where(
            and_(
                (EmployeeAdvance.reference_month == ref_str)
                | ((EmployeeAdvance.date >= month_first) & (EmployeeAdvance.date < next_m_first))
                | (EmployeeAdvance.settled_in_payroll_month == ref_str)
                | (EmployeeAdvance.settled_at.is_(None))
            )
        )
    ).all())
    users_by_id = {u.id: u for u in session.scalars(select(User).where(User.id.in_(user_ids)))} if user_ids else {}

    by_user: list[AdvancesByUserMonthly] = []
    for uid in user_ids:
        u = users_by_id.get(uid)
        if not u:
            continue
        gv = session.scalar(
            select(func.coalesce(func.sum(EmployeeAdvance.amount), 0))
            .where(EmployeeAdvance.user_id == uid)
            .where(EmployeeAdvance.date >= month_first)
            .where(EmployeeAdvance.date < next_m_first)
        ) or Decimal("0")
        fm = session.scalar(
            select(func.coalesce(func.sum(EmployeeAdvance.amount), 0))
            .where(EmployeeAdvance.user_id == uid)
            .where(EmployeeAdvance.reference_month == ref_str)
        ) or Decimal("0")
        sm = session.scalar(
            select(func.coalesce(func.sum(EmployeeAdvance.amount), 0))
            .where(EmployeeAdvance.user_id == uid)
            .where(EmployeeAdvance.settled_in_payroll_month == ref_str)
        ) or Decimal("0")
        un = session.scalar(
            select(func.coalesce(func.sum(EmployeeAdvance.amount), 0))
            .where(EmployeeAdvance.user_id == uid)
            .where(EmployeeAdvance.settled_at.is_(None))
        ) or Decimal("0")
        by_user.append(AdvancesByUserMonthly(
            user=u, given_in_month=gv, for_month=fm,
            settled_in_month=sm, unsettled_total=un,
        ))

    by_user.sort(key=lambda r: r.unsettled_total, reverse=True)
    return AdvancesMonthlySummary(
        year=y, month=m,
        total_amount_for_month=for_month,
        total_amount_given_in_month=given,
        total_amount_settled=settled,
        unsettled_total=unsettled,
        by_user=by_user,
    )


# ---------------------------------------------------------------------
# GET /{id} — single


@router.get("/{advance_id}", response_model=EmployeeAdvanceOut)
def get_advance(
    advance_id: int,
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> EmployeeAdvanceOut:
    adv = session.get(EmployeeAdvance, advance_id)
    if adv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Acconto non trovato.")
    return _hydrate(adv, session)


# ---------------------------------------------------------------------
# PATCH /{id} — update amount/notes/reference_month


@router.patch("/{advance_id}", response_model=EmployeeAdvanceOut)
def update_advance(
    advance_id: int,
    payload: EmployeeAdvanceUpdate,
    session: Session = Depends(get_session),
    actor: User = Depends(require_manager_or_admin),
) -> EmployeeAdvanceOut:
    adv = session.get(EmployeeAdvance, advance_id)
    if adv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Acconto non trovato.")
    is_admin = actor.role == UserRole.admin

    changes = payload.model_dump(exclude_unset=True)

    # reference_month: manager non può modificarlo mai (post-create).
    # Admin può sempre, anche su settled.
    if "reference_month" in changes and changes["reference_month"] is not None:
        if not is_admin:
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                "Solo l'admin può modificare il mese di riferimento.")
        adv.reference_month = changes["reference_month"]
        del changes["reference_month"]
        logger.info("Advance reference_month changed: id=%d new=%s by_admin=%d",
                    adv.id, adv.reference_month, actor.id)

    # Per amount/notes vale la vecchia regola: solo se non settled,
    # e manager solo nello stesso giorno.
    if "amount" in changes or "notes" in changes:
        if adv.settled_at is not None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "Acconto già saldato. Annulla il saldo per modificare importo/note.")
        if not is_admin and adv.date != date_type.today():
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                "Il manager può modificare importo/note solo degli acconti di oggi.")

    if "amount" in changes and changes["amount"] is not None:
        adv.amount = changes["amount"]
    if "notes" in changes:
        adv.notes = changes["notes"]

    session.commit()
    session.refresh(adv)
    logger.info("Advance updated: id=%d by=%d", adv.id, actor.id)
    return _hydrate(adv, session)


# ---------------------------------------------------------------------
# DELETE /{id} — admin only, only if not settled


@router.delete("/{advance_id}")
def delete_advance(
    advance_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(require_admin),
) -> dict:
    adv = session.get(EmployeeAdvance, advance_id)
    if adv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Acconto non trovato.")
    if adv.settled_at is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Acconto già saldato. Annulla il saldo per eliminarlo.")
    session.delete(adv)
    session.commit()
    logger.info("Advance deleted: id=%d by_admin=%d", advance_id, actor.id)
    return {"deleted_id": advance_id}


# ---------------------------------------------------------------------
# POST /settle


@router.post("/settle", response_model=AdvanceSettleResult)
def settle_advances(
    payload: AdvanceSettleRequest,
    session: Session = Depends(get_session),
    actor: User = Depends(require_admin),
) -> AdvanceSettleResult:
    advances = list(session.scalars(
        select(EmployeeAdvance).where(EmployeeAdvance.id.in_(payload.advance_ids))
    ))
    found_ids = {a.id for a in advances}
    missing = set(payload.advance_ids) - found_ids
    if missing:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            f"Acconti non trovati: {sorted(missing)}")
    now = datetime.now(timezone.utc)
    settled_count = 0
    skipped_count = 0
    for adv in advances:
        if adv.settled_at is not None:
            skipped_count += 1
            continue
        adv.settled_at = now
        adv.settled_in_payroll_month = payload.payroll_month
        adv.settled_by_user_id = actor.id
        settled_count += 1
    session.commit()
    logger.info("Advances settled: count=%d skipped=%d payroll=%s by_admin=%d",
                settled_count, skipped_count, payload.payroll_month, actor.id)
    return AdvanceSettleResult(settled_count=settled_count, skipped_count=skipped_count)


# ---------------------------------------------------------------------
# POST /{id}/unsettle


@router.post("/{advance_id}/unsettle", response_model=EmployeeAdvanceOut)
def unsettle_advance(
    advance_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(require_admin),
) -> EmployeeAdvanceOut:
    adv = session.get(EmployeeAdvance, advance_id)
    if adv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Acconto non trovato.")
    if adv.settled_at is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Acconto non era saldato.")
    adv.settled_at = None
    adv.settled_in_payroll_month = None
    adv.settled_by_user_id = None
    session.commit()
    session.refresh(adv)
    logger.info("Advance unsettled: id=%d by_admin=%d", adv.id, actor.id)
    return _hydrate(adv, session)
