"""End-to-end test of /advances router + cash math with advances.

Scenario (adapted to Prompt 14 model: lunch+dinner above_float NETTO,
plus the Prompt 18.x advances additive):

    POS pranzo     = 312,00 €    POS cena       = 535,50 €
    Spese pranzo   = 33,00 €     Spese cena     = 32,80 €
    cash_lunch_above_float  = 280,00 €
    cash_dinner_above_float = 250,00 €
    Acconto Marco (staff, pranzo) = 50,00 €
    Acconto Sara  (staff, cena)   = 100,00 €

Attesi:
    advances_total = 150,00 €
    cash_lunch_incassato  = 280 + 33 + 50            = 363,00 €
    partial_lunch         = 312 + 363                = 675,00 €
    cash_dinner_incassato = 250 + 32,80 + 100        = 382,80 €
    partial_dinner        = 535,50 + 382,80          = 918,30 €
    cash_above_float      = 280 + 250                = 530,00 €
    cash_incassato        = 530 + 65,80 + 150        = 745,80 €
    computed_total        = 847,50 + 745,80          = 1.593,30 €
    Invariante: partial_lunch + partial_dinner == computed_total

(*) NB: il prompt usa la math vecchia "stesso totale di 1176" che presuppone
il vecchio cash_total_end_of_day. Adattato al modello attuale, gli acconti
SOMMANO al computed (perché cash_above è già al netto e dichiarato a parte).

Cleanup: rimuove POS, spese, acconti, summary, utenti staff di test.

Run from backend/:
    .venv/bin/python -m scripts.test_advances
    .venv/bin/python -m scripts.test_advances --base-url <URL>
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


def _ssl_ctx():
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
    print(f"=== Test acconti contro {base} ===")
    email = input("Admin email: ").strip().lower()
    password = getpass.getpass("Admin password: ")

    step(1, "POST /auth/login")
    status, body = http_call("POST", f"{base}/auth/login",
                              body={"email": email, "password": password})
    assert_status(status, 200, "login", body)
    admin_token = body["access_token"]
    admin_id = body["user"]["id"]

    today = date.today().isoformat()
    tag = f"ADV{int(time.time())}"
    marco_id = sara_id = None
    pos_lunch_id = pos_dinner_id = None
    expense_ids: list[int] = []
    advance_ids: list[int] = []
    staff_token: str | None = None

    try:
        # 2) Crea 2 utenti staff di test (Marco e Sara)
        step(2, "POST /users — crea Marco (staff) e Sara (staff)")
        for label, email_user in [("Marco", f"marco-{tag}@example.com"),
                                   ("Sara",  f"sara-{tag}@example.com")]:
            s, u = http_call("POST", f"{base}/users",
                              body={"email": email_user, "full_name": f"{label} Test {tag}",
                                    "role": "staff", "password": "TestPass123"},
                              token=admin_token)
            assert_status(s, 201, f"create {label}", u)
            if label == "Marco": marco_id = u["id"]
            else: sara_id = u["id"]
            print(f"  ✓ {label} id={u['id']}")

        # 3) Login Marco (per test 403 sullo staff)
        step(3, "POST /auth/login come Marco (staff)")
        s, b = http_call("POST", f"{base}/auth/login",
                          body={"email": f"marco-{tag}@example.com", "password": "TestPass123"})
        assert_status(s, 200, "login marco", b)
        staff_token = b["access_token"]

        # 4) Staff non può accedere ad alcun endpoint /advances
        step(4, "GET /advances come staff → 403")
        s, b = http_call("GET", f"{base}/advances", token=staff_token)
        if s != 403:
            fatal(f"Staff doveva ricevere 403, ottenuto {s}")
        print(f"  ✓ staff bloccato (403)")

        # 5) Acconto verso admin → 400 (regola di business)
        step(5, "POST /advances verso admin → 400")
        mp_body, mp_ct = encode_multipart({
            "user_id": str(admin_id), "amount": "30.00",
            "service": "lunch", "date": today,
        })
        s, b = http_call("POST", f"{base}/advances",
                          body=mp_body, content_type=mp_ct, token=admin_token)
        if s != 400:
            fatal(f"Atteso 400 per acconto-ad-admin, ottenuto {s} (body={b})")
        print(f"  ✓ rifiutato: {b.get('detail')}")

        # 6) Acconti validi (Marco pranzo 50, Sara cena 100)
        step(6, "POST /advances Marco (pranzo 50€) + Sara (cena 100€)")
        for label, uid, amount, service in [
            ("Marco", marco_id, "50.00", "lunch"),
            ("Sara",  sara_id,  "100.00", "dinner"),
        ]:
            mp_body, mp_ct = encode_multipart({
                "user_id": str(uid), "amount": amount,
                "service": service, "date": today,
                "notes": f"Test {tag}",
            })
            s, adv = http_call("POST", f"{base}/advances",
                                body=mp_body, content_type=mp_ct, token=admin_token)
            assert_status(s, 201, f"create advance {label}", adv)
            advance_ids.append(adv["id"])
            print(f"  ✓ {label} acconto id={adv['id']} amount={adv['amount']}€")

        # 7) GET /advances/by-employee — verifica raggruppamento
        step(7, "GET /advances/by-employee?settled=false → 2 dipendenti")
        s, rows = http_call("GET", f"{base}/advances/by-employee?settled=false", token=admin_token)
        assert_status(s, 200, "by-employee", rows)
        if len(rows) < 2:
            fatal(f"attesi almeno 2 dipendenti, ottenuti {len(rows)}")
        names = sorted([r["user"]["full_name"] for r in rows
                        if r["user"]["id"] in (marco_id, sara_id)])
        if len(names) != 2:
            fatal(f"Marco e Sara non entrambi presenti: {names}")
        print(f"  ✓ dipendenti con acconti aperti: {names}")

        # 8) Setup scenario cassa (POS + spese)
        step(8, "Setup POS pranzo/cena + 5 spese (come scenario standard)")
        # POS
        for service, amount in [("lunch", "312.00"), ("dinner", "535.50")]:
            s, p = http_call("POST", f"{base}/pos-sessions",
                              body={"date": today, "service": service, "closing_amount": amount},
                              token=admin_token)
            assert_status(s, 201, f"pos {service}", p)
            if service == "lunch": pos_lunch_id = p["id"]
            else: pos_dinner_id = p["id"]
        # First active category
        s, cats = http_call("GET", f"{base}/expense-categories?active=true", token=admin_token)
        assert_status(s, 200, "expense categories", cats)
        if not cats:
            fatal("Nessuna categoria spese attiva nel DB — crea almeno una.")
        cat_id = cats[0]["id"]
        # 5 spese
        for amount, service, descr in [
            ("18.00", "lunch", "Frutta"), ("15.00", "lunch", "Pane"),
            ("18.50", "dinner", "Verdura"), ("8.00", "dinner", "Limoni"),
            ("6.30", "dinner", "Cancelleria"),
        ]:
            mp_body, mp_ct = encode_multipart({
                "category_id": str(cat_id), "description": f"{descr} {tag}",
                "amount": amount, "service": service, "date": today,
            })
            s, e = http_call("POST", f"{base}/expenses",
                              body=mp_body, content_type=mp_ct, token=admin_token)
            assert_status(s, 201, f"expense {descr}", e)
            expense_ids.append(e["id"])

        # 9) PATCH cash_lunch_above_float = 280 + cash_dinner_above_float = 250
        step(9, "PATCH cash above lunch/dinner")
        s, summary = http_call("PATCH", f"{base}/daily-summary/{today}",
                                body={"cash_lunch_above_float": "280.00",
                                      "cash_dinner_above_float": "250.00"},
                                token=admin_token)
        assert_status(s, 200, "patch cash", summary)

        # 10) Verifica math finale
        step(10, "GET /daily-summary/today — verifica math con acconti")
        s, summary = http_call("GET", f"{base}/daily-summary/today", token=admin_token)
        assert_status(s, 200, "get today", summary)
        checks = [
            ("advances_lunch",        50.00),
            ("advances_dinner",       100.00),
            ("advances_total",        150.00),
            ("cash_lunch_incassato",  363.00),   # 280 + 33 + 50
            ("partial_lunch",         675.00),   # 312 + 363
            ("cash_dinner_incassato", 382.80),   # 250 + 32,80 + 100
            ("partial_dinner",        918.30),   # 535,50 + 382,80
            ("cash_above_float",      530.00),   # 280 + 250
            ("cash_incassato",        745.80),   # 530 + 65,80 + 150
            ("computed_total",        1593.30),  # 847,50 + 745,80
        ]
        for k, expected in checks:
            if not near(summary[k], expected):
                fatal(f"{k} atteso {expected}, ottenuto {summary[k]}")
        # Invariante somma parziali == computed
        sum_partials = float(summary["partial_lunch"]) + float(summary["partial_dinner"])
        if not near(sum_partials, summary["computed_total"]):
            fatal(f"partial_lunch+partial_dinner ({sum_partials}) ≠ computed_total ({summary['computed_total']})")
        print(f"  ✓ partial_lunch={summary['partial_lunch']} + partial_dinner={summary['partial_dinner']} = computed={summary['computed_total']}")

        # 11) Settle entrambi gli acconti come payroll 2026-05
        step(11, "POST /advances/settle — paga in busta 2026-05")
        s, res = http_call("POST", f"{base}/advances/settle",
                            body={"advance_ids": advance_ids, "payroll_month": "2026-05"},
                            token=admin_token)
        assert_status(s, 200, "settle", res)
        if res["settled_count"] != 2 or res["skipped_count"] != 0:
            fatal(f"atteso settled=2 skipped=0, ottenuto {res}")
        print(f"  ✓ settled={res['settled_count']} skipped={res['skipped_count']}")

        # 12) Verifica /summary/monthly — total_settled = 150
        step(12, "GET /advances/summary/monthly?year=2026&month=5")
        s, summ = http_call("GET", f"{base}/advances/summary/monthly?year=2026&month=5", token=admin_token)
        assert_status(s, 200, "monthly summary", summ)
        if not near(summ["total_amount_settled"], 150.00):
            fatal(f"total_amount_settled atteso 150, ottenuto {summ['total_amount_settled']}")
        print(f"  ✓ total_amount_settled mese 2026-05 = {summ['total_amount_settled']}€")

        # 13) DELETE su un acconto saldato → 400
        step(13, "DELETE acconto saldato → 400")
        s, b = http_call("DELETE", f"{base}/advances/{advance_ids[0]}", token=admin_token)
        if s != 400:
            fatal(f"atteso 400 su delete settled, ottenuto {s}")
        print(f"  ✓ delete rifiutato (saldato)")

        # 14) POST /unsettle → torna a unsettled → DELETE OK
        step(14, "POST /unsettle + DELETE")
        s, _ = http_call("POST", f"{base}/advances/{advance_ids[0]}/unsettle", token=admin_token)
        assert_status(s, 200, "unsettle", _)
        s, _ = http_call("DELETE", f"{base}/advances/{advance_ids[0]}", token=admin_token)
        assert_status(s, 200, "delete after unsettle", _)
        advance_ids.pop(0)  # already deleted
        print(f"  ✓ unsettle + delete OK")

        print("\n✅ Tutti i check sono passati.")

    finally:
        print("\n— Cleanup —")
        def safe(label, fn):
            try: fn()
            except Exception as e: print(f"  ⚠ {label}: {e}")

        # Reset summary cash fields
        safe("reset summary", lambda: http_call(
            "PATCH", f"{base}/daily-summary/{today}",
            body={"cash_lunch_above_float": None, "cash_dinner_above_float": None,
                  "fiscal_total": None, "ipratico_total": None, "notes": None},
            token=admin_token,
        ))
        # Delete remaining advances (manually unsettle first if needed)
        for aid in advance_ids:
            safe(f"unsettle {aid}", lambda aid=aid: http_call(
                "POST", f"{base}/advances/{aid}/unsettle", token=admin_token))
            safe(f"delete advance {aid}", lambda aid=aid: http_call(
                "DELETE", f"{base}/advances/{aid}", token=admin_token))
        for eid in expense_ids:
            safe(f"delete expense {eid}", lambda eid=eid: http_call(
                "DELETE", f"{base}/expenses/{eid}", token=admin_token))
        for pid in (pos_lunch_id, pos_dinner_id):
            if pid:
                safe(f"delete POS {pid}", lambda pid=pid: http_call(
                    "DELETE", f"{base}/pos-sessions/{pid}", token=admin_token))
        # Deactivate test staff users (cannot delete because of FK)
        for uid, label in [(marco_id, "Marco"), (sara_id, "Sara")]:
            if uid:
                safe(f"deactivate {label}", lambda uid=uid: http_call(
                    "PATCH", f"{base}/users/{uid}", body={"active": False}, token=admin_token))
        print(f"  cleanup ok (tag {tag})")


if __name__ == "__main__":
    main()
