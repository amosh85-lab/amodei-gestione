"""End-to-end test for /supplier-orders + WhatsApp deep link.

Covers:
    1. Login as admin
    2. Create supplier + 3 products + 3 open alerts
    3. POST /supplier-orders with all 3 alerts linked → draft order,
       alerts flipped to "included_in_order"
    4. GET /supplier-orders/{id} → verify whatsapp_url uses wa.me/<digits>
       and text= contains url-encoded message
    5. Patch supplier.message_template → verify whatsapp_message_preview
       changes accordingly
    6. POST /{id}/mark-sent → status=sent, sent_at present,
       whatsapp_message_generated snapshot saved
    7. POST /{id}/mark-received → status=received, received_at present
    8. Cancel a *new* draft → linked alerts go back to "open"
    9. DELETE on a *new* draft (admin) → row gone, alerts released

Cleanup: ignore remaining open alerts, soft-delete products + supplier.

Run from backend/:
    .venv/bin/python -m scripts.test_orders
    .venv/bin/python -m scripts.test_orders --base-url <URL>
"""
from __future__ import annotations

import argparse
import getpass
import json
import ssl
import sys
import time
import urllib.parse
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


def http_call(method, url, *, body=None, token=None, timeout=30.0, expect_json=True):
    headers = {"Accept": "application/json" if expect_json else "*/*"}
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
            if not expect_json:
                return resp.status, raw
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
    print(f"=== Test /supplier-orders contro {base} ===")
    email = input("Admin email: ").strip().lower()
    password = getpass.getpass("Admin password: ")

    step(1, "POST /auth/login")
    status, body = http_call("POST", f"{base}/auth/login",
                              body={"email": email, "password": password})
    assert_status(status, 200, "login", body)
    token = body["access_token"]

    tag = f"ORD{int(time.time())}"
    supplier_id = None
    product_ids: list[int] = []
    alert_ids: list[int] = []
    order_id = None
    second_order_id = None
    third_order_id = None

    try:
        # 2) Supplier with E.164 whatsapp number
        step(2, "POST /suppliers (con whatsapp E.164)")
        s, b = http_call("POST", f"{base}/suppliers",
                          body={"name": f"{tag} Cantine Bella",
                                "contact_name": "Anna",
                                "whatsapp": "+393331112233"},
                          token=token)
        assert_status(s, 201, "supplier create", b)
        supplier_id = b["id"]
        print(f"  supplier id={supplier_id} whatsapp={b['whatsapp']}")

        # 3) 3 products
        step(3, "POST /products x3")
        for i, (n, u) in enumerate([
            (f"{tag} Primitivo", "bottiglia"),
            (f"{tag} Negroamaro", "bottiglia"),
            (f"{tag} Verdeca", "bottiglia"),
        ]):
            s, b = http_call("POST", f"{base}/products",
                              body={"name": n, "unit": u,
                                    "preferred_supplier_id": supplier_id},
                              token=token)
            assert_status(s, 201, f"product {n}", b)
            product_ids.append(b["id"])
        print(f"  product_ids={product_ids}")

        # 4) 3 alerts open
        step(4, "POST /alerts x3 (open su ogni prodotto)")
        for pid in product_ids:
            s, b = http_call("POST", f"{base}/alerts",
                              body={"product_id": pid, "status_signaled": "low",
                                    "suggested_qty": 6},
                              token=token)
            assert_status(s, 201, f"alert p={pid}", b)
            alert_ids.append(b["id"])
        print(f"  alert_ids={alert_ids}")

        # 5) POST /supplier-orders con i 3 alert linkati
        step(5, "POST /supplier-orders — 3 righe con alert_id collegati")
        s, b = http_call("POST", f"{base}/supplier-orders",
                          body={"supplier_id": supplier_id,
                                "notes": f"test {tag}",
                                "lines": [
                                    {"product_id": product_ids[0], "qty": 6, "alert_id": alert_ids[0]},
                                    {"product_id": product_ids[1], "qty": 4, "alert_id": alert_ids[1]},
                                    {"product_id": product_ids[2], "qty": 3, "alert_id": alert_ids[2]},
                                ]},
                          token=token)
        assert_status(s, 201, "order create", b)
        order_id = b["id"]
        if b["status"] != "draft":
            fatal(f"atteso status=draft, ottenuto {b['status']}")
        print(f"  order id={order_id} status={b['status']} lines={len(b['lines'])}")

        # 6) Verify alerts → included_in_order
        step(6, "GET /alerts — i 3 alert ora 'included_in_order'")
        s, all_alerts = http_call("GET", f"{base}/alerts?status=included_in_order", token=token)
        assert_status(s, 200, "list alerts", all_alerts)
        ours = [a for a in all_alerts if a["id"] in alert_ids]
        if len(ours) != 3:
            fatal(f"attesi 3 alert in included_in_order, trovati {len(ours)}")
        print(f"  ✓ tutti e 3 in included_in_order")

        # 7) GET /supplier-orders/{id} — whatsapp_url + preview
        step(7, "GET /supplier-orders/{id} — verifica whatsapp_url + preview")
        s, b = http_call("GET", f"{base}/supplier-orders/{order_id}", token=token)
        assert_status(s, 200, "order detail", b)
        url = b.get("whatsapp_url")
        if not url or not url.startswith("https://wa.me/393331112233?text="):
            fatal(f"whatsapp_url inatteso: {url!r}")
        # Verify the encoded body actually decodes to the preview
        encoded = url.split("?text=", 1)[1]
        decoded = urllib.parse.unquote(encoded)
        if decoded != b["whatsapp_message_preview"]:
            fatal(f"text decodificato ≠ preview")
        if not decoded.startswith("Ciao ") or "Cantine Bella" not in decoded or "Primitivo" not in decoded:
            fatal(f"preview non contiene supplier_name o prodotti: {decoded!r}")
        print(f"  ✓ url ok; preview di {len(decoded)} caratteri")

        # 8) PATCH supplier.message_template → preview cambia
        step(8, "PATCH /suppliers — template personalizzato; preview deve riflettere")
        custom_tpl = "Buongiorno {supplier_name}, ti scrive Amos. Ordine del {date}:\n{lines}\nA presto!"
        s, _ = http_call("PATCH", f"{base}/suppliers/{supplier_id}",
                          body={"message_template": custom_tpl}, token=token)
        assert_status(s, 200, "patch supplier template", None)
        s, b = http_call("GET", f"{base}/supplier-orders/{order_id}", token=token)
        preview = b["whatsapp_message_preview"] or ""
        if not preview.startswith("Buongiorno ") or "Cantine Bella" not in preview:
            fatal(f"preview non usa il custom template: {preview!r}")
        if "ti scrive Amos" not in preview:
            fatal(f"preview non usa il custom template: {preview!r}")
        print(f"  ✓ preview ora con template custom")

        # 9) mark-sent → snapshot
        step(9, "POST /{id}/mark-sent — salva snapshot whatsapp_message_generated")
        snapshot_preview = b["whatsapp_message_preview"]
        s, b = http_call("POST", f"{base}/supplier-orders/{order_id}/mark-sent", token=token)
        assert_status(s, 200, "mark-sent", b)
        if b["status"] != "sent":
            fatal(f"atteso status=sent, ottenuto {b['status']}")
        if not b.get("sent_at"):
            fatal("sent_at non valorizzato")
        if b.get("whatsapp_message_generated") != snapshot_preview:
            fatal(f"snapshot ≠ preview al momento dell'invio")
        print(f"  ✓ status=sent, sent_at={b['sent_at']}, snapshot di {len(b['whatsapp_message_generated'])} char")

        # 10) mark-received
        step(10, "POST /{id}/mark-received")
        s, b = http_call("POST", f"{base}/supplier-orders/{order_id}/mark-received", token=token)
        assert_status(s, 200, "mark-received", b)
        if b["status"] != "received":
            fatal(f"atteso status=received, ottenuto {b['status']}")
        if not b.get("received_at"):
            fatal("received_at non valorizzato")
        print(f"  ✓ status=received, received_at={b['received_at']}")

        # 11) Cancel flow: create a *new* alert + draft, then cancel, verify alert open
        step(11, "POST /alerts + /supplier-orders + /cancel — alert torna 'open'")
        s, b = http_call("POST", f"{base}/alerts",
                          body={"product_id": product_ids[0], "status_signaled": "low"},
                          token=token)
        assert_status(s, 201, "alert for cancel test", b)
        cancel_alert_id = b["id"]
        s, b = http_call("POST", f"{base}/supplier-orders",
                          body={"supplier_id": supplier_id,
                                "lines": [{"product_id": product_ids[0], "qty": 5, "alert_id": cancel_alert_id}]},
                          token=token)
        assert_status(s, 201, "draft for cancel", b)
        second_order_id = b["id"]
        s, b = http_call("POST", f"{base}/supplier-orders/{second_order_id}/cancel", token=token)
        assert_status(s, 200, "cancel", b)
        if b["status"] != "cancelled":
            fatal(f"atteso status=cancelled, ottenuto {b['status']}")
        # verify alert reopened
        s, b = http_call("GET", f"{base}/alerts?status=open", token=token)
        if not any(a["id"] == cancel_alert_id for a in b):
            fatal(f"alert {cancel_alert_id} non riaperto dopo cancel")
        print(f"  ✓ ordine cancellato, alert {cancel_alert_id} riaperto")
        alert_ids.append(cancel_alert_id)

        # 12) Hard DELETE on draft (admin)
        step(12, "POST /alerts + /supplier-orders + DELETE — rilascia alert e cancella riga")
        s, b = http_call("POST", f"{base}/alerts",
                          body={"product_id": product_ids[1], "status_signaled": "out"},
                          token=token)
        assert_status(s, 201, "alert for delete test", b)
        delete_alert_id = b["id"]
        s, b = http_call("POST", f"{base}/supplier-orders",
                          body={"supplier_id": supplier_id,
                                "lines": [{"product_id": product_ids[1], "qty": 3, "alert_id": delete_alert_id}]},
                          token=token)
        assert_status(s, 201, "draft for delete", b)
        third_order_id = b["id"]
        s, _ = http_call("DELETE", f"{base}/supplier-orders/{third_order_id}", token=token)
        assert_status(s, 204, "delete order", None)
        # verify alert reopened
        s, b = http_call("GET", f"{base}/alerts?status=open", token=token)
        if not any(a["id"] == delete_alert_id for a in b):
            fatal(f"alert {delete_alert_id} non riaperto dopo DELETE")
        # verify order really gone
        s, b = http_call("GET", f"{base}/supplier-orders/{third_order_id}", token=token)
        if s != 404:
            fatal(f"atteso 404 dopo DELETE, ottenuto {s}")
        print(f"  ✓ ordine DELETE-ato, alert {delete_alert_id} riaperto, GET → 404")
        alert_ids.append(delete_alert_id)
        third_order_id = None  # nothing left to clean

        print("\n✅ Tutti i check sono passati.")

    finally:
        print("\n— Cleanup —")
        def safe(label, fn):
            try: fn()
            except Exception as e: print(f"  ⚠ {label}: {e}")

        # Attempt to delete the main order if still draft (e.g. test failed
        # before mark-sent). For sent/received orders DELETE returns 400 →
        # safe() swallows it. received orders just stay as historical record.
        for oid in (order_id, second_order_id, third_order_id):
            if oid is None: continue
            safe(f"delete order {oid}", lambda oid=oid: http_call(
                "DELETE", f"{base}/supplier-orders/{oid}", token=token,
            ))

        for aid in alert_ids:
            safe(f"ignore alert {aid}", lambda aid=aid: http_call(
                "POST", f"{base}/alerts/{aid}/ignore", token=token,
            ))
        for pid in product_ids:
            safe(f"delete product {pid}", lambda pid=pid: http_call(
                "DELETE", f"{base}/products/{pid}", token=token,
            ))
        if supplier_id:
            safe(f"delete supplier {supplier_id}", lambda: http_call(
                "DELETE", f"{base}/suppliers/{supplier_id}", token=token,
            ))
        print(f"  cleanup ok (tag {tag})")


if __name__ == "__main__":
    main()
