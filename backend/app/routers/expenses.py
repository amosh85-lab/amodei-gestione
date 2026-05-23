"""/expenses router: cash expenses with optional receipt photo (multipart)."""
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
from app.dependencies.auth import require_manager_or_admin
from app.models.base import ServiceKind
from app.models.cash import Expense, ExpenseCategory
from app.models.users import User, UserRole
from app.schemas.cash import ExpenseOut, ExpenseUpdate, _CategoryMini
from app.services.storage import UploadError, upload_image

router = APIRouter(prefix="/expenses", tags=["expenses"])
logger = logging.getLogger("amodei.expenses")


def _check_can_modify(expense: Expense, user: User) -> None:
    if expense.date != date_type.today() and user.role != UserRole.admin:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Solo un admin può modificare le spese di giorni precedenti.",
        )


def _hydrate(session: Session, expense: Expense) -> ExpenseOut:
    out = ExpenseOut.model_validate(expense)
    out.created_by_name = session.scalar(
        select(User.full_name).where(User.id == expense.created_by_user_id)
    )
    cat = session.get(ExpenseCategory, expense.category_id)
    if cat is not None:
        out.category = _CategoryMini.model_validate(cat)
    return out


@router.post("", response_model=ExpenseOut, status_code=status.HTTP_201_CREATED)
def create_expense(
    category_id: int = Form(..., gt=0),
    description: str = Form(..., min_length=1, max_length=255),
    amount: Decimal = Form(..., gt=0),
    service: Literal["lunch", "dinner"] = Form(...),
    date: date_type | None = Form(None),
    receipt_photo: UploadFile | None = File(None),
    session: Session = Depends(get_session),
    user: User = Depends(require_manager_or_admin),
) -> ExpenseOut:
    cat = session.get(ExpenseCategory, category_id)
    if cat is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Categoria non trovata.")
    if not cat.active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Categoria disattivata.")

    receipt_url: str | None = None
    if receipt_photo is not None and receipt_photo.filename:
        try:
            receipt_url = upload_image(receipt_photo, folder="expenses")
        except UploadError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    expense = Expense(
        date=date or date_type.today(),
        service=ServiceKind(service),
        category_id=category_id,
        description=description,
        amount=amount,
        receipt_photo_url=receipt_url,
        created_by_user_id=user.id,
    )
    session.add(expense)
    session.commit()
    session.refresh(expense)
    logger.info(
        "Expense creata id=%d date=%s service=%s amount=%s by user_id=%d",
        expense.id, expense.date, service, amount, user.id,
    )
    return _hydrate(session, expense)


@router.get("", response_model=list[ExpenseOut])
def list_expenses(
    date: date_type | None = Query(None),
    from_date: date_type | None = Query(None, alias="from"),
    to_date: date_type | None = Query(None, alias="to"),
    service: Literal["lunch", "dinner"] | None = Query(None),
    category_id: int | None = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> list[ExpenseOut]:
    stmt = select(Expense)
    if date is not None:
        stmt = stmt.where(Expense.date == date)
    if from_date is not None:
        stmt = stmt.where(Expense.date >= from_date)
    if to_date is not None:
        stmt = stmt.where(Expense.date <= to_date)
    if service is not None:
        stmt = stmt.where(Expense.service == ServiceKind(service))
    if category_id is not None:
        stmt = stmt.where(Expense.category_id == category_id)
    stmt = (
        stmt.order_by(Expense.date.desc(), Expense.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = list(session.scalars(stmt))
    return [_hydrate(session, r) for r in rows]


@router.patch("/{expense_id}", response_model=ExpenseOut)
def update_expense(
    expense_id: int,
    payload: ExpenseUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(require_manager_or_admin),
) -> ExpenseOut:
    expense = session.get(Expense, expense_id)
    if expense is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Spesa non trovata.")
    _check_can_modify(expense, user)
    changes = payload.model_dump(exclude_unset=True)
    if "category_id" in changes:
        cat = session.get(ExpenseCategory, changes["category_id"])
        if cat is None or not cat.active:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Categoria non valida.")
    for k, v in changes.items():
        setattr(expense, k, v)
    session.commit()
    session.refresh(expense)
    logger.info("Expense %d aggiornata by user_id=%d", expense.id, user.id)
    return _hydrate(session, expense)


@router.delete(
    "/{expense_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def delete_expense(
    expense_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(require_manager_or_admin),
) -> None:
    expense = session.get(Expense, expense_id)
    if expense is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Spesa non trovata.")
    _check_can_modify(expense, user)
    session.delete(expense)
    session.commit()
    logger.info("Expense %d eliminata by user_id=%d", expense_id, user.id)
