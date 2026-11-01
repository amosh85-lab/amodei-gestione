"""/foodcost router: monthly dashboard + breakdown + 6-month trend."""
from __future__ import annotations

from datetime import date as date_type
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import require_manager_or_admin
from app.models.inventory import Supplier
from app.models.users import User
from app.services.foodcost import (
    calculate_foodcost,
    get_category_breakdown,
    get_unbilled_ddts_breakdown,
)

router = APIRouter(prefix="/foodcost", tags=["foodcost"])


@router.get("/monthly")
def monthly_foodcost(
    year: int | None = Query(None, ge=2024, le=2100),
    month: int | None = Query(None, ge=1, le=12),
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> dict:
    today = date_type.today()
    return calculate_foodcost(session, year or today.year, month or today.month)


@router.get("/monthly/breakdown")
def monthly_breakdown(
    category: Literal["food", "beverage", "consumo"] = Query(...),
    year: int | None = Query(None, ge=2024, le=2100),
    month: int | None = Query(None, ge=1, le=12),
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> list[dict]:
    """Dettaglio per fornitore di cosa compone il food cost del mese: ogni
    riga (`items`) è una fattura ("invoice", invoice_date) o un DDT non
    ancora fatturato ("ddt", ddt_date) — mai entrambi per lo stesso importo,
    vedi calculate_foodcost."""
    today = date_type.today()
    y, m = year or today.year, month or today.month
    invoices = get_category_breakdown(session, y, m, category)
    unbilled_ddts = get_unbilled_ddts_breakdown(session, y, m, category)

    by_supplier: dict[int, dict] = {}

    def _bucket(supplier_id: int) -> dict:
        if supplier_id not in by_supplier:
            supplier = session.get(Supplier, supplier_id)
            by_supplier[supplier_id] = {
                "supplier": {
                    "id": supplier.id, "name": supplier.name,
                    "category": supplier.category.value if hasattr(supplier.category, "value") else supplier.category,
                },
                "total": 0.0, "count": 0, "items": [],
            }
        return by_supplier[supplier_id]

    for inv in invoices:
        b = _bucket(inv.supplier_id)
        b["total"] += float(inv.amount_total)
        b["count"] += 1
        b["items"].append({
            "kind": "invoice", "id": inv.id, "number": inv.invoice_number,
            "date": inv.invoice_date, "amount_total": inv.amount_total,
        })
    for d in unbilled_ddts:
        b = _bucket(d.supplier_id)
        b["total"] += float(d.amount_total)
        b["count"] += 1
        b["items"].append({
            "kind": "ddt", "id": d.id, "number": d.ddt_number,
            "date": d.ddt_date, "amount_total": d.amount_total,
        })

    for b in by_supplier.values():
        b["items"].sort(key=lambda it: it["date"], reverse=True)

    return sorted(by_supplier.values(), key=lambda r: r["total"], reverse=True)


@router.get("/trend")
def trend(
    months: int = Query(6, ge=1, le=12),
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> list[dict]:
    """N most recent months including current. One row per month with the
    food cost % per category basato sull'INCASSO REALE (pct_computed), per il
    grafico (line chart, 4 series)."""
    today = date_type.today()
    out = []
    y, m = today.year, today.month
    series: list[tuple[int, int]] = []
    for _ in range(months):
        series.insert(0, (y, m))
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    for (yr, mo) in series:
        data = calculate_foodcost(session, yr, mo)
        cats = data["categories"]
        out.append({
            "year": yr,
            "month": mo,
            "month_label": data["month_label"],
            "food_pct": cats["food"]["pct_computed"],
            "beverage_pct": cats["beverage"]["pct_computed"],
            "consumo_pct": cats["consumo"]["pct_computed"],
            "operating_pct": data["operating_total"]["pct_computed"],
        })
    return out
