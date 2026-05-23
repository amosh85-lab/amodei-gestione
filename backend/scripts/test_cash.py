"""End-to-end test of cash routers + calculate_summary.

Reproduces the numerical example from the spec:

    Setting cash_float    = 100,00 €
    POS pranzo            = 312,00 €
    POS cena              = 535,50 €
    Spese pranzo          = 18 + 15 = 33,00 €
    Spese cena            = 18,50 + 8 + 6,30 = 32,80 €
    Spese totali          = 65,80 €
    Cash a fine serata    = 362,70 €

Atteso:
    cash_above_float = max(0, 362,70 - 100)       = 262,70 €
    cash_incassato   = 262,70 + 65,80             = 328,50 €
    computed_total   = 312 + 535,50 + 328,50      = 1.176,00 €
    delta_fiscal     = 1.176,00 - 1.176,00        = 0,00      → match
    delta_ipratico   = 1.173,50 - 1.176,00        = −2,50     → warn

Inoltre verifica:
    * Snapshot del cash_float: dopo aver chiuso il summary, cambio il
      setting da 100 a 120 e il GET sul summary chiuso continua a
      mostrare cash_float=100.

Cleanup: rimuove la sessioni POS, le spese, e il summary di test.
NB: usa la data di OGGI ⇒ se hai già aperto un summary oggi lo
script lo modifica, e cleanup riporta i totali a null.

Run from backend/:
    .venv/bin/python -m scripts.test_cash
    .venv/bin/python -m scripts.test_cash --base-url <URL>
"""
from __future__ import annotations

import argparse
import getpass
import json
import ssl
import sys
import time
import uuid
from datetime import date
from decimal import Decimal
from typing import Any
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError


def _ssl_ctx() -> ssl.SSLContext | None:
    try:
        import certifi
    except ImportError:
        return None
    return ssl.create_default_context(cafile=certifi.where())


SSL_CTX = _ssl_ctx()


def http_call(method, url, *, body=None, content_type=None, token=None, timeout=30.0):
    headers = {"Accept": "application/json"}
    data = None
    if body is not None:
        if isinstance(body, (bytes, bytearray)):
            data = bytes(body)
        else:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body, default=str).encode()
    if content_type:
        headers["Content-Type"] = content_type
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urlrequest.Request(url, data=data, method=method, headers=headers)
    open_kwargs: dict[str, Any] = {"timeout": timeout}
    if url.startswith("https://") and SSL_CTX is not None:
        open_kwargs["context"] = SSL_CTX
    try:
        with urlrequest.urlopen(req, **open_kwargs) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw) if raw else None
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try: parsed = json.loads(raw)
        except json.JSONDecodeError: parsed = {"raw": raw}
        return exc.code, parsed
    except URLError as exc:
        sys.exit(f"Errore di rete verso {url}: {exc.reason}")


def encode_multipart(fields: dict[str, str]) -> tuple[bytes, str]:
    boundary = "----amodei-" + uuid.uuid4().hex
    body = bytearray()
    for name, value in fields.items():
        body += f"--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
        body += str(value).encode() + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    return bytes(body), f"multipart/form-data; boundary={boundary}"


def step(i, label): print(f"\n[{i}] {label}")
def fatal(msg): sys.exit(f"  ❌ {msg}")
def assert_status(actual, expected, label, body=None):
    if actual != expected:
        fatal(f"{label}: atteso {expected}, ottenuto {actual} (body={body})")


def near(a, b, tol=Decimal("0.005")):
    return abs(Decimal(str(a)) - Decimal(str(b))) <= tol


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:8000")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    print(f"=== Test cassa contro {base} ===")
    email = input("Admin email: ").strip().lower()
    password = getpass.getpass("Admin password: ")

    step(1, "POST /auth/login")
    status, body = http_call("POST", f"{base}/auth/login",
                              body={"email": email, "password": password})
    assert_status(status, 200, "login", body)
    token = body["access_token"]

    today = date.today().isoformat()
    tag = f"CASH{int(time.time())}"
    pos_lunch_id = pos_dinner_id = None
    expense_ids: list[int] = []
    cat_id: int | None = None
    original_float: Decimal | None = None
    summary_existed = None  # remember if summary existed before test

    try:
        # 0) Save current cash_float so we can restore it
        step(2, "Leggo cash_float corrente (per restore)")
        status, body = http_call("GET", f"{base}/settings/cash-float", token=token)
        if status == 200:
            original_float = Decimal(str(body["value"]))
            print(f"  cash_float corrente = {original_float}")

        # Set cash_float = 100 (potrebbe già esserlo dal seed)
        step(3, "PATCH /settings/cash_float = 100")
        status, body = http_call("PATCH", f"{base}/settings/cash_float",
                                  body={"value": "100.00"}, token=token)
        assert_status(status, 200, "patch cash_float", body)
        if Decimal(body["value"]) != Decimal("100.00"):
            fatal(f"value non aggiornato: {body['value']}")

        # 4) Trova / crea una expense category per i test
        step(4, "Lista expense categories")
        status, cats = http_call("GET", f"{base}/expense-categories", token=token)
        assert_status(status, 200, "list categories", cats)
        if cats:
            cat_id = cats[0]["id"]
            print(f"  uso categoria id={cat_id} ({cats[0]['name']})")
        else:
            status, body = http_call("POST", f"{base}/expense-categories",
                                      body={"name": f"{tag} TestCat"}, token=token)
            assert_status(status, 201, "create category", body)
            cat_id = body["id"]
            print(f"  creata categoria id={cat_id}")

        # 5) Reset PosSession del giorno (se esistono già)
        step(5, "Reset eventuali POS sessions di oggi")
        status, existing = http_call("GET", f"{base}/pos-sessions?date={today}", token=token)
        if status == 200:
            for s in existing or []:
                http_call("DELETE", f"{base}/pos-sessions/{s['id']}", token=token)
                print(f"  cancellata POS session id={s['id']}")

        # 6) POS pranzo 312, cena 535,50
        step(6, "POST POS pranzo 312 + cena 535,50")
        s, b = http_call("POST", f"{base}/pos-sessions",
                          body={"date": today, "service": "lunch", "closing_amount": "312.00"},
                          token=token)
        assert_status(s, 201, "POS lunch", b); pos_lunch_id = b["id"]
        s, b = http_call("POST", f"{base}/pos-sessions",
                          body={"date": today, "service": "dinner", "closing_amount": "535.50"},
                          token=token)
        assert_status(s, 201, "POS dinner", b); pos_dinner_id = b["id"]

        # 7) Spese pranzo 18 + 15
        step(7, "POST 5 spese (pranzo 18+15 / cena 18,50+8+6,30)")
        for amount, service, descr in [
            ("18.00", "lunch",  "Frutta"),
            ("15.00", "lunch",  "Pane"),
            ("18.50", "dinner", "Verdura"),
            ("8.00",  "dinner", "Limoni"),
            ("6.30",  "dinner", "Cancelleria"),
        ]:
            mp_body, mp_ct = encode_multipart({
                "category_id": str(cat_id),
                "description": descr,
                "amount": amount,
                "service": service,
                "date": today,
            })
            s, b = http_call("POST", f"{base}/expenses",
                              body=mp_body, content_type=mp_ct, token=token)
            assert_status(s, 201, f"expense {descr}", b)
            expense_ids.append(b["id"])

        # 8) GET /daily-summary/today PRIMA di inserire cash_total
        step(8, "GET /daily-summary/today — verifica pos/expenses, cash null")
        s, summary = http_call("GET", f"{base}/daily-summary/today", token=token)
        assert_status(s, 200, "daily today", summary)
        for k, expected in [("pos_lunch", 312.00), ("pos_dinner", 535.50),
                            ("expenses_lunch", 33.00), ("expenses_dinner", 32.80),
                            ("expenses_total", 65.80)]:
            if not near(summary[k], expected):
                fatal(f"{k} atteso {expected}, ottenuto {summary[k]}")
        if summary["cash_incassato"] is not None or summary["computed_total"] is not None:
            fatal("cash_incassato/computed devono essere null PRIMA del cash_total")
        if summary["status"] != "open":
            fatal(f"status atteso 'open', ottenuto {summary['status']}")
        print(f"  ✓ POS+expenses aggregati; status=open; cash_float={summary['cash_float']}")

        # 9) PATCH cash_total_end_of_day = 362,70 → snapshot cash_float
        step(9, "PATCH cash_total_end_of_day = 362,70 → cash_incassato=328,50, computed=1.176,00")
        s, summary = http_call("PATCH", f"{base}/daily-summary/{today}",
                                body={"cash_total_end_of_day": "362.70"}, token=token)
        assert_status(s, 200, "patch cash", summary)
        for k, expected in [("cash_above_float", 262.70),
                            ("cash_incassato", 328.50),
                            ("computed_total", 1176.00)]:
            if not near(summary[k], expected):
                fatal(f"{k} atteso {expected}, ottenuto {summary[k]}")
        if summary["status"] != "partial":
            fatal(f"status atteso 'partial', ottenuto {summary['status']}")
        if not near(summary["cash_float"], 100.00):
            fatal(f"cash_float atteso 100.00, ottenuto {summary['cash_float']}")
        print(f"  ✓ cash_above={summary['cash_above_float']} · "
              f"cash_incassato={summary['cash_incassato']} · "
              f"computed={summary['computed_total']} · status={summary['status']}")

        # 10) PATCH fiscale 1.176,00 → match (delta_fiscal=0)
        step(10, "PATCH fiscal_total = 1.176,00 → delta_fiscal = 0")
        s, summary = http_call("PATCH", f"{base}/daily-summary/{today}",
                                body={"fiscal_total": "1176.00"}, token=token)
        if not near(summary["delta_fiscal"], 0.00):
            fatal(f"delta_fiscal atteso 0,00, ottenuto {summary['delta_fiscal']}")
        print(f"  ✓ delta_fiscal = {summary['delta_fiscal']}")

        # 11) PATCH ipratico 1.173,50 → delta = −2,50
        step(11, "PATCH ipratico_total = 1.173,50 → delta_ipratico = −2,50, status=closed")
        s, summary = http_call("PATCH", f"{base}/daily-summary/{today}",
                                body={"ipratico_total": "1173.50"}, token=token)
        if not near(summary["delta_ipratico"], -2.50):
            fatal(f"delta_ipratico atteso -2,50, ottenuto {summary['delta_ipratico']}")
        if not near(summary["delta_fiscal_ipratico"], 2.50):
            fatal(f"delta_fiscal_ipratico atteso 2,50, ottenuto {summary['delta_fiscal_ipratico']}")
        if summary["status"] != "closed":
            fatal(f"status atteso 'closed', ottenuto {summary['status']}")
        if not summary.get("closed_at"):
            fatal("closed_at non valorizzato dopo i 3 totali")
        print(f"  ✓ delta_ipratico={summary['delta_ipratico']} · "
              f"delta_fiscal_ipratico={summary['delta_fiscal_ipratico']} · "
              f"closed_at={summary['closed_at']}")

        # 12) Snapshot: cambio setting cash_float a 120 → summary chiuso resta 100
        step(12, "PATCH cash_float = 120 → GET summary chiuso continua a vedere 100")
        s, _ = http_call("PATCH", f"{base}/settings/cash_float",
                          body={"value": "120.00"}, token=token)
        assert_status(s, 200, "patch float 120", None)
        s, summary = http_call("GET", f"{base}/daily-summary/{today}", token=token)
        assert_status(s, 200, "re-get summary", summary)
        if not near(summary["cash_float"], 100.00):
            fatal(f"snapshot non funziona: atteso 100, ottenuto {summary['cash_float']}")
        # Anche i derivati devono restare gli stessi (cash_above = 262.70)
        if not near(summary["cash_above_float"], 262.70):
            fatal(f"cash_above invariato atteso, ottenuto {summary['cash_above_float']}")
        print(f"  ✓ snapshot ok: cash_float resta {summary['cash_float']} anche con setting={summary['cash_float']}≠120")

        print("\n✅ Tutti i check sono passati.")

    finally:
        print("\n— Cleanup —")
        def safe(label, fn):
            try: fn()
            except Exception as e: print(f"  ⚠ {label}: {e}")

        # Restore cash_float
        if original_float is not None:
            safe("restore cash_float", lambda: http_call(
                "PATCH", f"{base}/settings/cash_float",
                body={"value": f"{original_float}"}, token=token,
            ))
        # Delete spese, POS sessions
        for eid in expense_ids:
            safe(f"delete expense {eid}", lambda eid=eid: http_call(
                "DELETE", f"{base}/expenses/{eid}", token=token,
            ))
        for pid in (pos_lunch_id, pos_dinner_id):
            if pid:
                safe(f"delete POS {pid}", lambda pid=pid: http_call(
                    "DELETE", f"{base}/pos-sessions/{pid}", token=token,
                ))
        # Reset DailySummary di oggi (rimuovo i totali manuali + closed_at via SQL non disponibile;
        # NON c'è endpoint per cancellare la row; lascio i null tornare on next compute. Resta una
        # riga orfana ma è benigna: la prossima volta che apri /today la riga viene riusata.)
        # Best-effort: rimuovo i totali via PATCH (cash_total, fiscal, ipratico = null).
        safe("reset summary totals", lambda: http_call(
            "PATCH", f"{base}/daily-summary/{today}",
            body={"cash_total_end_of_day": None, "fiscal_total": None,
                  "ipratico_total": None, "notes": None},
            token=token,
        ))
        print(f"  cleanup ok (tag {tag})")


if __name__ == "__main__":
    main()
