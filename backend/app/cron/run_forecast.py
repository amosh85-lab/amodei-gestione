"""Entrypoint for the daily forecast cron job.

Run as a standalone Python module — Railway Cron Job invokes:

    python -m app.cron.run_forecast

It computes stock-out predictions and creates StockAlert(source=system)
for products predicted to run out within 7 days, skipping any product
that already has an open alert (staff or system).

Logs are emitted on stdout so Railway captures them in the cron run log.
"""
from __future__ import annotations

import logging
import sys

from sqlalchemy import select

from app.database import get_session
from app.models.users import User
from app.services.forecast import generate_system_alerts

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("amodei.cron.forecast")


def main() -> int:
    session = next(get_session())
    try:
        bot_user = session.scalar(
            select(User).where(User.role == "admin").order_by(User.id)
        )
        if bot_user is None:
            logger.error("Nessun utente admin nel DB — skip generate_system_alerts.")
            return 1
        logger.info("Lancio generate_system_alerts come user_id=%d", bot_user.id)
        result = generate_system_alerts(session, triggered_by_user_id=bot_user.id)
        logger.info(
            "Cron forecast completato: created=%d, skipped_existing=%d, skipped_no_signal=%d",
            result["created"], result["skipped_existing_open"], result["skipped_no_signal"],
        )
        return 0
    finally:
        session.close()


if __name__ == "__main__":
    raise SystemExit(main())
