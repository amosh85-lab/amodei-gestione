"""Smoke test for the magazzino loading flow: batches, FIFO, photo upload.

Walks the full path:
    1. Login as admin
    2. Create a test supplier
    3. Create test product 'Mozzarella' (unit=kg)
    4. Create 3 batches with staggered expiry (+2/+5/+10 days)
    5. GET /products/{id} and verify qty_total = sum(initial_qty)
    6. POST /movements/scarto for 1.5kg and verify FIFO consumed the
       earliest-expiry batch first
    7. POST /batches with a generated PNG attached (multipart)
    8. GET the returned receipt_photo URL and verify it serves the image
    9. Cleanup: rettifica the open batches to 0 and soft-delete product

Run from backend/:
    .venv/bin/python -m scripts.test_loading
    .venv/bin/python -m scripts.test_loading --base-url <URL>
"""
from __future__ import annotations

import argparse
import getpass
import io
import json
import ssl
import sys
import time
import uuid
from datetime import date, timedelta
from typing import Any
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError


def _build_ssl_context() -> ssl.SSLContext | None:
    try:
        import certifi
    except ImportError:
        return None
    return ssl.create_default_context(cafile=certifi.where())


_SSL_CTX = _build_ssl_context()


# ----------------------------------------------------------------------
# Tiny HTTP helper
# ----------------------------------------------------------------------


def http_call(
    method: str,
    url: str,
    *,
    body: bytes | dict | None = None,
    content_type: str | None = None,
    token: str | None = None,
    timeout: float = 30.0,
    expect_json: bool = True,
) -> tuple[int, Any, dict[str, str]]:
    headers: dict[str, str] = {"Accept": "*/*" if not expect_json else "application/json"}
    data: bytes | None = None
    if body is not None:
        if isinstance(body, (bytes, bytearray)):
            data = bytes(body)
        else:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode("utf-8")
    if content_type:
        headers["Content-Type"] = content_type
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urlrequest.Request(url, data=data, method=method, headers=headers)
    open_kwargs: dict[str, Any] = {"timeout": timeout}
    if url.startswith("https://") and _SSL_CTX is not None:
        open_kwargs["context"] = _SSL_CTX
    try:
        with urlrequest.urlopen(req, **open_kwargs) as resp:
            raw = resp.read()
            resp_ct = resp.headers.get("Content-Type", "")
            if expect_json and raw:
                try:
                    parsed: Any = json.loads(raw)
                except json.JSONDecodeError:
                    parsed = raw
            else:
                parsed = raw
            return resp.status, parsed, {"content_type": resp_ct, "length": str(len(raw))}
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {"raw": raw}
        return exc.code, parsed, {}
    except URLError as exc:
        sys.exit(f"Errore di rete verso {url}: {exc.reason}")


# ----------------------------------------------------------------------
# Manual multipart/form-data encoder
# ----------------------------------------------------------------------


def encode_multipart(
    fields: dict[str, str],
    files: dict[str, tuple[str, bytes, str]],
) -> tuple[bytes, str]:
    """fields: name → string value.
    files:  name → (filename, content_bytes, mime_type).
    Returns (body_bytes, content_type_header).
    """
    boundary = "----amodei-" + uuid.uuid4().hex
    body = bytearray()
    for name, value in fields.items():
        body += f"--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
        body += str(value).encode("utf-8") + b"\r\n"
    for name, (filename, content, mime) in files.items():
        body += f"--{boundary}\r\n".encode()
        body += (
            f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
        ).encode()
        body += f"Content-Type: {mime}\r\n\r\n".encode()
        body += content + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    return bytes(body), f"multipart/form-data; boundary={boundary}"


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------


def step(n: int, label: str) -> None:
    print(f"\n[{n}] {label}")


def fatal(msg: str) -> None:
    sys.exit(f"  ❌ {msg}")


def assert_status(actual: int, expected: int, label: str, body: Any = None) -> None:
    if actual != expected:
        fatal(f"{label}: atteso {expected}, ottenuto {actual} (body={body})")


def generate_test_png() -> bytes:
    """Make a 200x200 red square PNG with a centred 'R' for the receipt."""
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (200, 200), (200, 70, 50))
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 80)
    except OSError:
        font = ImageFont.load_default()
    draw.text((60, 50), "R", fill=(255, 255, 255), font=font)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


# ----------------------------------------------------------------------
# MAIN
# ----------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description="Test end-to-end del carico magazzino")
    parser.add_argument("--base-url", default="http://localhost:8000")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    print(f"=== Test carico magazzino contro {base} ===")
    email = input("Admin email: ").strip().lower()
    password = getpass.getpass("Admin password (input nascosto): ")

    # 1) login
    step(1, "POST /auth/login")
    status, body, _ = http_call("POST", f"{base}/auth/login",
                                 body={"email": email, "password": password})
    assert_status(status, 200, "login", body)
    token = body["access_token"]

    tag = f"LOAD{int(time.time())}"
    supplier_id: int | None = None
    product_id: int | None = None
    batches_with_photo: list[int] = []
    today = date.today()

    try:
        # 2) supplier
        step(2, "POST /suppliers")
        status, body, _ = http_call(
            "POST", f"{base}/suppliers",
            body={"name": f"{tag} Caseificio Bella", "contact_name": "Anna"},
            token=token,
        )
        assert_status(status, 201, "supplier create", body)
        supplier_id = body["id"]
        print(f"  supplier id={supplier_id}")

        # 3) product
        step(3, "POST /products")
        status, body, _ = http_call(
            "POST", f"{base}/products",
            body={
                "name": f"{tag} Mozzarella",
                "category": "Latticini",
                "unit": "kg",
                "sale_price": "9.50",
                "vat_rate": "iva_10",
                "preferred_supplier_id": supplier_id,
            },
            token=token,
        )
        assert_status(status, 201, "product create", body)
        product_id = body["id"]
        print(f"  product id={product_id} qty_total={body['qty_total']}")

        # 4) three batches with staggered expiry
        step(4, "POST /batches x3 con scadenze +2 / +5 / +10 giorni")
        days_offsets = [2, 5, 10]
        initial_qtys = ["3", "2", "5"]   # total 10kg
        purchase_prices = ["4.50", "4.40", "4.20"]
        for offset, qty, price in zip(days_offsets, initial_qtys, purchase_prices):
            mp_body, mp_ct = encode_multipart(
                fields={
                    "product_id": str(product_id),
                    "supplier_id": str(supplier_id),
                    "initial_qty": qty,
                    "purchase_price_unit": price,
                    "load_date": today.isoformat(),
                    "expiry_date": (today + timedelta(days=offset)).isoformat(),
                    "notes": f"Lotto carico +{offset}gg",
                },
                files={},  # no photo
            )
            status, body, _ = http_call(
                "POST", f"{base}/batches",
                body=mp_body, content_type=mp_ct, token=token,
            )
            assert_status(status, 201, f"batch +{offset}gg", body)
            print(
                f"  batch id={body['id']} expiry={body['expiry_date']} "
                f"qty={body['initial_qty']} price={body['purchase_price_unit']}"
            )

        # 5) verify total stock = 10
        step(5, f"GET /products/{product_id} — qty_total deve essere 10")
        status, body, _ = http_call("GET", f"{base}/products/{product_id}", token=token)
        assert_status(status, 200, "product detail", body)
        qty_total = float(body["qty_total"])
        if abs(qty_total - 10.0) > 0.001:
            fatal(f"qty_total atteso 10.00, ottenuto {qty_total}")
        if len(body["batches"]) != 3:
            fatal(f"attesi 3 batch nel detail, trovati {len(body['batches'])}")
        # I lotti devono uscire ordinati per expiry ASC (NULLS LAST → qui nessun NULL)
        expiries = [b["expiry_date"] for b in body["batches"]]
        if expiries != sorted(expiries):
            fatal(f"i lotti non sono ordinati per expiry ASC: {expiries}")
        print(f"  ✓ qty_total=10.00, 3 lotti ordinati per scadenza ASC: {expiries}")

        # 6) scarto 1.5 → deve consumare il lotto con scadenza più vicina (3kg)
        step(6, "POST /movements/scarto 1.5kg waste_expiry — atteso FIFO sul lotto +2gg")
        status, body, _ = http_call(
            "POST", f"{base}/movements/scarto",
            body={
                "product_id": product_id, "qty": "1.5",
                "type": "waste_expiry", "reason": "scaduto domani",
            },
            token=token,
        )
        assert_status(status, 201, "scarto", body)
        if len(body) != 1:
            fatal(f"atteso 1 movimento (preso tutto da un solo lotto), trovati {len(body)}")
        # Verifica che il batch consumato sia quello con expiry più vicina (+2gg)
        consumed_batch_id = body[0]["batch_id"]
        status, prod_after, _ = http_call(
            "GET", f"{base}/products/{product_id}", token=token,
        )
        assert_status(status, 200, "product detail post-scarto", prod_after)
        new_total = float(prod_after["qty_total"])
        if abs(new_total - 8.5) > 0.001:
            fatal(f"qty_total atteso 8.50 dopo scarto, ottenuto {new_total}")
        first_batch = prod_after["batches"][0]
        if first_batch["id"] != consumed_batch_id:
            fatal(f"il batch consumato {consumed_batch_id} non è il primo per expiry")
        if abs(float(first_batch["current_qty"]) - 1.5) > 0.001:
            fatal(
                f"current_qty del lotto FIFO atteso 1.50, ottenuto {first_batch['current_qty']}"
            )
        print(f"  ✓ FIFO ok: lotto id={consumed_batch_id} (expiry più vicina) ora a 1.50")

        # 7) carica un lotto con foto
        step(7, "POST /batches con receipt_photo (PNG generato al volo)")
        png_bytes = generate_test_png()
        mp_body, mp_ct = encode_multipart(
            fields={
                "product_id": str(product_id),
                "initial_qty": "1",
                "purchase_price_unit": "4.30",
                "load_date": today.isoformat(),
                "expiry_date": (today + timedelta(days=8)).isoformat(),
                "notes": "Lotto con foto",
            },
            files={
                "receipt_photo": ("receipt.png", png_bytes, "image/png"),
            },
        )
        status, body, _ = http_call(
            "POST", f"{base}/batches",
            body=mp_body, content_type=mp_ct, token=token,
        )
        assert_status(status, 201, "batch con foto", body)
        photo_url = body.get("receipt_photo_url")
        if not photo_url or not photo_url.startswith("/uploads/receipts/"):
            fatal(f"receipt_photo_url non valida: {photo_url!r}")
        batches_with_photo.append(body["id"])
        print(f"  ✓ foto salvata: {photo_url}")

        # 8) GET della foto — content-type image/* e payload non vuoto
        step(8, f"GET {photo_url} — verifica statico raggiungibile e immagine valida")
        full_url = f"{base}{photo_url}"
        status, raw, meta = http_call(
            "GET", full_url, token=None, expect_json=False,
        )
        assert_status(status, 200, "fetch image", None)
        if not isinstance(raw, (bytes, bytearray)) or len(raw) < 200:
            fatal(f"payload immagine troppo piccolo: {len(raw) if hasattr(raw, '__len__') else 0} bytes")
        if not meta.get("content_type", "").startswith("image/"):
            fatal(f"content-type inatteso: {meta.get('content_type')!r}")
        if raw[:3] != b"\xff\xd8\xff":  # JPEG magic; storage.py riconverte sempre in JPEG
            fatal(f"payload non sembra JPEG (magic bytes: {raw[:4]!r})")
        print(
            f"  ✓ {meta['content_type']}, {meta['length']} bytes, "
            f"magic JPEG ok, salvato come JPEG dal servizio"
        )

        print("\n✅ Tutti i check sono passati.")

    finally:
        # Cleanup è best-effort: ogni call wrappato per non far esplodere il
        # processo se Railway è momentaneamente lento. Se qualcosa fallisce,
        # gli orfani restano taggati col tag così li trovi/elimini dopo.
        print("\n— Cleanup —")

        def safe(label: str, fn):
            try:
                fn()
            except Exception as exc:
                print(f"  ⚠ {label}: {exc}")

        if product_id is not None:
            safe(
                "GET batches per cleanup",
                lambda: _cleanup_batches(base, token, product_id, tag),
            )
            safe(
                f"DELETE product {product_id}",
                lambda: http_call("DELETE", f"{base}/products/{product_id}", token=token, timeout=45),
            )
        if supplier_id is not None:
            safe(
                f"DELETE supplier {supplier_id}",
                lambda: http_call("DELETE", f"{base}/suppliers/{supplier_id}", token=token, timeout=45),
            )
        print(f"  Cleanup completato (tag {tag}).")


def _cleanup_batches(base: str, token: str, product_id: int, tag: str) -> None:
    status, batches, _ = http_call(
        "GET", f"{base}/batches?product_id={product_id}&include_empty=true",
        token=token, timeout=45,
    )
    if not isinstance(batches, list):
        return
    for b in batches:
        if float(b["current_qty"]) > 0:
            try:
                http_call(
                    "POST", f"{base}/movements/rettifica",
                    body={"batch_id": b["id"], "new_qty": "0",
                          "reason": f"cleanup test {tag}"},
                    token=token, timeout=45,
                )
            except Exception as exc:
                print(f"  ⚠ rettifica batch {b['id']}: {exc}")


if __name__ == "__main__":
    main()
