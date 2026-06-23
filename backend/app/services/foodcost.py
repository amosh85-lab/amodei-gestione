"""Food cost dashboard: invoices by supplier-category vs revenue.

Base UFFICIALE del food cost = incasso REALE (computed_total): POS + contanti
+ spese + anticipi, ricalcolato live. Si aggiorna appena i dati del giorno
sono inseriti (in particolare il contante di fine giornata), senza attendere
la chiusura formale né l'inserimento del totale fiscale.

Reads:
- Invoices in the requested month, grouped by their Supplier.category.
- DailySummary.computed_total ricalcolato live = incasso reale (denominatore).
- DailySummary.fiscal_total per la sola riga di riferimento/quadratura.
- AppSetting.food_cost_threshold (default 32%).

For each category returns total + invoice count + pct_computed (base) +
pct_fiscal (riferimento) + status ('ok' / 'warn' / 'alert' sul reale).
"""
from __future__ import annotations

import calendar
import logging
from dataclasses import dataclass
from datetime import date as date_type
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.cash import DailySummary
from app.models.inventory import Supplier, SupplierCategory
from app.models.invoices import Invoice
from app.models.settings import AppSetting
from app.services.cash import calculate_summary

logger = logging.getLogger("amodei.foodcost")

DEFAULT_THRESHOLD = Decimal("32.00")
ZERO = Decimal("0")
MONTH_LABELS = [
    "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
    "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
]


def _q(value):
    if value is None:
        return ZERO
    if not isinstance(value, Decimal):
        value = Decimal(str(value))
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _month_range(year: int, month: int) -> tuple[date_type, date_type]:
    first = date_type(year, month, 1)
    if month == 12:
        next_first = date_type(year + 1, 1, 1)
    else:
        next_first = date_type(year, month + 1, 1)
    return first, next_first


def _threshold(session: Session) -> Decimal:
    s = session.scalar(select(AppSetting).where(AppSetting.key == "food_cost_threshold"))
    if s is None:
        return DEFAULT_THRESHOLD
    try:
        return _q(Decimal(s.value))
    except Exception:
        return DEFAULT_THRESHOLD


def _pct(numerator: Decimal, denominator: Decimal) -> Decimal | None:
    """% with 1 decimal. None when denominator is 0."""
    if denominator is None or denominator == 0:
        return None
    return _q(numerator / denominator * 100)


def _status_for(threshold: Decimal, pct_computed: Decimal | None) -> str:
    """Stato guidato SOLO dall'incasso reale (computed): è la base ufficiale
    del food cost. ok = sotto soglia o ancora ignoto, warn = vicino alla
    soglia (entro 2 punti sotto), alert = pari o sopra soglia."""
    if pct_computed is None:
        return "ok"
    if pct_computed >= threshold:
        return "alert"
    if pct_computed >= threshold - Decimal("2"):
        return "warn"
    return "ok"


def calculate_foodcost(session: Session, year: int, month: int) -> dict:
    first, next_first = _month_range(year, month)
    threshold = _threshold(session)

    # ---- Revenue (denominators) ----
    fiscal_rows = list(session.execute(
        select(DailySummary.fiscal_total).where(
            DailySummary.date >= first, DailySummary.date < next_first,
            DailySummary.fiscal_total.isnot(None),
        )
    ).scalars())
    fiscal_revenue = _q(sum(fiscal_rows, ZERO))
    fiscal_days = len(fiscal_rows)

    # Computed live (more expensive but small sample: 28-31 rows)
    computed_revenue = ZERO
    computed_days = 0
    day_iter = first
    while day_iter < next_first:
        s = calculate_summary(session, day_iter)
        if s.computed_total is not None:
            computed_revenue += s.computed_total
            computed_days += 1
        day_iter = date_type.fromordinal(day_iter.toordinal() + 1)
    computed_revenue = _q(computed_revenue)

    # ---- Invoices by category ----
    rows = session.execute(
        select(Supplier.category, func.coalesce(func.sum(Invoice.amount_total), 0), func.count(Invoice.id))
        .join(Invoice, Invoice.supplier_id == Supplier.id)
        .where(Invoice.invoice_date >= first, Invoice.invoice_date < next_first)
        .group_by(Supplier.category)
    ).all()
    by_category_raw = {row[0]: (_q(row[1]), int(row[2])) for row in rows}

    categories = {}
    operating_total = ZERO
    for cat in (SupplierCategory.food, SupplierCategory.beverage, SupplierCategory.consumo):
        total, count = by_category_raw.get(cat, (ZERO, 0))
        pct_fiscal = _pct(total, fiscal_revenue)
        pct_computed = _pct(total, computed_revenue)
        categories[cat.value] = {
            "total": total,
            "invoices_count": count,
            "pct_fiscal": pct_fiscal,
            "pct_computed": pct_computed,
            "status": _status_for(threshold, pct_computed),
        }
        operating_total += total
    operating_total = _q(operating_total)

    operating = {
        "total": operating_total,
        "pct_fiscal": _pct(operating_total, fiscal_revenue),
        "pct_computed": _pct(operating_total, computed_revenue),
        "status": _status_for(threshold, _pct(operating_total, computed_revenue)),
    }

    return {
        "year": year,
        "month": month,
        "month_label": f"{MONTH_LABELS[month - 1]} {year}",
        "threshold_pct": threshold,
        "revenue": {
            "fiscal": fiscal_revenue,
            "computed": computed_revenue,
            "fiscal_days_count": fiscal_days,
            "computed_days_count": computed_days,
            "month_days_count": calendar.monthrange(year, month)[1],
        },
        "categories": categories,
        "operating_total": operating,
    }


def get_category_breakdown(session: Session, year: int, month: int, category: str) -> list[Invoice]:
    first, next_first = _month_range(year, month)
    return list(session.scalars(
        select(Invoice).join(Supplier, Invoice.supplier_id == Supplier.id)
        .where(Supplier.category == category)
        .where(Invoice.invoice_date >= first, Invoice.invoice_date < next_first)
        .order_by(Supplier.name, Invoice.invoice_date)
    ))
