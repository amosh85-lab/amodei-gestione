"""/advances router: employee cash advances + settlement workflow.

Access rules:
- read / create / update unsettled: manager + admin
- mark settled / unsettle / delete: admin only
- staff: 403 on every endpoint (these are sensitive payroll-adjacent data)
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
from sqlalchemy.orm import Session, joinedload

from app.database import get_session
from app.dependencies.auth import require_admin, require_manager_or_admin
from app.models.cash import EmployeeAdvance
from app.models.users import User, UserRole
from app.schemas.advances import (
    AdvanceSettleRequest,
    AdvanceSettleResult,
    AdvancesByEmployeeRow,
    AdvancesByUserMonthly,
    AdvancesMonthlySummary,
    EmployeeAdvanceCreate,
    EmployeeAdvanceOut,
    EmployeeAdvanceUpdate,
)
from app.services.storage import UploadError, upload_image

router = APIRouter(prefix="/advances", tags=["advances"])
logger = logging.getLogger("amodei.advances")


ALLOWED_ROLES = (UserRole.staff, UserRole.manager)


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
    receipt_photo: UploadFile | None = File(None),
    session: Session = Depends(get_session),
    actor: User = Depends(require_manager_or_admin),
) -> EmployeeAdvanceOut:
    # Validate beneficiary role: only staff and manager (no admin).
    target = session.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dipendente non trovato.")
    if target.role not in ALLOWED_ROLES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Acconti consentiti solo per staff e manager.",
        )
    if not target.active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Il dipendente è disattivato.")

    photo_url: str | None = None
    if receipt_photo is not None and receipt_photo.filename:
        try:
            photo_url = upload_image(receipt_photo, "advances")
        except UploadError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))

    adv = EmployeeAdvance(
        date=date or date_type.today(),
        service=service,
        user_id=user_id,
        amount=amount,
        notes=notes,
        receipt_photo_url=photo_url,
        created_by_user_id=actor.id,
    )
    session.add(adv)
    session.commit()
    session.refresh(adv)
    logger.info("Advance created: id=%d user_id=%d amount=%s by=%d",
                adv.id, adv.user_id, adv.amount, actor.id)
    return _hydrate(adv, session)


# ---------------------------------------------------------------------
# GET / — list with filters


@router.get("", response_model=list[EmployeeAdvanceOut])
def list_advances(
    from_date: date_type | None = Query(None, alias="from_date"),
    to_date: date_type | None = Query(None, alias="to_date"),
    user_id: int | None = Query(None),
    settled: bool | None = Query(None),
    payroll_month: str | None = Query(None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    service: Literal["lunch", "dinner"] | None = Query(None),
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> list[EmployeeAdvanceOut]:
    # Default window: current month if no date filters provided
    if from_date is None and to_date is None:
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
    if service is not None:
        stmt = stmt.where(EmployeeAdvance.service == service)
    stmt = stmt.order_by(EmployeeAdvance.date.desc(), EmployeeAdvance.created_at.desc())

    return [_hydrate(a, session) for a in session.scalars(stmt)]


# ---------------------------------------------------------------------
# GET /by-employee — grouped


@router.get("/by-employee", response_model=list[AdvancesByEmployeeRow])
def advances_by_employee(
    settled: bool | None = Query(False, description="Default false (unsettled)"),
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> list[AdvancesByEmployeeRow]:
    stmt = select(EmployeeAdvance)
    if settled is True:
        stmt = stmt.where(EmployeeAdvance.settled_at.isnot(None))
    elif settled is False:
        stmt = stmt.where(EmployeeAdvance.settled_at.is_(None))
    stmt = stmt.order_by(EmployeeAdvance.user_id, EmployeeAdvance.date.desc())

    advances = list(session.scalars(stmt))
    rows: dict[int, AdvancesByEmployeeRow] = {}
    for adv in advances:
        hydrated = _hydrate(adv, session)
        if adv.user_id not in rows:
            rows[adv.user_id] = AdvancesByEmployeeRow(
                user=hydrated.user, total_amount=Decimal("0"), count=0, advances=[],
            )
        rows[adv.user_id].total_amount += hydrated.amount
        rows[adv.user_id].count += 1
        rows[adv.user_id].advances.append(hydrated)

    return sorted(rows.values(), key=lambda r: r.total_amount, reverse=True)


# ---------------------------------------------------------------------
# GET /summary/monthly


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
    payroll_str = f"{y:04d}-{m:02d}"

    # given in month = advances with .date in that month
    next_m_first = date_type(y if m < 12 else y + 1, (m % 12) + 1, 1)
    month_first = date_type(y, m, 1)
    given = session.scalar(
        select(func.coalesce(func.sum(EmployeeAdvance.amount), 0))
        .where(EmployeeAdvance.date >= month_first)
        .where(EmployeeAdvance.date < next_m_first)
    ) or Decimal("0")

    # settled in month = advances settled with this payroll_month tag (regardless of original date)
    settled = session.scalar(
        select(func.coalesce(func.sum(EmployeeAdvance.amount), 0))
        .where(EmployeeAdvance.settled_in_payroll_month == payroll_str)
    ) or Decimal("0")

    # unsettled total (overall, as-of now)
    unsettled = session.scalar(
        select(func.coalesce(func.sum(EmployeeAdvance.amount), 0))
        .where(EmployeeAdvance.settled_at.is_(None))
    ) or Decimal("0")

    # per-user breakdown
    user_ids = set(session.scalars(
        select(EmployeeAdvance.user_id)
        .where(
            and_(
                (EmployeeAdvance.date >= month_first) & (EmployeeAdvance.date < next_m_first)
                | (EmployeeAdvance.settled_in_payroll_month == payroll_str)
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
        g = session.scalar(
            select(func.coalesce(func.sum(EmployeeAdvance.amount), 0))
            .where(EmployeeAdvance.user_id == uid)
            .where(EmployeeAdvance.date >= month_first)
            .where(EmployeeAdvance.date < next_m_first)
        ) or Decimal("0")
        s = session.scalar(
            select(func.coalesce(func.sum(EmployeeAdvance.amount), 0))
            .where(EmployeeAdvance.user_id == uid)
            .where(EmployeeAdvance.settled_in_payroll_month == payroll_str)
        ) or Decimal("0")
        un = session.scalar(
            select(func.coalesce(func.sum(EmployeeAdvance.amount), 0))
            .where(EmployeeAdvance.user_id == uid)
            .where(EmployeeAdvance.settled_at.is_(None))
        ) or Decimal("0")
        by_user.append(AdvancesByUserMonthly(
            user=u, given_in_month=g, settled_in_month=s, unsettled_total=un,
        ))

    by_user.sort(key=lambda r: r.unsettled_total, reverse=True)
    return AdvancesMonthlySummary(
        year=y, month=m,
        total_amount_given=given,
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
# PATCH /{id} — update amount/notes (only if not settled)


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
    if adv.settled_at is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Acconto già saldato. Annulla il saldo per modificarlo.")
    # Manager can only edit advances created today; admin always.
    if actor.role != UserRole.admin and adv.date != date_type.today():
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Il manager può modificare solo gli acconti di oggi.")
    changes = payload.model_dump(exclude_unset=True)
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
# POST /settle — bulk mark settled


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
# POST /{id}/unsettle — admin only


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
