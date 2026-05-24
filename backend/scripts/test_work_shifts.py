"""End-to-end test for work_shifts + monthly payroll + advances integration.

Setup: 1 manager + 3 staff con/senza hourly_rate. Inserisce 4 settimane di
turni di maggio 2026 + acconti maggio. Verifica calcolo lordo, integrazione
acconti (reference_month), permission staff/manager/admin.

Run from backend/:
    .venv/bin/python -m scripts.test_work_shifts
"""
from __future__ import annotations

import argparse
import getpass
import json
import ssl
import sys
import time
from datetime import date, timedelta
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
    import uuid
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
    print(f"=== Test work_shifts + payroll contro {base} ===")
    email = input("Admin email: ").strip().lower()
    password = getpass.getpass("Admin password: ")

    step(1, "POST /auth/login")
    s, b = http_call("POST", f"{base}/auth/login",
                      body={"email": email, "password": password})
    assert_status(s, 200, "login", b)
    admin_token = b["access_token"]
    admin_id = b["user"]["id"]

    tag = f"WS{int(time.time())}"
    luca_id = marco_id = sara_id = tommaso_id = None
    luca_token = marco_token = None
    shift_ids: list[int] = []
    advance_ids: list[int] = []

    try:
        # 2) Crea 4 utenti con tariffe diverse
        step(2, "POST /users — Luca (manager 12€/40h) + Marco (staff 10€/25h) + Sara (staff 10€/40h) + Tommaso (staff senza tariffa)")
        user_specs = [
            ("Luca",    "manager", "12.00", "40.00"),
            ("Marco",   "staff",   "10.00", "25.00"),
            ("Sara",    "staff",   "10.00", "40.00"),
            ("Tommaso", "staff",   None,    None),
        ]
        ids = {}
        for name, role, rate, contract in user_specs:
            body = {"email": f"{name.lower()}-{tag}@example.com",
                    "full_name": f"{name} Test {tag}",
                    "role": role, "password": "TestPass123"}
            if rate: body["hourly_rate"] = rate
            if contract: body["weekly_hours_contract"] = contract
            s, u = http_call("POST", f"{base}/users", body=body, token=admin_token)
            assert_status(s, 201, f"create {name}", u)
            ids[name] = u["id"]
            # Verifica admin VEDE hourly_rate (UserOutAdmin)
            if rate is not None and "hourly_rate" not in u:
                fatal(f"admin doveva vedere 'hourly_rate' in response, non c'è: {u}")
        luca_id, marco_id, sara_id, tommaso_id = ids["Luca"], ids["Marco"], ids["Sara"], ids["Tommaso"]
        print(f"  ✓ Luca={luca_id} Marco={marco_id} Sara={sara_id} Tommaso={tommaso_id}")

        # Login Luca (manager) + Marco (staff) per test permission
        s, b = http_call("POST", f"{base}/auth/login",
                          body={"email": f"luca-{tag}@example.com", "password": "TestPass123"})
        luca_token = b["access_token"]
        s, b = http_call("POST", f"{base}/auth/login",
                          body={"email": f"marco-{tag}@example.com", "password": "TestPass123"})
        marco_token = b["access_token"]

        # 3) Manager vede UserMini (no hourly_rate) su GET /users
        step(3, "Manager GET /users → NO hourly_rate nelle response")
        s, users = http_call("GET", f"{base}/users", token=luca_token)
        assert_status(s, 200, "list users as manager", users)
        for u in users:
            if "hourly_rate" in u or "weekly_hours_contract" in u:
                fatal(f"Manager NON deve vedere hourly_rate/weekly_hours_contract: {u}")
        print(f"  ✓ {len(users)} utenti, nessuno con campi payroll")

        # 4) POST /bulk per il 15 maggio: Luca 8h, Marco 5h, Sara 7h
        step(4, "POST /work-shifts/bulk 15/05/2026: Luca 8 + Marco 5 + Sara 7")
        s, shifts = http_call("POST", f"{base}/work-shifts/bulk",
                                body={"date": "2026-05-15", "shifts": [
                                    {"user_id": luca_id, "hours": "8.00"},
                                    {"user_id": marco_id, "hours": "5.00"},
                                    {"user_id": sara_id, "hours": "7.00"},
                                ]}, token=luca_token)
        assert_status(s, 200, "bulk insert", shifts)
        if len(shifts) != 3: fatal(f"attesi 3 turni, {len(shifts)}")
        shift_ids.extend([x["id"] for x in shifts])

        # 5) POST /bulk stesso giorno → upsert (Marco 5→6, aggiunge Tommaso 4)
        step(5, "Upsert: Marco 5→6 + Tommaso 4")
        s, shifts = http_call("POST", f"{base}/work-shifts/bulk",
                                body={"date": "2026-05-15", "shifts": [
                                    {"user_id": marco_id, "hours": "6.00"},
                                    {"user_id": tommaso_id, "hours": "4.00"},
                                ]}, token=luca_token)
        assert_status(s, 200, "bulk upsert", shifts)
        new_ids = [x["id"] for x in shifts if x["id"] not in shift_ids]
        shift_ids.extend(new_ids)

        # 6) POST turno per Amos (admin) → 400
        step(6, "POST turno per admin → 400")
        s, b = http_call("POST", f"{base}/work-shifts",
                          body={"date": "2026-05-15", "user_id": admin_id, "hours": "1.00"},
                          token=luca_token)
        if s != 400: fatal(f"atteso 400, ottenuto {s}")
        print(f"  ✓ rifiutato: {b.get('detail')}")

        # 7) hours fuori range
        step(7, "POST hours=15 → 422 + hours=4.3 → 422")
        s, b = http_call("POST", f"{base}/work-shifts",
                          body={"date": "2026-05-16", "user_id": marco_id, "hours": "15.00"},
                          token=luca_token)
        if s != 422: fatal(f"hours=15 atteso 422, ottenuto {s}")
        s, b = http_call("POST", f"{base}/work-shifts",
                          body={"date": "2026-05-16", "user_id": marco_id, "hours": "4.3"},
                          token=luca_token)
        if s != 422: fatal(f"hours=4.3 atteso 422, ottenuto {s}")
        print(f"  ✓ entrambi rifiutati")

        # 8) Staff Marco GET /work-shifts → solo i propri
        step(8, "Staff Marco GET /work-shifts → solo Marco")
        s, shifts = http_call("GET", f"{base}/work-shifts?from_date=2026-05-15&to_date=2026-05-15",
                               token=marco_token)
        assert_status(s, 200, "marco list", shifts)
        if len(shifts) != 1 or shifts[0]["user"]["id"] != marco_id:
            fatal(f"Staff doveva vedere solo Marco, ricevuto: {[s['user']['full_name'] for s in shifts]}")
        print(f"  ✓ staff vede solo {len(shifts)} turno (proprio)")

        # 9) Staff tenta POST → 403
        step(9, "Staff POST /work-shifts → 403")
        s, b = http_call("POST", f"{base}/work-shifts",
                          body={"date": "2026-05-16", "user_id": marco_id, "hours": "5.00"},
                          token=marco_token)
        if s != 403: fatal(f"atteso 403, ottenuto {s}")
        print(f"  ✓ bloccato")

        # 10) Setup 4 settimane di turni a maggio 2026 (4-31 maggio)
        # Le settimane in maggio 2026: lunedì 4, 11, 18, 25. Totale 4 settimane piene.
        step(10, "Seed 4 settimane maggio 2026 (Marco 6h×L-V=30h/sett × 4 = 120h; Sara 7h×L-V=35h × 4 = 140h; Luca 8h×L-V=40h × 4 = 160h; Tommaso 4h×L-V=20h × 4 = 80h)")
        # Reset dei turni del 15: li riaggiungiamo dentro al pattern settimanale.
        # Per semplicità sovrascriviamo tutto.
        # Genera ogni lunedì-venerdì dal 4 maggio al 29 maggio
        for week_offset in range(4):
            monday = date(2026, 5, 4) + timedelta(days=7 * week_offset)
            for weekday in range(5):  # L-V
                d = (monday + timedelta(days=weekday)).isoformat()
                s, shifts = http_call("POST", f"{base}/work-shifts/bulk",
                                        body={"date": d, "shifts": [
                                            {"user_id": luca_id, "hours": "8.00"},
                                            {"user_id": marco_id, "hours": "6.00"},
                                            {"user_id": sara_id, "hours": "7.00"},
                                            {"user_id": tommaso_id, "hours": "4.00"},
                                        ]}, token=admin_token)
                assert_status(s, 200, f"seed {d}", shifts)
                for x in shifts:
                    if x["id"] not in shift_ids: shift_ids.append(x["id"])
        print(f"  ✓ {len(shift_ids)} turni in totale (20gg × 4 = 80, qualcuno upsertato)")

        # 11) Weekly summary settimana 11-17 maggio: manager vede tutti SENZA contract/overtime specifici
        step(11, "Manager GET /weekly-summary settimana 11-17/05 → no contract/overtime specifico")
        s, rows = http_call("GET", f"{base}/work-shifts/weekly-summary?week_start=2026-05-11",
                              token=luca_token)
        assert_status(s, 200, "weekly manager", rows)
        for r in rows:
            if r.get("contract_hours") is not None or r.get("overtime_hours") is not None:
                fatal(f"Manager NON deve vedere contract/overtime specifici: {r}")
        print(f"  ✓ {len(rows)} dipendenti, nessuno con contract_hours/overtime_hours")

        # 12) Admin /weekly-summary stessa settimana → vede tutto
        step(12, "Admin GET /weekly-summary → vede contract+overtime; Marco overtime=5")
        s, rows = http_call("GET", f"{base}/work-shifts/weekly-summary?week_start=2026-05-11",
                              token=admin_token)
        assert_status(s, 200, "weekly admin", rows)
        marco_row = next((r for r in rows if r["user"]["id"] == marco_id), None)
        sara_row = next((r for r in rows if r["user"]["id"] == sara_id), None)
        if marco_row is None or not near(marco_row["overtime_hours"], 5.00):
            fatal(f"Marco overtime atteso 5h, ottenuto {marco_row['overtime_hours'] if marco_row else 'NULL'}")
        if sara_row is None or not near(sara_row["overtime_hours"], 0.00):
            fatal(f"Sara overtime atteso 0h, ottenuto {sara_row['overtime_hours']}")
        print(f"  ✓ Marco: {marco_row['total_hours']}h, overtime {marco_row['overtime_hours']}h · Sara: {sara_row['total_hours']}h, overtime {sara_row['overtime_hours']}h")

        # 13) Seed acconti per maggio (reference_month="2026-05")
        step(13, "Seed acconti Marco 50€ il 10/05 + 100€ il 22/05; Sara 80€ il 18/05 (ref_month=2026-05)")
        for uid, dt, amt, name in [
            (marco_id, "2026-05-10", "50.00", "Marco"),
            (marco_id, "2026-05-22", "100.00", "Marco"),
            (sara_id,  "2026-05-18", "80.00",  "Sara"),
        ]:
            mp_body, mp_ct = encode_multipart({
                "user_id": str(uid), "amount": amt,
                "service": "lunch", "date": dt,
                "reference_month": "2026-05",
            })
            s, adv = http_call("POST", f"{base}/advances",
                                body=mp_body, content_type=mp_ct, token=admin_token)
            assert_status(s, 201, f"acconto {name}", adv)
            advance_ids.append(adv["id"])

        # 14) Manager tenta GET /monthly-payroll → 403
        step(14, "Manager GET /monthly-payroll → 403")
        s, b = http_call("GET", f"{base}/work-shifts/monthly-payroll?year=2026&month=5", token=luca_token)
        if s != 403: fatal(f"atteso 403, ottenuto {s}")
        print(f"  ✓ bloccato")

        # 15) Admin GET /monthly-payroll
        step(15, "Admin GET /monthly-payroll maggio 2026")
        s, payroll = http_call("GET", f"{base}/work-shifts/monthly-payroll?year=2026&month=5", token=admin_token)
        assert_status(s, 200, "monthly payroll", payroll)
        rows_by_id = {r["user"]["id"]: r for r in payroll["by_user"]}
        # Marco: 120h, gross 1200, advances 150, net 1050
        r = rows_by_id[marco_id]
        if not near(r["total_hours"], 120.00): fatal(f"Marco hours atteso 120, ott {r['total_hours']}")
        if not near(r["gross_amount"], 1200.00): fatal(f"Marco gross atteso 1200, ott {r['gross_amount']}")
        if not near(r["advances_taken"], 150.00): fatal(f"Marco advances atteso 150, ott {r['advances_taken']}")
        if not near(r["net_to_pay"], 1050.00): fatal(f"Marco net atteso 1050, ott {r['net_to_pay']}")
        if not r["has_unsettled_advances"]: fatal("Marco doveva avere acconti non saldati")
        # Sara: 140h, gross 1400, advances 80, net 1320
        r = rows_by_id[sara_id]
        if not near(r["total_hours"], 140.00): fatal(f"Sara hours atteso 140, ott {r['total_hours']}")
        if not near(r["net_to_pay"], 1320.00): fatal(f"Sara net atteso 1320, ott {r['net_to_pay']}")
        # Luca: 160h, gross 1920, advances 0, net 1920
        r = rows_by_id[luca_id]
        if not near(r["total_hours"], 160.00): fatal(f"Luca hours atteso 160, ott {r['total_hours']}")
        if not near(r["gross_amount"], 1920.00): fatal(f"Luca gross atteso 1920, ott {r['gross_amount']}")
        # Tommaso: 80h, no rate
        r = rows_by_id[tommaso_id]
        if not near(r["total_hours"], 80.00): fatal(f"Tommaso hours atteso 80, ott {r['total_hours']}")
        if r["gross_amount"] is not None: fatal(f"Tommaso gross doveva essere null, ott {r['gross_amount']}")
        if not r["needs_configuration"]: fatal(f"Tommaso doveva avere needs_configuration=true")
        # Totali
        t = payroll["totals"]
        if not near(t["total_hours"], 500.00): fatal(f"total_hours atteso 500, ott {t['total_hours']}")
        if not near(t["total_gross"], 4520.00): fatal(f"total_gross atteso 4520, ott {t['total_gross']}")
        if not near(t["total_advances"], 230.00): fatal(f"total_advances atteso 230, ott {t['total_advances']}")
        if not near(t["total_net"], 4290.00): fatal(f"total_net atteso 4290, ott {t['total_net']}")
        print(f"  ✓ totali: hours={t['total_hours']} gross={t['total_gross']} advances={t['total_advances']} net={t['total_net']}")

        # 16) Admin settle-advances per Marco
        step(16, "Admin POST /monthly-payroll/{marco_id}/settle-advances → 2 acconti saldati per 150€")
        s, res = http_call("POST", f"{base}/work-shifts/monthly-payroll/{marco_id}/settle-advances?year=2026&month=5",
                            token=admin_token)
        assert_status(s, 200, "settle marco", res)
        if res["settled_count"] != 2 or not near(res["total_settled_amount"], 150.00):
            fatal(f"settled atteso 2/150, ottenuto {res}")
        # Verifica monthly-payroll: Marco ora ha advances_settled_in_month=150, has_unsettled=false
        s, payroll = http_call("GET", f"{base}/work-shifts/monthly-payroll?year=2026&month=5", token=admin_token)
        r = next((x for x in payroll["by_user"] if x["user"]["id"] == marco_id), None)
        if not near(r["advances_settled_in_month"], 150.00):
            fatal(f"Marco advances_settled_in_month atteso 150, ott {r['advances_settled_in_month']}")
        if r["has_unsettled_advances"]:
            fatal(f"Marco doveva avere has_unsettled_advances=false")
        print(f"  ✓ Marco saldato: settled_in_month={r['advances_settled_in_month']}")

        print("\n✅ Tutti i check sono passati.")

    finally:
        print("\n— Cleanup —")
        def safe(label, fn):
            try: fn()
            except Exception as e: print(f"  ⚠ {label}: {e}")
        # Delete shifts (admin: any date)
        for sid in shift_ids:
            safe(f"delete shift {sid}", lambda sid=sid: http_call(
                "DELETE", f"{base}/work-shifts/{sid}", token=admin_token))
        # Unsettle + delete advances
        for aid in advance_ids:
            safe(f"unsettle {aid}", lambda aid=aid: http_call(
                "POST", f"{base}/advances/{aid}/unsettle", token=admin_token))
            safe(f"delete advance {aid}", lambda aid=aid: http_call(
                "DELETE", f"{base}/advances/{aid}", token=admin_token))
        # Deactivate users
        for uid, name in [(luca_id, "Luca"), (marco_id, "Marco"),
                          (sara_id, "Sara"), (tommaso_id, "Tommaso")]:
            if uid:
                safe(f"deactivate {name}", lambda uid=uid: http_call(
                    "PATCH", f"{base}/users/{uid}", body={"active": False}, token=admin_token))
        print(f"  cleanup ok (tag {tag})")


if __name__ == "__main__":
    main()
