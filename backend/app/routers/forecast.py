"""/forecast router: stockout prediction + on-demand system alert generation."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import require_admin, require_manager_or_admin
from app.models.users import User
from app.schemas.forecast import GenerateAlertsOut, ProductForecastOut
from app.services.forecast import (
    DEFAULT_DAYS_BACK,
    DEFAULT_DAYS_COVERAGE,
    generate_system_alerts,
    list_low_stock_predictions,
)

router = APIRouter(prefix="/forecast", tags=["forecast"])
logger = logging.getLogger("amodei.forecast.api")


@router.get("/low-stock-prediction", response_model=list[ProductForecastOut])
def low_stock_prediction(
    days_back: int = Query(default=DEFAULT_DAYS_BACK, ge=1, le=365),
    days_coverage: int = Query(default=DEFAULT_DAYS_COVERAGE, ge=1, le=90),
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> list[ProductForecastOut]:
    forecasts = list_low_stock_predictions(session, days_back, days_coverage)
    return [
        ProductForecastOut(
            product_id=f.product_id,
            name=f.name,
            category=f.category,
            unit=f.unit,
            current_qty=f.current_qty,
            consumption_per_day=f.consumption_per_day,
            days_until_stockout=f.days_until_stockout,
            suggested_order_qty=f.suggested_order_qty,
        )
        for f in forecasts
    ]


@router.post("/generate-system-alerts", response_model=GenerateAlertsOut)
def trigger_system_alerts(
    days_back: int = Query(default=DEFAULT_DAYS_BACK, ge=1, le=365),
    days_coverage: int = Query(default=DEFAULT_DAYS_COVERAGE, ge=1, le=90),
    session: Session = Depends(get_session),
    user: User = Depends(require_admin),
) -> GenerateAlertsOut:
    result = generate_system_alerts(
        session,
        triggered_by_user_id=user.id,
        days_back=days_back,
        days_coverage=days_coverage,
    )
    return GenerateAlertsOut(**result)
