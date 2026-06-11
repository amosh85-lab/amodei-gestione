"""/work-shifts router — ore lavorate per giorno + riepiloghi.

Visibilità:
- Staff: vede SOLO i propri turni (ogni endpoint forza user_id = self).
- Manager: vede tutti i turni e gli aggregati settimanali, ma NESSUN dato
  sul contratto/overtime specifico (solo bandiera is_overtime).
- Admin: vede tutto (contract_hours, overtime_hours, tariffe, payroll).
"""
from __future__ import annotations

import logging
from datetime import date as date_type, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import (
    get_current_user, require_admin, require_manager_or_admin,
)
from app.models.base import ServiceKind
from app.models.users import User, UserRole
from app.models.work_shifts import WorkShift
from app.schemas.users import UserMini
from app.schemas.work_shifts import (
    MonthlyPayrollByUser,
    MonthlyPayrollTotals,
    SettleAdvancesResult,
    WeeklyBreakdownRow,
    WorkShiftBulkCreate,
    WorkShiftCreate,
    WorkShiftDailySummary,
    WorkShiftMonthlyPayrollSummary,
    WorkShiftOut,
    WorkShiftUpdate,
    WorkShiftWeeklySummary,
    _UserMiniWithRate,
)
from app.services.payroll import (
    calculate_monthly_payroll,
    calculate_user_weekly_summary,
    get_users_without_shift,
    get_week_bounds,
    settle_advances_for_month,
)

router = APIRouter(prefix="/work-shifts", tags=["work-shifts"])
logger = logging.getLogger("amodei.work_shifts")

ALLOWED_ROLES = (UserRole.staff, UserRole.manager)


def _hydrate(ws: WorkShift, session: Session) -> WorkShiftOut:
    user = session.get(User, ws.user_id)
    created_by = session.get(User, ws.created_by_user_id)
    return WorkShiftOut(
        id=ws.id, date=ws.date, user=user,
        service=ws.service.value if hasattr(ws.service, "value") else ws.service,
        start_time=ws.start_time,
        hours=ws.hours, notes=ws.notes, created_by=created_by,
        created_at=ws.created_at, updated_at=ws.updated_at,
    )


def _validate_target_user(session: Session, user_id: int) -> User:
    target = session.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dipendente non trovato.")
    if target.role not in ALLOWED_ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Turni consentiti solo per staff e manager.")
    if not target.active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Il dipendente è disattivato.")
    return target


# ---------------------------------------------------------------------
# POST / — singolo turno


@router.post("", response_model=WorkShiftOut, status_code=status.HTTP_201_CREATED)
def create_shift(
    payload: WorkShiftCreate,
    session: Session = Depends(get_session),
    actor: User = Depends(require_manager_or_admin),
) -> WorkShiftOut:
    _validate_target_user(session, payload.user_id)
    service_enum = ServiceKind(payload.service)
    # Unicità (date, user_id, service)
    existing = session.scalar(
        select(WorkShift)
        .where(WorkShift.date == payload.date)
        .where(WorkShift.user_id == payload.user_id)
        .where(WorkShift.service == service_enum)
    )
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"Esiste già un turno {payload.service} per questo dipendente il {payload.date}. Usa PATCH per modificarlo.")
    ws = WorkShift(
        date=payload.date, user_id=payload.user_id,
        service=service_enum, start_time=payload.start_time,
        hours=payload.hours, notes=payload.notes,
        created_by_user_id=actor.id,
    )
    session.add(ws)
    session.commit()
    session.refresh(ws)
    logger.info("Shift created: id=%d date=%s user=%d service=%s start=%s hours=%s by=%d",
                ws.id, ws.date, ws.user_id, payload.service, ws.start_time, ws.hours, actor.id)
    return _hydrate(ws, session)


# ---------------------------------------------------------------------
# POST /bulk — upsert giornaliero


@router.post("/bulk", response_model=list[WorkShiftOut])
def bulk_upsert_shifts(
    payload: WorkShiftBulkCreate,
    session: Session = Depends(get_session),
    actor: User = Depends(require_manager_or_admin),
) -> list[WorkShiftOut]:
    # Pre-valida tutti i target user (lo stesso user_id può comparire più volte
    # con service diversi: lunch + dinner).
    target_ids = list({item.user_id for item in payload.shifts})
    for uid in target_ids:
        _validate_target_user(session, uid)

    # Chiave esistente: (user_id, service)
    existing = {
        (ws.user_id, ws.service): ws for ws in session.scalars(
            select(WorkShift)
            .where(WorkShift.date == payload.date)
            .where(WorkShift.user_id.in_(target_ids))
        )
    }
    results: list[WorkShift] = []
    for item in payload.shifts:
        service_enum = ServiceKind(item.service)
        ws = existing.get((item.user_id, service_enum))
        if ws is None:
            ws = WorkShift(
                date=payload.date, user_id=item.user_id,
                service=service_enum, start_time=item.start_time,
                hours=item.hours, notes=item.notes,
                created_by_user_id=actor.id,
            )
            session.add(ws)
        else:
            ws.start_time = item.start_time
            ws.hours = item.hours
            ws.notes = item.notes
        results.append(ws)
    session.commit()
    for ws in results:
        session.refresh(ws)
    logger.info("Shifts bulk-upsert: date=%s count=%d by=%d",
                payload.date, len(results), actor.id)
    return [_hydrate(ws, session) for ws in results]


# ---------------------------------------------------------------------
# GET / — list con role-based filter


@router.get("", response_model=list[WorkShiftOut])
def list_shifts(
    from_date: date_type | None = Query(None, alias="from_date"),
    to_date: date_type | None = Query(None, alias="to_date"),
    user_id: int | None = Query(None),
    session: Session = Depends(get_session),
    actor: User = Depends(get_current_user),
) -> list[WorkShiftOut]:
    # Default: settimana corrente
    if from_date is None and to_date is None:
        monday, sunday = get_week_bounds(date_type.today())
        from_date, to_date = monday, sunday

    # Staff: forza user_id = self (ignora qualsiasi user_id passato)
    if actor.role == UserRole.staff:
        user_id = actor.id

    stmt = select(WorkShift)
    if from_date is not None:
        stmt = stmt.where(WorkShift.date >= from_date)
    if to_date is not None:
        stmt = stmt.where(WorkShift.date <= to_date)
    if user_id is not None:
        stmt = stmt.where(WorkShift.user_id == user_id)
    stmt = stmt.order_by(WorkShift.date.desc(), WorkShift.user_id.asc())

    shifts = list(session.scalars(stmt))
    return [_hydrate(ws, session) for ws in shifts]


# ---------------------------------------------------------------------
# GET /by-date/{date} — daily summary + utenti senza turno


@router.get("/by-date/{day}", response_model=WorkShiftDailySummary)
def shifts_by_date(
    day: date_type,
    session: Session = Depends(get_session),
    _actor: User = Depends(require_manager_or_admin),
) -> WorkShiftDailySummary:
    shifts = list(session.scalars(
        select(WorkShift).where(WorkShift.date == day).order_by(WorkShift.user_id)
    ))
    total = sum((ws.hours for ws in shifts), Decimal("0"))
    missing = get_users_without_shift(session, day)
    return WorkShiftDailySummary(
        date=day,
        total_hours=total,
        shifts=[_hydrate(ws, session) for ws in shifts],
        users_without_shift=[UserMini.model_validate(u) for u in missing],
    )


# ---------------------------------------------------------------------
# GET /weekly-summary — role-aware shape


@router.get("/weekly-summary", response_model=list[WorkShiftWeeklySummary])
def weekly_summary(
    week_start: date_type | None = Query(None),
    user_id: int | None = Query(None),
    session: Session = Depends(get_session),
    actor: User = Depends(get_current_user),
) -> list[WorkShiftWeeklySummary]:
    """Riepilogo settimanale.
    - Staff: solo proprio.
    - Manager: tutti, ma contract_hours/overtime_hours NASCOSTI (solo is_overtime).
    - Admin: tutto.
    """
    monday, sunday = get_week_bounds(week_start or date_type.today())

    # Restrizione visibilità: staff forza self
    if actor.role == UserRole.staff:
        target_ids = [actor.id]
    else:
        if user_id is not None:
            target_ids = [user_id]
        else:
            target_ids = [u.id for u in session.scalars(
                select(User)
                .where(User.role.in_([UserRole.staff, UserRole.manager]))
                .where(User.active.is_(True))
            )]

    out: list[WorkShiftWeeklySummary] = []
    for uid in target_ids:
        s = calculate_user_weekly_summary(session, uid, monday)
        if s["user"] is None:
            continue
        out.append(WorkShiftWeeklySummary(
            week_start=s["week_start"], week_end=s["week_end"],
            user=s["user"], total_hours=s["total_hours"],
            # MANAGER non vede contract_hours/overtime_hours specifici.
            contract_hours=s["contract_hours"] if actor.role == UserRole.admin else None,
            overtime_hours=s["overtime_hours"] if actor.role == UserRole.admin else None,
            is_overtime=s["is_overtime"],
        ))
    return out


# ---------------------------------------------------------------------
# GET /monthly-payroll — admin only


@router.get("/monthly-payroll", response_model=WorkShiftMonthlyPayrollSummary)
def monthly_payroll(
    year: int | None = Query(None, ge=2024, le=2100),
    month: int | None = Query(None, ge=1, le=12),
    session: Session = Depends(get_session),
    _actor: User = Depends(require_admin),
) -> WorkShiftMonthlyPayrollSummary:
    today = date_type.today()
    data = calculate_monthly_payroll(session, year or today.year, month or today.month)
    return WorkShiftMonthlyPayrollSummary(
        year=data["year"], month=data["month"], month_label=data["month_label"],
        by_user=[MonthlyPayrollByUser(
            user=_UserMiniWithRate(
                id=row["user"].id, email=row["user"].email,
                full_name=row["user"].full_name,
                role=row["user"].role.value if hasattr(row["user"].role, "value") else row["user"].role,
                active=row["user"].active,
                pay_type=row["user"].pay_type.value if hasattr(row["user"].pay_type, "value") else row["user"].pay_type,
                hourly_rate=row["user"].hourly_rate,
                monthly_salary=row["user"].monthly_salary,
                weekly_hours_contract=row["user"].weekly_hours_contract,
            ),
            total_hours=row["total_hours"],
            gross_amount=row["gross_amount"],
            tips_total=row["tips_total"],
            advances_taken=row["advances_taken"],
            advances_cash=row["advances_cash"],
            advances_bonifico=row["advances_bonifico"],
            advances_settled_in_month=row["advances_settled_in_month"],
            net_to_pay=row["net_to_pay"],
            has_unsettled_advances=row["has_unsettled_advances"],
            needs_configuration=row["needs_configuration"],
            weekly_breakdown=[WeeklyBreakdownRow(**wk) for wk in row["weekly_breakdown"]],
        ) for row in data["by_user"]],
        totals=MonthlyPayrollTotals(**data["totals"]),
    )


# ---------------------------------------------------------------------
# POST /monthly-payroll/{user_id}/settle-advances — admin only


@router.post("/monthly-payroll/{user_id}/settle-advances", response_model=SettleAdvancesResult)
def settle_user_advances(
    user_id: int,
    year: int = Query(..., ge=2024, le=2100),
    month: int = Query(..., ge=1, le=12),
    session: Session = Depends(get_session),
    actor: User = Depends(require_admin),
) -> SettleAdvancesResult:
    target = session.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dipendente non trovato.")
    result = settle_advances_for_month(session, user_id, year, month, actor.id)
    logger.info("Payroll settle: user_id=%d payroll=%04d-%02d settled_count=%d by_admin=%d",
                user_id, year, month, result["settled_count"], actor.id)
    return SettleAdvancesResult(**result)


# ---------------------------------------------------------------------
# GET /{id} — single (con restrizione staff)


@router.get("/{shift_id}", response_model=WorkShiftOut)
def get_shift(
    shift_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(get_current_user),
) -> WorkShiftOut:
    ws = session.get(WorkShift, shift_id)
    if ws is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Turno non trovato.")
    if actor.role == UserRole.staff and ws.user_id != actor.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Puoi vedere solo i tuoi turni.")
    return _hydrate(ws, session)


# ---------------------------------------------------------------------
# PATCH /{id}


@router.patch("/{shift_id}", response_model=WorkShiftOut)
def update_shift(
    shift_id: int,
    payload: WorkShiftUpdate,
    session: Session = Depends(get_session),
    actor: User = Depends(require_manager_or_admin),
) -> WorkShiftOut:
    ws = session.get(WorkShift, shift_id)
    if ws is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Turno non trovato.")
    # Manager: solo turni delle ultime 7 giornate; admin sempre.
    if actor.role != UserRole.admin:
        today = date_type.today()
        if ws.date < today - timedelta(days=7) or ws.date > today:
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                "Il manager può modificare turni degli ultimi 7 giorni.")
    changes = payload.model_dump(exclude_unset=True)
    if "start_time" in changes and changes["start_time"] is not None:
        ws.start_time = changes["start_time"]
    if "hours" in changes and changes["hours"] is not None:
        ws.hours = changes["hours"]
    if "notes" in changes:
        ws.notes = changes["notes"]
    session.commit()
    session.refresh(ws)
    logger.info("Shift updated: id=%d by=%d", ws.id, actor.id)
    return _hydrate(ws, session)


# ---------------------------------------------------------------------
# DELETE /{id}


@router.delete("/{shift_id}")
def delete_shift(
    shift_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(require_manager_or_admin),
) -> dict:
    ws = session.get(WorkShift, shift_id)
    if ws is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Turno non trovato.")
    if actor.role != UserRole.admin:
        today = date_type.today()
        if ws.date != today:
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                "Il manager può eliminare solo turni di oggi.")
    session.delete(ws)
    session.commit()
    logger.info("Shift deleted: id=%d by=%d", shift_id, actor.id)
    return {"deleted_id": shift_id}
