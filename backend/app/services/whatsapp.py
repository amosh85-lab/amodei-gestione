"""WhatsApp deep-link helpers — message template + wa.me URL."""
from __future__ import annotations

import re
import urllib.parse
from datetime import date as date_type
from decimal import Decimal
from typing import Iterable, TypedDict


DEFAULT_TEMPLATE = (
    "Ciao {supplier_name}, ordine per Amodei Wine Bar:\n"
    "\n"
    "{lines}\n"
    "\n"
    "Grazie!"
)


class LineInput(TypedDict):
    """One line as fed to :func:`build_message`. Keep this dict-shape rather
    than the ORM object so the service stays decoupled from SQLAlchemy."""

    qty: Decimal | float | int
    unit: str
    product_name: str


def _fmt_qty(qty) -> str:
    n = Decimal(qty)
    if n == n.to_integral_value():
        return str(int(n))
    s = f"{n:.2f}"
    # strip trailing zeros / dot to keep "1.5" instead of "1.50"
    return s.rstrip("0").rstrip(".")


def build_message(
    supplier_name: str,
    lines: Iterable[LineInput],
    *,
    custom_template: str | None = None,
    today: date_type | None = None,
) -> str:
    """Compose the WhatsApp body for a supplier order.

    If ``custom_template`` is provided (typically ``supplier.message_template``),
    use it with the placeholders ``{supplier_name}``, ``{lines}``, ``{date}``.
    Otherwise use the Amodei default template.
    """
    lines_str = "\n".join(
        f"- {_fmt_qty(li['qty'])} {li['unit']} {li['product_name']}".rstrip()
        for li in lines
    )
    tpl = custom_template if custom_template else DEFAULT_TEMPLATE
    today = today or date_type.today()
    try:
        return tpl.format(
            supplier_name=supplier_name,
            lines=lines_str,
            date=today.strftime("%d/%m/%Y"),
        )
    except (KeyError, IndexError):
        # Bad custom template — fall back to default rather than 500.
        return DEFAULT_TEMPLATE.format(
            supplier_name=supplier_name,
            lines=lines_str,
            date=today.strftime("%d/%m/%Y"),
        )


def build_whatsapp_url(phone: str | None, message: str) -> str | None:
    """Build a ``https://wa.me/<digits>?text=<encoded>`` link.

    ``phone`` may be in any common format (``+39 333 1112233``,
    ``333-111-2233``, …) — only ASCII digits survive. Returns ``None`` if
    we don't have enough digits to dial.
    """
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if len(digits) < 7:  # too short to be a real phone
        return None
    encoded = urllib.parse.quote(message, safe="")
    return f"https://wa.me/{digits}?text={encoded}"
