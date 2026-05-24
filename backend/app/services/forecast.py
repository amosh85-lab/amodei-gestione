"""Demand forecasting: average daily consumption per product, days until
stockout, suggested reorder quantity, and automatic system alert generation.

The forecast is intentionally simple: average daily sales over a rolling
window. Good enough for a wine bar where weekly seasonality dominates.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.models.inventory import Batch, Movement, MovementType, Product
from app.models.reorder import (
    StockAlert,
    StockAlertSource,
    StockAlertStatus,
    StockSignaledStatus,
)

logger = logging.getLogger("amodei.forecast")

ZERO = Decimal("0")

# Defaults — also documented in the Prompt 17 spec.
DEFAULT_DAYS_BACK = 28
DEFAULT_DAYS_COVERAGE = 14
ALERT_THRESHOLD_DAYS = 7   # days_until_stockout strictly under this → alert


def _q(value: Decimal | int | float | None) -> Decimal:
    if value is None:
        return ZERO
    if not isinstance(value, Decimal):
        value = Decimal(str(value))
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


@dataclass
class ProductForecast:
    product_id: int
    name: str
    category: str | None
    unit: str
    current_qty: Decimal
    consumption_per_day: Decimal
    days_until_stockout: int | None       # None when no consumption recorded
    suggested_order_qty: Decimal


def calculate_consumption(
    session: Session,
    product_id: int,
    days_back: int = DEFAULT_DAYS_BACK,
) -> Decimal:
    """Average daily sales (qty/day) over the last ``days_back`` days.

    Only Movement.type=sale counts. Returns 0 if no sales in the window.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days_back)
    total = session.scalar(
        select(func.coalesce(func.sum(Movement.qty), 0))
        .where(Movement.product_id == product_id)
        .where(Movement.type == MovementType.sale)
        .where(Movement.created_at >= cutoff)
    )
    if total is None:
        return ZERO
    return _q(Decimal(total) / Decimal(days_back))


def _current_stock(session: Session, product_id: int) -> Decimal:
    qty = session.scalar(
        select(func.coalesce(func.sum(Batch.current_qty), 0))
        .where(Batch.product_id == product_id)
    )
    return _q(qty)


def days_until_stockout(
    session: Session,
    product_id: int,
    days_back: int = DEFAULT_DAYS_BACK,
) -> int | None:
    """Estimated days of stock left at the current consumption rate.

    Returns None when consumption is 0 (we can't predict a stockout for a
    product that isn't moving). Returns 0 when stock is already empty AND
    there has been consumption.
    """
    consumption = calculate_consumption(session, product_id, days_back)
    if consumption == 0:
        return None
    qty = _current_stock(session, product_id)
    return int((qty / consumption).to_integral_value(rounding="ROUND_FLOOR"))


def suggested_order_qty(
    session: Session,
    product_id: int,
    days_coverage: int = DEFAULT_DAYS_COVERAGE,
    days_back: int = DEFAULT_DAYS_BACK,
) -> Decimal:
    """How much to reorder to cover ``days_coverage`` days from now.

    suggested = max(0, consumption_per_day × days_coverage − current_qty)
    """
    consumption = calculate_consumption(session, product_id, days_back)
    qty = _current_stock(session, product_id)
    target = consumption * Decimal(days_coverage)
    return _q(max(ZERO, target - qty))


def product_forecast(
    session: Session,
    product: Product,
    days_back: int = DEFAULT_DAYS_BACK,
    days_coverage: int = DEFAULT_DAYS_COVERAGE,
) -> ProductForecast:
    consumption = calculate_consumption(session, product.id, days_back)
    current = _current_stock(session, product.id)
    if consumption == 0:
        days = None
    else:
        days = int((current / consumption).to_integral_value(rounding="ROUND_FLOOR"))
    target = consumption * Decimal(days_coverage)
    suggested = _q(max(ZERO, target - current))
    return ProductForecast(
        product_id=product.id,
        name=product.name,
        category=product.category,
        unit=product.unit,
        current_qty=current,
        consumption_per_day=consumption,
        days_until_stockout=days,
        suggested_order_qty=suggested,
    )


def list_low_stock_predictions(
    session: Session,
    days_back: int = DEFAULT_DAYS_BACK,
    days_coverage: int = DEFAULT_DAYS_COVERAGE,
) -> list[ProductForecast]:
    """All active products, scored by stockout urgency.

    Order: lowest days_until_stockout first; products without consumption
    (days = None) are placed at the end.
    """
    products = list(session.scalars(
        select(Product).where(Product.active == True)  # noqa: E712
    ))
    out = [product_forecast(session, p, days_back, days_coverage) for p in products]
    # Sort: smallest int first, None last
    out.sort(key=lambda f: (f.days_until_stockout is None, f.days_until_stockout if f.days_until_stockout is not None else 0))
    return out


def generate_system_alerts(
    session: Session,
    triggered_by_user_id: int,
    days_back: int = DEFAULT_DAYS_BACK,
    days_coverage: int = DEFAULT_DAYS_COVERAGE,
    threshold_days: int = ALERT_THRESHOLD_DAYS,
) -> dict:
    """Create StockAlert(source=system) for every product predicted to run
    out within ``threshold_days``. Skips products that already have an OPEN
    alert (regardless of source) — staff signals take precedence.

    Returns a summary dict: {created, skipped_existing_open, skipped_no_signal}.
    """
    created = 0
    skipped_existing = 0
    skipped_no_signal = 0

    # Pre-load all open alerts product_ids in one query
    open_product_ids = set(session.scalars(
        select(StockAlert.product_id).where(StockAlert.status == StockAlertStatus.open)
    ).all())

    forecasts = list_low_stock_predictions(session, days_back, days_coverage)
    for f in forecasts:
        if f.days_until_stockout is None or f.days_until_stockout >= threshold_days:
            skipped_no_signal += 1
            continue
        if f.product_id in open_product_ids:
            skipped_existing += 1
            continue
        signaled = StockSignaledStatus.out if f.days_until_stockout <= 0 else StockSignaledStatus.low
        alert = StockAlert(
            product_id=f.product_id,
            status_signaled=signaled,
            suggested_qty=f.suggested_order_qty if f.suggested_order_qty > 0 else None,
            notes=f"Generato dal sistema: ~{f.days_until_stockout} giorni di copertura residua, consumo medio {f.consumption_per_day}/giorno (storico {days_back} gg).",
            signaled_by_user_id=triggered_by_user_id,
            status=StockAlertStatus.open,
            source=StockAlertSource.system,
        )
        session.add(alert)
        created += 1
        # Track to avoid creating two alerts for the same product in one run
        open_product_ids.add(f.product_id)

    if created > 0:
        session.commit()

    logger.info(
        "generate_system_alerts: created=%d skipped_existing=%d skipped_no_signal=%d",
        created, skipped_existing, skipped_no_signal,
    )
    return {
        "created": created,
        "skipped_existing_open": skipped_existing,
        "skipped_no_signal": skipped_no_signal,
    }
