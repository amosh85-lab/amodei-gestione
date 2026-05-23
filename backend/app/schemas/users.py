"""Pydantic schemas for the /users router (picker-only for now)."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from app.models.users import UserRole


class UserMini(BaseModel):
    """Minimal user payload — used by other features that need to display
    or pick users without exposing the full profile / password hash."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    full_name: str
    role: UserRole
    active: bool
