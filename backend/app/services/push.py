"""Web Push service — wrapper attorno a pywebpush.

Niente queue / retry sofisticati: invio sincrono dentro il request handler,
chiusura veloce. La pulizia delle subscription scadute è inline: se il push
provider risponde 404/410, cancelliamo la riga subito.
"""
from __future__ import annotations

import json
import logging
from typing import Iterable

from pywebpush import WebPushException, webpush
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.push import PushSubscription
from app.models.users import User, UserRole

logger = logging.getLogger("amodei.push")


def is_push_configured() -> bool:
    s = get_settings()
    return bool(s.vapid_public_key and s.vapid_private_key)


def send_to_user(
    session: Session,
    user_id: int,
    *,
    title: str,
    body: str,
    url: str = "/",
    tag: str | None = None,
) -> int:
    """Invia la notifica a tutte le subscription del singolo utente.

    Ritorna il numero di subscription a cui è stato consegnato (esclusi gli
    endpoint scaduti che vengono eliminati). Niente exception sollevata: ogni
    errore è loggato e non rompe il caller.
    """
    if not is_push_configured():
        logger.info("Push disabled (no VAPID keys) — skip user %d", user_id)
        return 0

    subs = list(session.scalars(
        select(PushSubscription).where(PushSubscription.user_id == user_id)
    ))
    return _send_many(session, subs, title=title, body=body, url=url, tag=tag)


def send_to_admins(
    session: Session,
    *,
    title: str,
    body: str,
    url: str = "/",
    tag: str | None = None,
    exclude_user_id: int | None = None,
) -> int:
    """Invia a TUTTE le subscription degli utenti con role='admin' attivi.

    ``exclude_user_id`` evita che l'autore di un'azione riceva la propria
    notifica (es. admin che chiude la cassa).
    """
    if not is_push_configured():
        return 0
    stmt = (
        select(PushSubscription)
        .join(User, User.id == PushSubscription.user_id)
        .where(User.role == UserRole.admin, User.active == True)  # noqa: E712
    )
    if exclude_user_id is not None:
        stmt = stmt.where(PushSubscription.user_id != exclude_user_id)
    subs = list(session.scalars(stmt))
    return _send_many(session, subs, title=title, body=body, url=url, tag=tag)


def _send_many(
    session: Session,
    subs: Iterable[PushSubscription],
    *,
    title: str,
    body: str,
    url: str,
    tag: str | None,
) -> int:
    s = get_settings()
    payload = json.dumps({
        "title": title,
        "body": body,
        "url": url,
        "tag": tag or url,
    })
    vapid_claims = {"sub": s.vapid_subject}
    delivered = 0
    to_delete: list[int] = []
    for sub in subs:
        info = {
            "endpoint": sub.endpoint,
            "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
        }
        try:
            webpush(
                subscription_info=info,
                data=payload,
                vapid_private_key=s.vapid_private_key,
                vapid_claims=dict(vapid_claims),
                ttl=60 * 60 * 24,   # 24h
            )
            delivered += 1
        except WebPushException as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (404, 410):
                # Subscription scaduta o disinstallata → rimuovo
                to_delete.append(sub.id)
                logger.info("Push subscription %d gone (HTTP %s) — removing", sub.id, status)
            else:
                logger.warning("Push send failed for sub %d: %s", sub.id, exc)
        except Exception:
            logger.exception("Unexpected error sending push to sub %d", sub.id)

    if to_delete:
        session.query(PushSubscription).filter(PushSubscription.id.in_(to_delete)).delete(
            synchronize_session=False
        )
        session.commit()
    return delivered
