"""/cash-export router: CSV export of daily summaries for the accountant."""
from __future__ import annotations

import csv
import io
import logging
from datetime import date as date_type
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import require_manager_or_admin
from app.models.cash import DailySummary
from app.models.users import User
from app.services.cash import calculate_summary

router = APIRouter(prefix="/cash-export", tags=["cash-export"])
logger = logging.getLogger("amodei.cash_export")

CSV_HEADERS = [
    "data",
    "pos_pranzo",
    "pos_cena",
    "cash_pranzo",
    "cash_totale",
    "spese_totali",
    "calcolato",
    "fiscale",
    "ipratico",
    "scostamento_fiscale",
    "scostamento_ipratico",
    "status",
]


def _fmt(value: Decimal | None) -> str:
    """Format a Decimal money value with Italian comma. Empty when missing."""
    if value is None:
        return ""
    return f"{value:.2f}".replace(".", ",")


@router.get("/csv")
def export_csv(
    from_date: date_type = Query(alias="from"),
    to_date: date_type = Query(alias="to"),
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> StreamingResponse:
    """CSV with one row per day in [from, to]. Days without a summary row are skipped."""
    if to_date < from_date:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "from non può essere successiva a to.")

    rows = list(session.scalars(
        select(DailySummary)
        .where(DailySummary.date >= from_date)
        .where(DailySummary.date <= to_date)
        .order_by(DailySummary.date.asc())
    ))

    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";", quoting=csv.QUOTE_MINIMAL)
    writer.writerow(CSV_HEADERS)
    for r in rows:
        s = calculate_summary(session, r.date)
        writer.writerow([
            s.date.isoformat(),
            _fmt(s.pos_lunch),
            _fmt(s.pos_dinner),
            _fmt(s.cash_lunch_above_float),
            _fmt(s.cash_above_float),
            _fmt(s.expenses_total),
            _fmt(s.computed_total),
            _fmt(s.fiscal_total),
            _fmt(s.ipratico_total),
            _fmt(s.delta_fiscal),
            _fmt(s.delta_ipratico),
            s.status,
        ])

    filename = f"amodei_cassa_{from_date.isoformat()}_{to_date.isoformat()}.csv"
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
