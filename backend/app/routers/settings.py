"""/settings router: key-value app config."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import require_admin, require_manager_or_admin
from app.models.settings import AppSetting, AppSettingValueType
from app.models.users import User
from app.schemas.settings import AppSettingOut, AppSettingUpdate

router = APIRouter(prefix="/settings", tags=["settings"])
logger = logging.getLogger("amodei.settings")


def _validate_value(value: str, value_type: AppSettingValueType) -> None:
    if value_type == AppSettingValueType.number:
        try:
            Decimal(value)
        except (InvalidOperation, ValueError):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Valore non numerico per setting di tipo number: {value!r}",
            )
    elif value_type == AppSettingValueType.boolean:
        if value.lower() not in ("true", "false"):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Valore boolean deve essere 'true' o 'false', non {value!r}",
            )
    elif value_type == AppSettingValueType.json:
        try:
            json.loads(value)
        except json.JSONDecodeError:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Valore non è JSON valido: {value!r}",
            )


def _hydrate(session: Session, setting: AppSetting) -> AppSettingOut:
    out = AppSettingOut.model_validate(setting)
    if setting.updated_by_user_id:
        name = session.scalar(
            select(User.full_name).where(User.id == setting.updated_by_user_id)
        )
        out.updated_by_name = name
    return out


@router.get("", response_model=list[AppSettingOut])
def list_settings(
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> list[AppSettingOut]:
    items = list(session.scalars(select(AppSetting).order_by(AppSetting.key.asc())))
    return [_hydrate(session, s) for s in items]


@router.get("/cash-float", response_model=dict)
def get_cash_float_value(
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> dict:
    """Convenience: returns {value: Decimal} of the cash_float setting."""
    setting = session.scalar(select(AppSetting).where(AppSetting.key == "cash_float"))
    if setting is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Setting cash_float non trovato.")
    try:
        v = Decimal(setting.value)
    except (InvalidOperation, ValueError):
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            f"Setting cash_float malformed: {setting.value!r}",
        )
    return {"value": v}


@router.get("/{key}", response_model=AppSettingOut)
def get_setting(
    key: str,
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> AppSettingOut:
    setting = session.scalar(select(AppSetting).where(AppSetting.key == key))
    if setting is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Setting {key!r} non trovato.")
    return _hydrate(session, setting)


@router.patch("/{key}", response_model=AppSettingOut)
def update_setting(
    key: str,
    payload: AppSettingUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(require_admin),
) -> AppSettingOut:
    setting = session.scalar(select(AppSetting).where(AppSetting.key == key))
    if setting is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Setting {key!r} non trovato.")
    _validate_value(payload.value, setting.value_type)
    setting.value = payload.value
    setting.updated_by_user_id = user.id
    setting.updated_at = datetime.now(timezone.utc)
    session.commit()
    session.refresh(setting)
    logger.info("Setting %s aggiornato a %r by user_id=%d", key, payload.value, user.id)
    return _hydrate(session, setting)
