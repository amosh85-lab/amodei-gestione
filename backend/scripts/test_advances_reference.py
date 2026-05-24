"""End-to-end test for reference_month logic on /advances.

Scenario: a Marco viene dato un acconto il 3 giugno riferito alla busta
di MAGGIO (che si pagherà il 10 giugno), e altri 2 acconti dati a giugno
riferiti alla busta di GIUGNO.

Verifica:
- POST con/senza reference_month (default basato su date)
- Validazione regex (2026-13 rifiutato)
- /summary/monthly distingue total_amount_for_month vs total_amount_given_in_month
- /by-employee raggruppato per reference_month → user

Run from backend/:
    .venv/bin/python -m scripts.test_advances_reference
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


def encode_multipart(fields):
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
    print(f"=== Test reference_month contro {base} ===")
    email = input("Admin email: ").strip().lower()
    password = getpass.getpass("Admin password: ")

    step(1, "POST /auth/login")
    s, b = http_call("POST", f"{base}/auth/login",
                      body={"email": email, "password": password})
    assert_status(s, 200, "login", b)
    admin_token = b["access_token"]

    tag = f"REF{int(time.time())}"
    marco_id = sara_id = None
    advance_ids: list[int] = []

    try:
        # 1) Crea Marco + Sara come staff di test
        step(2, "POST /users — Marco + Sara (staff)")
        for label, email_user in [("Marco", f"marco-{tag}@example.com"),
                                   ("Sara",  f"sara-{tag}@example.com")]:
            s, u = http_call("POST", f"{base}/users",
                              body={"email": email_user, "full_name": f"{label} {tag}",
                                    "role": "staff", "password": "TestPass123"},
                              token=admin_token)
            assert_status(s, 201, f"create {label}", u)
            if label == "Marco": marco_id = u["id"]
            else: sara_id = u["id"]

        # 2) Acconto Marco 03/06 con reference_month="2026-05" (per MAGGIO)
        step(3, "Acconto Marco 03/06/2026 €100 per MAGGIO 2026")
        mp_body, mp_ct = encode_multipart({
            "user_id": str(marco_id), "amount": "100.00",
            "service": "dinner", "date": "2026-06-03",
            "reference_month": "2026-05", "notes": "Anticipo busta maggio",
        })
        s, adv = http_call("POST", f"{base}/advances",
                            body=mp_body, content_type=mp_ct, token=admin_token)
        assert_status(s, 201, "create marco-may", adv)
        advance_ids.append(adv["id"])
        if adv["reference_month"] != "2026-05":
            fatal(f"reference_month atteso 2026-05, ottenuto {adv['reference_month']}")
        if adv["reference_month_label"] != "Maggio 2026":
            fatal(f"label atteso 'Maggio 2026', ottenuto {adv['reference_month_label']}")
        print(f"  ✓ ref_month={adv['reference_month']} label='{adv['reference_month_label']}'")

        # 3) Acconto Marco 20/06 per GIUGNO
        step(4, "Acconto Marco 20/06/2026 €50 per GIUGNO 2026")
        mp_body, mp_ct = encode_multipart({
            "user_id": str(marco_id), "amount": "50.00",
            "service": "lunch", "date": "2026-06-20",
            "reference_month": "2026-06",
        })
        s, adv = http_call("POST", f"{base}/advances",
                            body=mp_body, content_type=mp_ct, token=admin_token)
        assert_status(s, 201, "create marco-jun", adv)
        advance_ids.append(adv["id"])

        # 4) Acconto Sara 25/06 per GIUGNO
        step(5, "Acconto Sara 25/06/2026 €80 per GIUGNO 2026")
        mp_body, mp_ct = encode_multipart({
            "user_id": str(sara_id), "amount": "80.00",
            "service": "dinner", "date": "2026-06-25",
            "reference_month": "2026-06",
        })
        s, adv = http_call("POST", f"{base}/advances",
                            body=mp_body, content_type=mp_ct, token=admin_token)
        assert_status(s, 201, "create sara-jun", adv)
        advance_ids.append(adv["id"])

        # 5) Default: POST senza reference_month, date=2026-06-05 (≤10)
        step(6, "POST senza ref_month, date=2026-06-05 → default 2026-05")
        mp_body, mp_ct = encode_multipart({
            "user_id": str(marco_id), "amount": "10.00",
            "service": "lunch", "date": "2026-06-05",
        })
        s, adv = http_call("POST", f"{base}/advances",
                            body=mp_body, content_type=mp_ct, token=admin_token)
        assert_status(s, 201, "default low-day", adv)
        advance_ids.append(adv["id"])
        if adv["reference_month"] != "2026-05":
            fatal(f"default day<=10 atteso 2026-05, ottenuto {adv['reference_month']}")
        print(f"  ✓ default day=5 → ref_month=2026-05")

        # 6) Default: POST senza reference_month, date=2026-06-20 (>10)
        step(7, "POST senza ref_month, date=2026-06-20 → default 2026-06")
        mp_body, mp_ct = encode_multipart({
            "user_id": str(sara_id), "amount": "10.00",
            "service": "lunch", "date": "2026-06-20",
        })
        s, adv = http_call("POST", f"{base}/advances",
                            body=mp_body, content_type=mp_ct, token=admin_token)
        assert_status(s, 201, "default high-day", adv)
        advance_ids.append(adv["id"])
        if adv["reference_month"] != "2026-06":
            fatal(f"default day>10 atteso 2026-06, ottenuto {adv['reference_month']}")
        print(f"  ✓ default day=20 → ref_month=2026-06")

        # 7) Validazione regex: 2026-13 → 422
        step(8, "POST con reference_month='2026-13' → 422")
        mp_body, mp_ct = encode_multipart({
            "user_id": str(marco_id), "amount": "10.00",
            "service": "lunch", "date": "2026-06-05",
            "reference_month": "2026-13",
        })
        s, b = http_call("POST", f"{base}/advances",
                          body=mp_body, content_type=mp_ct, token=admin_token)
        if s != 422:
            fatal(f"atteso 422 su 2026-13, ottenuto {s}")
        print(f"  ✓ rifiutato 2026-13")

        # 8) /summary/monthly per MAGGIO 2026
        step(9, "GET /summary/monthly?year=2026&month=5")
        s, summ = http_call("GET", f"{base}/advances/summary/monthly?year=2026&month=5", token=admin_token)
        assert_status(s, 200, "summary may", summ)
        # for_month maggio = 100 (Marco-may) + 10 (default low-day Marco) = 110
        if not near(summ["total_amount_for_month"], 110.00):
            fatal(f"for_month maggio atteso 110, ottenuto {summ['total_amount_for_month']}")
        # given_in_month maggio = 0 (nessun acconto con date in maggio)
        if not near(summ["total_amount_given_in_month"], 0.00):
            fatal(f"given_in_month maggio atteso 0, ottenuto {summ['total_amount_given_in_month']}")
        print(f"  ✓ maggio: for_month={summ['total_amount_for_month']} given_in_month={summ['total_amount_given_in_month']}")

        # 9) /summary/monthly per GIUGNO 2026
        step(10, "GET /summary/monthly?year=2026&month=6")
        s, summ = http_call("GET", f"{base}/advances/summary/monthly?year=2026&month=6", token=admin_token)
        assert_status(s, 200, "summary jun", summ)
        # for_month giugno = 50 (Marco-jun) + 80 (Sara-jun) + 10 (default high-day Sara) = 140
        if not near(summ["total_amount_for_month"], 140.00):
            fatal(f"for_month giugno atteso 140, ottenuto {summ['total_amount_for_month']}")
        # given_in_month giugno = 100 + 50 + 80 + 10 + 10 = 250
        if not near(summ["total_amount_given_in_month"], 250.00):
            fatal(f"given_in_month giugno atteso 250, ottenuto {summ['total_amount_given_in_month']}")
        print(f"  ✓ giugno: for_month={summ['total_amount_for_month']} given_in_month={summ['total_amount_given_in_month']}")
        # Differenza: 250 - 140 = 110 = totale acconti dati a giugno ma per maggio. Coerente.
        diff = float(summ["total_amount_given_in_month"]) - float(summ["total_amount_for_month"])
        if not near(diff, 110.00):
            fatal(f"differenza giugno given-for attesa 110 (acconti dati giu per mag), ottenuta {diff}")
        print(f"  ✓ differenza given−for = {diff:.2f}€ (acconti dati a giugno per busta maggio)")

        # 10) /by-employee raggruppato per reference_month
        step(11, "GET /advances/by-employee → 2 gruppi (2026-05, 2026-06)")
        s, resp = http_call("GET", f"{base}/advances/by-employee", token=admin_token)
        assert_status(s, 200, "by-employee", resp)
        groups = resp["by_reference_month"]
        if len(groups) != 2:
            fatal(f"attesi 2 gruppi (may, jun), ottenuti {len(groups)}")
        # Maggio prima (ordering ASC), Giugno dopo
        if groups[0]["reference_month"] != "2026-05" or groups[1]["reference_month"] != "2026-06":
            fatal(f"ordine gruppi sbagliato: {[g['reference_month'] for g in groups]}")
        if groups[0]["label"] != "Maggio 2026":
            fatal(f"label maggio atteso 'Maggio 2026', ottenuto '{groups[0]['label']}'")
        if not near(groups[0]["total_amount"], 110.00):
            fatal(f"totale maggio atteso 110, ottenuto {groups[0]['total_amount']}")
        if not near(groups[1]["total_amount"], 140.00):
            fatal(f"totale giugno atteso 140, ottenuto {groups[1]['total_amount']}")
        print(f"  ✓ gruppi: {[(g['label'], float(g['total_amount'])) for g in groups]}")

        print("\n✅ Tutti i check sono passati.")

    finally:
        print("\n— Cleanup —")
        def safe(label, fn):
            try: fn()
            except Exception as e: print(f"  ⚠ {label}: {e}")
        for aid in advance_ids:
            safe(f"delete advance {aid}", lambda aid=aid: http_call(
                "DELETE", f"{base}/advances/{aid}", token=admin_token))
        for uid, label in [(marco_id, "Marco"), (sara_id, "Sara")]:
            if uid:
                safe(f"deactivate {label}", lambda uid=uid: http_call(
                    "PATCH", f"{base}/users/{uid}", body={"active": False}, token=admin_token))
        print(f"  cleanup ok (tag {tag})")


if __name__ == "__main__":
    main()
