"""FastAPI dependencies for authenticated routes."""
from __future__ import annotations

from typing import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.database import get_session
from app.models.users import User
from app.services.auth import TokenError, decode_token

# tokenUrl is metadata for Swagger UI's "Authorize" button. Our login endpoint
# accepts JSON (not form-encoded) so the built-in button is partial; callers
# can still obtain a token via /auth/login and paste it.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login", auto_error=True)


def _credentials_exception() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token non valido o scaduto",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> User:
    """Resolve the current ``User`` from the Bearer token.

    Raises 401 if the token is missing/invalid/expired, or if the user no
    longer exists or has been deactivated.
    """
    try:
        payload = decode_token(token)
    except TokenError:
        raise _credentials_exception()

    raw_sub = payload.get("sub")
    if raw_sub is None:
        raise _credentials_exception()
    try:
        user_id = int(raw_sub)
    except (TypeError, ValueError):
        raise _credentials_exception()

    user = session.get(User, user_id)
    if user is None or not user.active:
        raise _credentials_exception()
    return user


def require_role(*allowed_roles: str) -> Callable[..., User]:
    """Factory returning a dependency that asserts ``user.role`` is allowed.

    Usage::

        @router.get("/admin-only", dependencies=[Depends(require_admin)])
        def ...

    or via injection::

        def handler(user: User = Depends(require_manager_or_admin)) -> ...
    """
    allowed = set(allowed_roles)

    def _dep(user: User = Depends(get_current_user)) -> User:
        if user.role.value not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Operazione non consentita per il tuo ruolo",
            )
        return user

    return _dep


# Common role-guard shortcuts.
require_admin = require_role("admin")
require_manager_or_admin = require_role("admin", "manager")
require_any = get_current_user  # any authenticated user
