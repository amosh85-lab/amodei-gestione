"""Minimal /users router: list active users (picker only).

A full CRUD lives in a future prompt. This endpoint exists today because
the staff-meals picker needs to list teammates.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import get_current_user
from app.models.users import User
from app.schemas.users import UserMini

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserMini])
def list_users(
    include_inactive: bool = Query(False),
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> list[User]:
    stmt = select(User).order_by(User.full_name.asc())
    if not include_inactive:
        stmt = stmt.where(User.active.is_(True))
    return list(session.scalars(stmt))
