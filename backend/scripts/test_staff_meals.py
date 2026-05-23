"""End-to-end test for /staff-meals.

Walks the single-participant path that can be tested with just the admin
user from seed (no other user exists yet):

    1. Login as admin
    2. Create test supplier + product (kg)
    3. POST /batches → carico 5 kg @ 4.00 €/kg (so we have stock)
    4. POST /staff-meals (admin pranzo, 1.5 kg) → expect 201 + cost = 6.00
    5. GET /staff-meals → the meal appears, cost_total > 0
    6. Verify product qty_total decreased by 1.5
    7. GET /staff-meals/stats/monthly → meal counted in totals
    8. DELETE /staff-meals/{id} → marks cancelled, restores stock
    9. Verify product qty_total back to pre-meal value
    10. Cleanup: rettifica batch to 0, soft-delete product + supplier

The "staff-self-only" and "manager creates for N people" paths require a
second user; defer to a future user-management prompt.

Run from backend/:
    .venv/bin/python -m scripts.test_staff_meals
    .venv/bin/python -m scripts.test_staff_meals --base-url <URL>
"""
from __future__ import annotations

import argparse
import getpass
import json
import ssl
import sys
import time
from datetime import date
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


def http_call(method: str, url: str, *, body=None, content_type=None, token=None, timeout=30.0) -> tuple[int, Any]:
    headers = {"Accept": "application/json"}
    data = None
    if body is not None:
        if isinstance(body, (bytes, bytearray)):
            data = bytes(body)
        else:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
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
    import uuid
    boundary = "----amodei-" + uuid.uuid4().hex
    body = bytearray()
    for name, value in fields.items():
        body += f"--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
        body += str(value).encode() + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    return bytes(body), f"multipart/form-data; boundary={boundary}"


def step(i, label):
    print(f"\n[{i}] {label}")


def fatal(msg):
    sys.exit(f"  ❌ {msg}")


def assert_status(actual, expected, label, body=None):
    if actual != expected:
        fatal(f"{label}: atteso {expected}, ottenuto {actual} (body={body})")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:8000")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    print(f"=== Test /staff-meals contro {base} ===")
    email = input("Admin email: ").strip().lower()
    password = getpass.getpass("Admin password: ")

    # 1) Login
    step(1, "POST /auth/login")
    status, body = http_call("POST", f"{base}/auth/login",
                              body={"email": email, "password": password})
    assert_status(status, 200, "login", body)
    token = body["access_token"]
    me_id = body["user"]["id"]

    tag = f"STAFFM{int(time.time())}"
    supplier_id = product_id = batch_id = meal_id = None

    try:
        # 2) Supplier
        step(2, "POST /suppliers")
        status, body = http_call("POST", f"{base}/suppliers",
                                  body={"name": f"{tag} Caseificio"}, token=token)
        assert_status(status, 201, "supplier create", body)
        supplier_id = body["id"]
        print(f"  supplier id={supplier_id}")

        # 3) Product
        step(3, "POST /products")
        status, body = http_call("POST", f"{base}/products",
                                  body={"name": f"{tag} Mozzarella test",
                                        "unit": "kg", "sale_price": "9.50",
                                        "vat_rate": "iva_10",
                                        "preferred_supplier_id": supplier_id},
                                  token=token)
        assert_status(status, 201, "product create", body)
        product_id = body["id"]
        print(f"  product id={product_id}")

        # 4) Batch carico
        step(4, "POST /batches — 5 kg @ 4.00 €/kg")
        mp_body, mp_ct = encode_multipart({
            "product_id": str(product_id),
            "supplier_id": str(supplier_id),
            "initial_qty": "5",
            "purchase_price_unit": "4.00",
            "load_date": date.today().isoformat(),
        })
        status, body = http_call("POST", f"{base}/batches",
                                  body=mp_body, content_type=mp_ct, token=token)
        assert_status(status, 201, "batch create", body)
        batch_id = body["id"]
        print(f"  batch id={batch_id} initial=5 kg price=4.0000")

        # 5) Verifica qty_total = 5
        step(5, f"GET /products/{product_id} pre-pasto")
        status, body = http_call("GET", f"{base}/products/{product_id}", token=token)
        assert_status(status, 200, "product detail", body)
        if abs(float(body["qty_total"]) - 5.0) > 0.001:
            fatal(f"atteso qty_total=5.0, ottenuto {body['qty_total']}")
        print(f"  ✓ qty_total = {body['qty_total']} kg")

        # 6) POST /staff-meals — admin pranzo 1.5 kg
        step(6, "POST /staff-meals — admin pranzo 1.5 kg")
        status, body = http_call("POST", f"{base}/staff-meals",
                                  body={"service": "lunch",
                                        "participant_user_ids": [me_id],
                                        "items": [{"product_id": product_id, "qty": "1.5"}],
                                        "notes": f"test {tag}"},
                                  token=token)
        assert_status(status, 201, "staff-meal create", body)
        meal_id = body["id"]
        cost_total = float(body["cost_total"])
        expected_cost = 1.5 * 4.0
        if abs(cost_total - expected_cost) > 0.001:
            fatal(f"cost_total atteso {expected_cost}, ottenuto {cost_total}")
        print(f"  ✓ meal id={meal_id} cost_total = € {cost_total} (1.5 × 4.00)")

        # 7) Verifica qty_total = 3.5
        step(7, "GET /products/{id} post-pasto — atteso 3.5 kg")
        status, body = http_call("GET", f"{base}/products/{product_id}", token=token)
        if abs(float(body["qty_total"]) - 3.5) > 0.001:
            fatal(f"atteso qty_total=3.5, ottenuto {body['qty_total']}")
        print(f"  ✓ qty_total dopo pasto = {body['qty_total']} kg")

        # 8) GET /staff-meals — il pasto compare con cost > 0
        step(8, "GET /staff-meals?from=today — il pasto è nella lista")
        today_iso = date.today().isoformat()
        status, body = http_call("GET", f"{base}/staff-meals?from={today_iso}&to={today_iso}", token=token)
        assert_status(status, 200, "staff-meals list", body)
        ours = [m for m in body if m["id"] == meal_id]
        if not ours:
            fatal(f"pasto {meal_id} non in lista")
        print(f"  ✓ {len(body)} pasti totali oggi (almeno il nostro)")

        # 9) GET /staff-meals/stats/monthly
        step(9, "GET /staff-meals/stats/monthly — conteggio + costo")
        status, body = http_call("GET", f"{base}/staff-meals/stats/monthly", token=token)
        assert_status(status, 200, "stats", body)
        if body["total_meals"] < 1 or float(body["total_cost"]) <= 0:
            fatal(f"stats vuote o costo zero: {body}")
        print(f"  ✓ stats month: {body['total_meals']} pasti, costo € {body['total_cost']}")

        # 10) DELETE meal — restore stock
        step(10, f"DELETE /staff-meals/{meal_id} — annulla pasto, ripristina scorte")
        status, body = http_call("DELETE", f"{base}/staff-meals/{meal_id}", token=token)
        assert_status(status, 200, "cancel meal", body)
        if not body.get("cancelled_at"):
            fatal(f"meal non marcato cancelled_at: {body}")
        print(f"  ✓ meal annullato alle {body['cancelled_at']}")

        # 11) Verifica qty_total tornato a 5
        step(11, "GET /products/{id} post-annullamento — atteso 5 kg")
        status, body = http_call("GET", f"{base}/products/{product_id}", token=token)
        if abs(float(body["qty_total"]) - 5.0) > 0.001:
            fatal(f"atteso qty_total=5.0 dopo annullamento, ottenuto {body['qty_total']}")
        print(f"  ✓ qty_total ripristinato = {body['qty_total']} kg")

        print("\n✅ Tutti i check sono passati.")

    finally:
        print("\n— Cleanup —")
        def safe(label, fn):
            try: fn()
            except Exception as e: print(f"  ⚠ {label}: {e}")

        if product_id:
            # Zero the batch via rettifica then soft-delete product
            safe("rettifica batch", lambda: http_call(
                "POST", f"{base}/movements/rettifica",
                body={"batch_id": batch_id, "new_qty": "0", "reason": f"cleanup {tag}"},
                token=token,
            ))
            safe("delete product", lambda: http_call(
                "DELETE", f"{base}/products/{product_id}", token=token,
            ))
        if supplier_id:
            safe("delete supplier", lambda: http_call(
                "DELETE", f"{base}/suppliers/{supplier_id}", token=token,
            ))
        print(f"  cleanup ok (tag {tag})")


if __name__ == "__main__":
    main()
