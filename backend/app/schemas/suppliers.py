"""Pydantic schemas for the /suppliers router."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# E.164: leading '+' then 1-15 digits, first digit non-zero.
_E164_RE = re.compile(r"^\+[1-9]\d{1,14}$")


def _normalise_whatsapp(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip().replace(" ", "")
    if not cleaned:
        return None
    if not _E164_RE.match(cleaned):
        raise ValueError("WhatsApp deve essere in formato E.164 (es. +39333...).")
    return cleaned


class _SupplierFields(BaseModel):
    """Fields shared between create / update / out (without id/active/meta)."""

    name: str = Field(min_length=1, max_length=160)
    contact_name: str | None = Field(default=None, max_length=160)
    phone: str | None = Field(default=None, max_length=40)
    whatsapp: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=255)
    notes: str | None = None
    message_template: str | None = None
    category: Literal["food", "beverage", "consumo"] = "food"

    @field_validator("whatsapp")
    @classmethod
    def _wa_validator(cls, v: str | None) -> str | None:
        return _normalise_whatsapp(v)


class SupplierCreate(_SupplierFields):
    """Payload for POST /suppliers."""


class SupplierUpdate(BaseModel):
    """Payload for PATCH /suppliers/{id}. All fields optional."""

    name: str | None = Field(default=None, min_length=1, max_length=160)
    contact_name: str | None = Field(default=None, max_length=160)
    phone: str | None = Field(default=None, max_length=40)
    whatsapp: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=255)
    notes: str | None = None
    message_template: str | None = None
    active: bool | None = None
    category: Literal["food", "beverage", "consumo"] | None = None

    @field_validator("whatsapp")
    @classmethod
    def _wa_validator(cls, v: str | None) -> str | None:
        return _normalise_whatsapp(v)


class SupplierOut(_SupplierFields):
    model_config = ConfigDict(from_attributes=True)

    id: int
    active: bool
    created_at: datetime
