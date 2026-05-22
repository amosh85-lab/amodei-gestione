"""Authentication endpoints: login, me, change-password."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import get_current_user
from app.models.users import User
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    TokenResponse,
    UserOut,
)
from app.services.auth import create_access_token, hash_password, verify_password

logger = logging.getLogger("amodei.auth")

router = APIRouter(prefix="/auth", tags=["auth"])


def _invalid_credentials() -> HTTPException:
    # Same response whether the email doesn't exist, the user is inactive,
    # or the password is wrong — avoids user enumeration.
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenziali non valide",
        headers={"WWW-Authenticate": "Bearer"},
    )


@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest,
    session: Session = Depends(get_session),
) -> TokenResponse:
    email = payload.email.strip().lower()
    user = session.query(User).filter(User.email == email).first()
    if user is None or not user.active:
        logger.info("Login fallito (utente non trovato o disattivato): %s", email)
        raise _invalid_credentials()
    if not verify_password(payload.password, user.password_hash):
        logger.info("Login fallito (password errata) per user_id=%d", user.id)
        raise _invalid_credentials()
    token = create_access_token(user_id=user.id, role=user.role.value)
    logger.info("Login OK: user_id=%d role=%s", user.id, user.role.value)
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def read_me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)


@router.post(
    "/change-password",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def change_password(
    payload: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password attuale errata",
        )
    if payload.new_password == payload.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La nuova password deve essere diversa dall'attuale",
        )
    user.password_hash = hash_password(payload.new_password)
    session.add(user)
    session.commit()
    logger.info("Password cambiata per user_id=%d", user.id)
