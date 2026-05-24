"""/users router: list (all logged-in users) + admin-only create/update.

Admin can create users of any role, including other admins. There is no
delete: deactivate (`active=false`) instead so FK references from existing
data (movements, alerts, summaries) keep resolving.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import get_current_user, require_admin
from app.models.users import User
from app.schemas.users import UserCreate, UserMini, UserUpdate
from app.services.auth import hash_password

router = APIRouter(prefix="/users", tags=["users"])
logger = logging.getLogger("amodei.users")


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


@router.post("", response_model=UserMini, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    session: Session = Depends(get_session),
    actor: User = Depends(require_admin),
) -> User:
    email = payload.email.strip().lower()
    existing = session.scalar(select(User).where(User.email == email))
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Esiste già un utente con questa email.")
    new_user = User(
        email=email,
        full_name=payload.full_name.strip(),
        role=payload.role,
        password_hash=hash_password(payload.password),
        active=True,
    )
    session.add(new_user)
    session.commit()
    session.refresh(new_user)
    logger.info("User created: id=%d email=%s role=%s by_admin=%d",
                new_user.id, email, payload.role.value, actor.id)
    return new_user


@router.patch("/{user_id}", response_model=UserMini)
def update_user(
    user_id: int,
    payload: UserUpdate,
    session: Session = Depends(get_session),
    actor: User = Depends(require_admin),
) -> User:
    target = session.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Utente non trovato.")

    # Self-protection: an admin cannot demote or deactivate themselves.
    if target.id == actor.id:
        if payload.role is not None and payload.role.value != "admin":
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "Non puoi cambiare il tuo ruolo a non-admin.")
        if payload.active is False:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "Non puoi disattivare il tuo stesso account.")

    changes = payload.model_dump(exclude_unset=True)
    if "password" in changes and changes["password"] is not None:
        target.password_hash = hash_password(changes.pop("password"))
    if "full_name" in changes and changes["full_name"] is not None:
        target.full_name = changes["full_name"].strip()
        del changes["full_name"]
    if "role" in changes and changes["role"] is not None:
        target.role = changes["role"]
        del changes["role"]
    if "active" in changes and changes["active"] is not None:
        target.active = changes["active"]
        del changes["active"]

    session.commit()
    session.refresh(target)
    logger.info("User updated: id=%d by_admin=%d", target.id, actor.id)
    return target
