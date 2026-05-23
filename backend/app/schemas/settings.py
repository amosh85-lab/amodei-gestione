"""Pydantic schemas for the /settings router."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class AppSettingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    key: str
    value: str
    value_type: Literal["string", "number", "boolean", "json"]
    description: str | None = None
    updated_by_user_id: int | None = None
    updated_by_name: str | None = None
    updated_at: datetime


class AppSettingUpdate(BaseModel):
    value: str
