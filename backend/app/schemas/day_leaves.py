"""Schemi per /day-leaves."""
from __future__ import annotations

from datetime import date as date_type
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


KindLiteral = Literal["ferie", "riposo", "malattia"]


class DayLeaveUpsert(BaseModel):
    user_id: int = Field(gt=0)
    date: date_type
    kind: KindLiteral
    notes: str | None = None


class _UserMini(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    full_name: str


class DayLeaveOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    date: date_type
    kind: KindLiteral
    notes: str | None = None
    user: _UserMini | None = None
