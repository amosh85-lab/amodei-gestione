"""/expense-categories router: CRUD for the spese category list."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import get_current_user, require_admin
from app.models.cash import ExpenseCategory
from app.models.users import User
from app.schemas.cash import (
    ExpenseCategoryCreate,
    ExpenseCategoryOut,
    ExpenseCategoryUpdate,
)

router = APIRouter(prefix="/expense-categories", tags=["expense-categories"])
logger = logging.getLogger("amodei.expense_categories")


@router.get("", response_model=list[ExpenseCategoryOut])
def list_categories(
    include_inactive: bool = Query(False),
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> list[ExpenseCategoryOut]:
    stmt = select(ExpenseCategory)
    if not include_inactive:
        stmt = stmt.where(ExpenseCategory.active.is_(True))
    stmt = stmt.order_by(ExpenseCategory.name.asc())
    return list(session.scalars(stmt))


@router.post(
    "",
    response_model=ExpenseCategoryOut,
    status_code=status.HTTP_201_CREATED,
)
def create_category(
    payload: ExpenseCategoryCreate,
    session: Session = Depends(get_session),
    user: User = Depends(require_admin),
) -> ExpenseCategoryOut:
    cat = ExpenseCategory(
        name=payload.name,
        icon=payload.icon,
        color=payload.color,
        active=True,
    )
    session.add(cat)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Categoria '{payload.name}' già esistente.",
        ) from exc
    session.refresh(cat)
    logger.info("ExpenseCategory creata id=%d name=%r by user_id=%d", cat.id, cat.name, user.id)
    return cat


@router.patch("/{category_id}", response_model=ExpenseCategoryOut)
def update_category(
    category_id: int,
    payload: ExpenseCategoryUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(require_admin),
) -> ExpenseCategoryOut:
    cat = session.get(ExpenseCategory, category_id)
    if cat is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Categoria non trovata.")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(cat, k, v)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Nome categoria già usato.",
        ) from exc
    session.refresh(cat)
    logger.info("ExpenseCategory %d aggiornata by user_id=%d", cat.id, user.id)
    return cat


@router.delete(
    "/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def delete_category(
    category_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(require_admin),
) -> None:
    cat = session.get(ExpenseCategory, category_id)
    if cat is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Categoria non trovata.")
    if cat.active is False:
        return  # idempotent
    cat.active = False
    session.commit()
    logger.info("ExpenseCategory %d soft-deleted by user_id=%d", cat.id, user.id)
