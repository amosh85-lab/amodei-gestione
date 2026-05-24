"""Pydantic schemas for the /users router."""
from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.users import UserRole


class UserMini(BaseModel):
    """Minimal user payload — used by other features that need to display
    or pick users without exposing the full profile / password hash.

    DOES NOT include hourly_rate / weekly_hours_contract. These are payroll
    data sensitive: ONLY UserOutAdmin (used by /users) exposes them."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    full_name: str
    role: UserRole
    active: bool


class UserOutAdmin(UserMini):
    """Extended user payload returned ONLY by /users (admin-only router).
    Includes payroll fields. Never use this anywhere else."""

    hourly_rate: Decimal | None = None
    weekly_hours_contract: Decimal | None = None


class UserCreate(BaseModel):
    """Admin creates a new user (any role, including another admin)."""

    email: EmailStr
    full_name: str = Field(min_length=1, max_length=160)
    role: UserRole
    password: str = Field(min_length=8, max_length=128)
    hourly_rate: Decimal | None = Field(default=None, ge=0)
    weekly_hours_contract: Decimal | None = Field(default=None, ge=0, le=168)


class UserUpdate(BaseModel):
    """Admin patches an existing user. All fields optional."""

    full_name: str | None = Field(default=None, min_length=1, max_length=160)
    role: UserRole | None = None
    active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)
    hourly_rate: Decimal | None = Field(default=None, ge=0)
    weekly_hours_contract: Decimal | None = Field(default=None, ge=0, le=168)
