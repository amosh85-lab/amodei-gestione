"""/push router: subscribe / unsubscribe + chiave pubblica VAPID."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_session
from app.dependencies.auth import get_current_user
from app.models.push import PushSubscription
from app.models.users import User
from app.schemas.push import (
    PushSubscriptionIn,
    PushSubscriptionOut,
    VapidPublicKeyOut,
)

router = APIRouter(prefix="/push", tags=["push"])
logger = logging.getLogger("amodei.push")


@router.get("/vapid-public-key", response_model=VapidPublicKeyOut)
def vapid_public_key() -> VapidPublicKeyOut:
    """Espone la chiave pubblica VAPID al frontend per ``PushManager.subscribe``.

    Pubblico (niente auth): non è un segreto, e il service-worker la richiede
    prima di chiedere il permesso all'utente.
    """
    s = get_settings()
    if not s.vapid_public_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push notifications non configurate sul server",
        )
    return VapidPublicKeyOut(public_key=s.vapid_public_key)


@router.post(
    "/subscribe",
    response_model=PushSubscriptionOut,
    status_code=status.HTTP_201_CREATED,
)
def subscribe(
    body: PushSubscriptionIn,
    request: Request,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> PushSubscriptionOut:
    """Registra (o aggiorna) la subscription PushManager per l'utente corrente.

    Idempotente sull'endpoint: se la stessa endpoint esiste già, viene
    aggiornata (può cambiare utente nel caso di logout/login sullo stesso
    browser).
    """
    if not get_settings().vapid_public_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push notifications non configurate sul server",
        )

    ua = body.user_agent or (request.headers.get("user-agent") or "")[:255] or None

    existing = session.scalar(
        select(PushSubscription).where(PushSubscription.endpoint == body.endpoint)
    )
    if existing is not None:
        existing.user_id = user.id
        existing.p256dh = body.keys.p256dh
        existing.auth = body.keys.auth
        existing.user_agent = ua
        session.commit()
        return PushSubscriptionOut(id=existing.id)

    sub = PushSubscription(
        user_id=user.id,
        endpoint=body.endpoint,
        p256dh=body.keys.p256dh,
        auth=body.keys.auth,
        user_agent=ua,
    )
    session.add(sub)
    session.commit()
    session.refresh(sub)
    return PushSubscriptionOut(id=sub.id)


@router.delete("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(
    endpoint: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Response:
    """Rimuove la subscription per (endpoint, user). Tollerante a 404 — se la
    subscription non esiste più (es. doppio invio dal client), restituisce
    comunque 204."""
    session.query(PushSubscription).filter(
        PushSubscription.endpoint == endpoint,
        PushSubscription.user_id == user.id,
    ).delete(synchronize_session=False)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
