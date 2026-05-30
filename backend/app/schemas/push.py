"""Schemas per le subscription Web Push."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class PushSubscriptionKeys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=200)
    auth: str = Field(min_length=1, max_length=100)


class PushSubscriptionIn(BaseModel):
    """Body inviato dal frontend dopo PushManager.subscribe()."""

    endpoint: str = Field(min_length=1, max_length=2000)
    keys: PushSubscriptionKeys
    user_agent: str | None = Field(default=None, max_length=255)


class PushSubscriptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int


class VapidPublicKeyOut(BaseModel):
    public_key: str
