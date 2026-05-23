"""End-to-end test for /alerts.

Covers the routes that can be exercised with the seeded admin user:
    1. Login as admin
    2. Create 2 suppliers + 3 products (2 with preferred_supplier A,
       1 with preferred_supplier B, 1 without supplier)
    3. POST /alerts for each product (4 total alerts)
    4. POST /alerts again on the first product with status_signaled=out
       → expect SAME id (escalation, not insert)
    5. GET /alerts/open → expect 3 groups (supplier A, supplier B, None)
    6. PATCH /alerts/{id} → update suggested_qty
    7. POST /alerts/{id}/ignore → status becomes ignored
    8. GET /alerts?status=ignored → confirm; GET /open is one less

The "staff 403 on /open" path requires a non-admin user; deferred to
the user-management prompt.

Run from backend/:
    .venv/bin/python -m scripts.test_alerts
    .venv/bin/python -m scripts.test_alerts --base-url <URL>
"""
from __future__ import annotations

import argparse
import getpass
import json
import ssl
import sys
import time
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


def http_call(method, url, *, body=None, token=None, timeout=30.0):
    headers = {"Accept": "application/json"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
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


def step(i, label): print(f"\n[{i}] {label}")
def fatal(msg): sys.exit(f"  ❌ {msg}")
def assert_status(actual, expected, label, body=None):
    if actual != expected:
        fatal(f"{label}: atteso {expected}, ottenuto {actual} (body={body})")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:8000")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    print(f"=== Test /alerts contro {base} ===")
    email = input("Admin email: ").strip().lower()
    password = getpass.getpass("Admin password: ")

    step(1, "POST /auth/login")
    status, body = http_call("POST", f"{base}/auth/login",
                              body={"email": email, "password": password})
    assert_status(status, 200, "login", body)
    token = body["access_token"]

    tag = f"ALERT{int(time.time())}"
    supplier_ids: list[int] = []
    product_ids: list[int] = []
    created_alert_ids: list[int] = []

    try:
        # 2) Suppliers
        step(2, "POST /suppliers x2")
        for name in [f"{tag} Cantine A", f"{tag} Forneria B"]:
            s, b = http_call("POST", f"{base}/suppliers",
                              body={"name": name}, token=token)
            assert_status(s, 201, "supplier create", b)
            supplier_ids.append(b["id"])
        print(f"  suppliers={supplier_ids}")

        # 3) Products: P1, P2 → supplier A; P3 → supplier B; P4 → no supplier
        step(3, "POST /products x4")
        prods_payload = [
            {"name": f"{tag} Primitivo", "unit": "bottiglia", "preferred_supplier_id": supplier_ids[0]},
            {"name": f"{tag} Negroamaro", "unit": "bottiglia", "preferred_supplier_id": supplier_ids[0]},
            {"name": f"{tag} Focaccia",   "unit": "pz",        "preferred_supplier_id": supplier_ids[1]},
            {"name": f"{tag} Olive sfuse", "unit": "kg"},  # no supplier
        ]
        for pp in prods_payload:
            s, b = http_call("POST", f"{base}/products", body=pp, token=token)
            assert_status(s, 201, f"product create {pp['name']!r}", b)
            product_ids.append(b["id"])
        print(f"  products={product_ids}")

        # 4) 4 alerts, one per product
        step(4, "POST /alerts x4 (uno per prodotto)")
        for i, pid in enumerate(product_ids):
            s, b = http_call("POST", f"{base}/alerts",
                              body={"product_id": pid, "status_signaled": "low",
                                    "suggested_qty": 5 + i,
                                    "notes": f"test {tag} #{i+1}"},
                              token=token)
            assert_status(s, 201, f"alert create p={pid}", b)
            created_alert_ids.append(b["id"])
            if b["status_signaled"] != "low":
                fatal(f"atteso status_signaled=low, ottenuto {b['status_signaled']}")
        print(f"  alert_ids={created_alert_ids}")

        # 5) Re-POST on product 1 with status_signaled=out → must escalate, no new row
        step(5, "POST /alerts (duplicato sul P1, status=out) → escalation, stesso id")
        s, b = http_call("POST", f"{base}/alerts",
                          body={"product_id": product_ids[0],
                                "status_signaled": "out",
                                "notes": f"escalated {tag}"},
                          token=token)
        assert_status(s, 201, "alert escalation", b)
        if b["id"] != created_alert_ids[0]:
            fatal(f"duplicato ha creato nuovo id={b['id']} (atteso {created_alert_ids[0]})")
        if b["status_signaled"] != "out":
            fatal(f"escalation: atteso out, ottenuto {b['status_signaled']}")
        if "escalated" not in (b["notes"] or ""):
            fatal(f"notes non aggiornati: {b['notes']!r}")
        print(f"  ✓ alert id={b['id']} ora status_signaled={b['status_signaled']!r}")

        # 6) Re-POST on product 1 again, now status=low → must NOT demote
        step(6, "POST /alerts (P1 di nuovo, status=low) → non deve retrocedere")
        s, b = http_call("POST", f"{base}/alerts",
                          body={"product_id": product_ids[0],
                                "status_signaled": "low"},
                          token=token)
        assert_status(s, 201, "alert no-demote", b)
        if b["status_signaled"] != "out":
            fatal(f"demoted! atteso out, ottenuto {b['status_signaled']}")
        print(f"  ✓ status_signaled resta 'out' (no demote)")

        # 7) GET /open — 3 gruppi: A (2 alert), B (1), Senza fornitore (1)
        step(7, "GET /alerts/open — atteso 3 gruppi")
        s, groups = http_call("GET", f"{base}/alerts/open", token=token)
        assert_status(s, 200, "list open", groups)
        ours = [g for g in groups if any(a["id"] in created_alert_ids for a in g["alerts"])]
        if len(ours) < 3:
            fatal(f"attesi ≥3 gruppi col nostro tag, trovati {len(ours)}")
        # Confirm the no-supplier bucket exists
        no_sup = [g for g in ours if g["supplier"] is None]
        if not no_sup:
            fatal("gruppo 'Senza fornitore' mancante")
        # Confirm 2 alerts under supplier A
        sup_a_id = supplier_ids[0]
        sup_a_group = next((g for g in ours if g["supplier"] and g["supplier"]["id"] == sup_a_id), None)
        if sup_a_group is None or len(sup_a_group["alerts"]) < 2:
            fatal(f"gruppo supplier A: atteso ≥2 alert, trovato {sup_a_group}")
        print(f"  ✓ {len(ours)} gruppi col tag: A={len(sup_a_group['alerts'])} alert, senza-supplier={len(no_sup[0]['alerts'])}")

        # 8) PATCH /alerts/{id} — update suggested_qty
        step(8, f"PATCH /alerts/{created_alert_ids[1]} — suggested_qty 6 → 12")
        s, b = http_call("PATCH", f"{base}/alerts/{created_alert_ids[1]}",
                          body={"suggested_qty": "12"}, token=token)
        assert_status(s, 200, "patch", b)
        if float(b["suggested_qty"]) != 12.0:
            fatal(f"suggested_qty non aggiornato: {b['suggested_qty']}")
        print(f"  ✓ suggested_qty = {b['suggested_qty']}")

        # 9) /ignore — chiude un alert
        step(9, f"POST /alerts/{created_alert_ids[3]}/ignore")
        s, b = http_call("POST", f"{base}/alerts/{created_alert_ids[3]}/ignore", token=token)
        assert_status(s, 200, "ignore", b)
        if b["status"] != "ignored":
            fatal(f"status atteso 'ignored', ottenuto {b['status']}")
        print(f"  ✓ alert id={b['id']} status={b['status']}")

        # 10) GET /open dopo l'ignore → 1 alert in meno tra i nostri
        step(10, "GET /alerts/open dopo l'ignore — l'ignored sparisce")
        s, groups = http_call("GET", f"{base}/alerts/open", token=token)
        assert_status(s, 200, "list open #2", groups)
        ours_now = [a for g in groups for a in g["alerts"] if a["id"] in created_alert_ids]
        if len(ours_now) != 3:
            fatal(f"attesi 3 alert open dei nostri (1 ignored), trovati {len(ours_now)}")
        print(f"  ✓ {len(ours_now)} dei nostri alert sono ancora open")

        # 11) GET /alerts?status=ignored — confirm filter
        step(11, "GET /alerts?status=ignored — filtro per stato")
        s, b = http_call("GET", f"{base}/alerts?status=ignored", token=token)
        assert_status(s, 200, "filter ignored", b)
        if not any(a["id"] == created_alert_ids[3] for a in b):
            fatal("l'alert ignorato non compare nel filter")
        print(f"  ✓ filter funziona")

        print("\n✅ Tutti i check sono passati.")

    finally:
        print("\n— Cleanup —")
        def safe(label, fn):
            try: fn()
            except Exception as e: print(f"  ⚠ {label}: {e}")

        # Ignore remaining open alerts (no DELETE endpoint per spec)
        for aid in created_alert_ids:
            safe(f"ignore alert {aid}", lambda aid=aid: http_call(
                "POST", f"{base}/alerts/{aid}/ignore", token=token,
            ))
        # Soft-delete products (active=false — FK RESTRICT from alerts is fine
        # because soft-delete doesn't touch the row)
        for pid in product_ids:
            safe(f"delete product {pid}", lambda pid=pid: http_call(
                "DELETE", f"{base}/products/{pid}", token=token,
            ))
        for sid in supplier_ids:
            safe(f"delete supplier {sid}", lambda sid=sid: http_call(
                "DELETE", f"{base}/suppliers/{sid}", token=token,
            ))
        print(f"  cleanup ok (tag {tag})")


if __name__ == "__main__":
    main()
