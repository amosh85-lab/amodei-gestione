"""Web Push subscriptions: una riga per ogni (utente, browser/dispositivo)."""
from __future__ import annotations

from sqlalchemy import BigInteger, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import AmodeiBase, TimestampMixin


class PushSubscription(AmodeiBase, TimestampMixin):
    """Subscription PushManager salvata dal frontend.

    L'endpoint è univoco (un browser/dispositivo ha 1 sola subscription attiva
    per origin); upsert lato API quando arriva una subscribe per un endpoint
    già esistente. ``user_agent`` è informativo (utile per debugging "quale
    iPhone era questo?").
    """

    __tablename__ = "push_subscriptions"

    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    endpoint: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    p256dh: Mapped[str] = mapped_column(Text, nullable=False)
    auth: Mapped[str] = mapped_column(Text, nullable=False)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
