"""Authentication primitives: password hashing (re-exported) and JWT helpers.

Password helpers (``hash_password``, ``verify_password``) live in
``app.utils.passwords`` and are re-exported here so callers find everything
auth-related in one place.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt

from app.config import get_settings
from app.utils.passwords import hash_password, verify_password

__all__ = [
    "TokenError",
    "create_access_token",
    "decode_token",
    "hash_password",
    "verify_password",
]


class TokenError(Exception):
    """Raised when a JWT cannot be decoded, is malformed, or has expired."""


def create_access_token(
    user_id: int,
    role: str,
    expires_minutes: int | None = None,
) -> str:
    """Sign and return an access token for the given user.

    ``expires_minutes`` defaults to the value from settings
    (``JWT_EXPIRES_MINUTES``, 7 days by default — comfortable for daily PWA use).
    """
    settings = get_settings()
    if expires_minutes is None:
        expires_minutes = settings.jwt_expires_minutes
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(user_id),  # JWT spec: ``sub`` is a string
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=expires_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict[str, Any]:
    """Return the decoded JWT payload, or raise :class:`TokenError`."""
    settings = get_settings()
    try:
        return jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError as exc:
        raise TokenError(str(exc)) from exc
