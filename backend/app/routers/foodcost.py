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
from app.schemas.invoices import InvoiceMini
from app.services.foodcost import calculate_foodcost, get_category_breakdown

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
    today = date_type.today()
    invoices = get_category_breakdown(session, year or today.year, month or today.month, category)
    by_supplier: dict[int, dict] = {}
    for inv in invoices:
        sid = inv.supplier_id
        if sid not in by_supplier:
            supplier = session.get(Supplier, sid)
            by_supplier[sid] = {
                "supplier": {
                    "id": supplier.id, "name": supplier.name,
                    "category": supplier.category.value if hasattr(supplier.category, "value") else supplier.category,
                },
                "total": 0, "count": 0, "invoices": [],
            }
        by_supplier[sid]["total"] = float(by_supplier[sid]["total"]) + float(inv.amount_total)
        by_supplier[sid]["count"] += 1
        by_supplier[sid]["invoices"].append(InvoiceMini(
            id=inv.id, invoice_number=inv.invoice_number,
            invoice_date=inv.invoice_date, amount_total=inv.amount_total,
        ))
    return sorted(by_supplier.values(), key=lambda r: r["total"], reverse=True)


@router.get("/trend")
def trend(
    months: int = Query(6, ge=1, le=12),
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> list[dict]:
    """N most recent months including current. One row per month with pct_fiscal
    per category for chart consumption (line chart, 4 series)."""
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
            "food_pct": cats["food"]["pct_fiscal"],
            "beverage_pct": cats["beverage"]["pct_fiscal"],
            "consumo_pct": cats["consumo"]["pct_fiscal"],
            "operating_pct": data["operating_total"]["pct_fiscal"],
        })
    return out
