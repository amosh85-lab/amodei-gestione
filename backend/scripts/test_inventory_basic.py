"""Smoke test for /suppliers and /products CRUD.

Walks the happy path end-to-end:
    1. Login as admin
    2. Create 2 test suppliers
    3. Create 5 test products with mixed supplier assignment
    4. Verify list order (name ASC), filters, search
    5. Attempt to create a product with duplicate code → expect 400
    6. List categories
    7. GET /products/{id} detail (batches array should be empty)
    8. PATCH one product
    9. Soft-delete every product and supplier created during the test

Run from backend/:
    .venv/bin/python -m scripts.test_inventory_basic
    .venv/bin/python -m scripts.test_inventory_basic --base-url <URL>
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


def _build_ssl_context() -> ssl.SSLContext | None:
    try:
        import certifi
    except ImportError:
        return None
    return ssl.create_default_context(cafile=certifi.where())


_SSL_CTX = _build_ssl_context()


def http_call(
    method: str,
    url: str,
    *,
    body: dict[str, Any] | None = None,
    token: str | None = None,
    timeout: float = 10.0,
) -> tuple[int, Any]:
    headers = {"Accept": "application/json"}
    data: bytes | None = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urlrequest.Request(url, data=data, method=method, headers=headers)
    open_kwargs: dict[str, Any] = {"timeout": timeout}
    if url.startswith("https://") and _SSL_CTX is not None:
        open_kwargs["context"] = _SSL_CTX
    try:
        with urlrequest.urlopen(req, **open_kwargs) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {"raw": raw}
        return exc.code, parsed
    except URLError as exc:
        sys.exit(f"Errore di rete verso {url}: {exc.reason}")


def step(idx: int, label: str) -> None:
    print(f"\n[{idx}] {label}")


def fatal(msg: str) -> None:
    sys.exit(f"  ❌ {msg}")


def assert_status(actual: int, expected: int, label: str, body: Any = None) -> None:
    if actual != expected:
        fatal(f"{label}: atteso {expected}, ottenuto {actual} (body={body})")


def main() -> None:
    parser = argparse.ArgumentParser(description="Test end-to-end di /suppliers + /products")
    parser.add_argument("--base-url", default="http://localhost:8000")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    print(f"=== Test inventory CRUD contro {base} ===")
    email = input("Admin email: ").strip().lower()
    password = getpass.getpass("Admin password (input nascosto): ")

    # ----------------------------------------------------------
    # 1) Login
    # ----------------------------------------------------------
    step(1, "POST /auth/login")
    status, body = http_call("POST", f"{base}/auth/login",
                             body={"email": email, "password": password})
    assert_status(status, 200, "login", body)
    token = body["access_token"]
    print(f"  user={body['user']}")

    # Tag per identificare i record creati ed evitare collisioni se rilanci.
    tag = f"TEST{int(time.time())}"
    supplier_ids: list[int] = []
    product_ids: list[int] = []

    try:
        # ------------------------------------------------------
        # 2) Crea 2 fornitori
        # ------------------------------------------------------
        step(2, "POST /suppliers x2")
        for name, wa in [
            (f"{tag} Vinicola Salento", "+393331112233"),
            (f"{tag} Frutteto Locale", None),
        ]:
            payload = {"name": name, "contact_name": "Mario", "phone": "0832 000111"}
            if wa:
                payload["whatsapp"] = wa
            s, b = http_call("POST", f"{base}/suppliers", body=payload, token=token)
            assert_status(s, 201, "supplier create", b)
            supplier_ids.append(b["id"])
            print(f"  created supplier id={b['id']} name={b['name']!r} whatsapp={b['whatsapp']!r}")

        # ------------------------------------------------------
        # 3) Crea 5 prodotti
        # ------------------------------------------------------
        step(3, "POST /products x5 (con vari supplier_id + 1 con codice esplicito)")
        s_id_a, s_id_b = supplier_ids
        products = [
            {"name": f"{tag} Primitivo Salento", "category": "Vini rossi",
             "unit": "bottiglia", "unit_size": "0.75L",
             "sale_price": "25.00", "vat_rate": "iva_22",
             "preferred_supplier_id": s_id_a, "code": f"{tag}-PRIM"},
            {"name": f"{tag} Negroamaro",       "category": "Vini rossi",
             "unit": "bottiglia", "unit_size": "0.75L",
             "sale_price": "22.00", "preferred_supplier_id": s_id_a},
            {"name": f"{tag} Verdeca Bianco",    "category": "Vini bianchi",
             "unit": "bottiglia", "unit_size": "0.75L",
             "sale_price": "18.00", "preferred_supplier_id": s_id_a},
            {"name": f"{tag} Olive Taggiasche",  "category": "Antipasti",
             "unit": "barattolo", "sale_price": "8.50",
             "vat_rate": "iva_10", "preferred_supplier_id": s_id_b},
            {"name": f"{tag} Pomodori Datterini", "category": "Antipasti",
             "unit": "kg", "sale_price": "6.00",
             "vat_rate": "iva_10", "preferred_supplier_id": s_id_b,
             "min_stock": "2"},
        ]
        for p in products:
            s, b = http_call("POST", f"{base}/products", body=p, token=token)
            assert_status(s, 201, f"product create '{p['name']}'", b)
            product_ids.append(b["id"])
            print(f"  created product id={b['id']} name={b['name']!r} qty_total={b['qty_total']} vat={b['vat_rate']}")

        # ------------------------------------------------------
        # 4) Lista prodotti — verifica filtri / sort / search
        # ------------------------------------------------------
        step(4, "GET /products (no filtri) — verifica ordering name ASC")
        s, b = http_call("GET", f"{base}/products", token=token)
        assert_status(s, 200, "list products", b)
        # I nostri 5 prodotti devono apparire ordinati alfabeticamente per name.
        ours = [p for p in b if p["name"].startswith(tag)]
        if len(ours) != 5:
            fatal(f"attesi 5 prodotti taggati {tag}, trovati {len(ours)}")
        names_in_order = [p["name"] for p in ours]
        expected_sorted = sorted(names_in_order, key=str.lower)
        if names_in_order != expected_sorted:
            fatal(f"ordering errato: {names_in_order} vs atteso {expected_sorted}")
        print(f"  ✓ 5 prodotti restituiti in ordine alfabetico")

        step(5, "GET /products?category=Vini%20rossi — 3 dei nostri")
        s, b = http_call("GET", f"{base}/products?category=Vini+rossi", token=token)
        assert_status(s, 200, "filter by category", b)
        ours = [p for p in b if p["name"].startswith(tag)]
        if len(ours) != 2:
            fatal(f"attesi 2 prodotti 'Vini rossi' taggati, trovati {len(ours)}: {[p['name'] for p in ours]}")
        print(f"  ✓ 2 prodotti 'Vini rossi' trovati")

        step(6, f"GET /products?supplier_id={s_id_b} — 2 dei nostri (Olive + Datterini)")
        s, b = http_call("GET", f"{base}/products?supplier_id={s_id_b}", token=token)
        assert_status(s, 200, "filter by supplier", b)
        ours = [p for p in b if p["name"].startswith(tag)]
        if len(ours) != 2:
            fatal(f"attesi 2 prodotti col supplier_id={s_id_b} taggati, trovati {len(ours)}")
        print(f"  ✓ 2 prodotti col supplier_id={s_id_b}")

        step(7, "GET /products?search=verdeca — 1 risultato")
        s, b = http_call("GET", f"{base}/products?search=verdeca", token=token)
        assert_status(s, 200, "search", b)
        ours = [p for p in b if p["name"].startswith(tag)]
        if len(ours) != 1:
            fatal(f"atteso 1 risultato per search='verdeca' taggato, trovati {len(ours)}")
        print(f"  ✓ search case-insensitive trovata: {ours[0]['name']}")

        # ------------------------------------------------------
        # 8) Codice duplicato → 400
        # ------------------------------------------------------
        step(8, "POST /products con codice duplicato — atteso 400")
        s, b = http_call(
            "POST", f"{base}/products",
            body={
                "name": f"{tag} Clone Primitivo",
                "unit": "bottiglia",
                "code": f"{tag}-PRIM",  # stesso codice del primo prodotto
            },
            token=token,
        )
        if s != 400:
            fatal(f"atteso 400, ottenuto {s} (body={b})")
        detail = b.get("detail") if isinstance(b, dict) else None
        if detail != "Codice prodotto già usato da un altro prodotto.":
            fatal(f"messaggio inatteso: {detail!r}")
        print(f"  ✓ 400 + messaggio user-friendly: {detail!r}")

        # ------------------------------------------------------
        # 9) GET /products/categories
        # ------------------------------------------------------
        step(9, "GET /products/categories — almeno le 3 nostre presenti")
        s, b = http_call("GET", f"{base}/products/categories", token=token)
        assert_status(s, 200, "categories", b)
        for needed in ("Vini rossi", "Vini bianchi", "Antipasti"):
            if needed not in b:
                fatal(f"categoria mancante: {needed!r} (visto: {b})")
        print(f"  ✓ categorie presenti (totali nel DB: {len(b)})")

        # ------------------------------------------------------
        # 10) GET /products/{id} detail
        # ------------------------------------------------------
        step(10, f"GET /products/{product_ids[0]} — detail con batches=[]")
        s, b = http_call("GET", f"{base}/products/{product_ids[0]}", token=token)
        assert_status(s, 200, "product detail", b)
        if b.get("batches") != []:
            fatal(f"batches dovrebbe essere [] (nessun batch ancora), trovato: {b.get('batches')}")
        print(f"  ✓ detail ok, qty_total={b['qty_total']} expiring_soon_count={b['expiring_soon_count']}")

        # ------------------------------------------------------
        # 11) PATCH un prodotto
        # ------------------------------------------------------
        step(11, f"PATCH /products/{product_ids[0]} — sale_price 25 → 28")
        s, b = http_call("PATCH", f"{base}/products/{product_ids[0]}",
                         body={"sale_price": "28.00"}, token=token)
        assert_status(s, 200, "patch product", b)
        if b["sale_price"] not in ("28.00", 28.0, "28"):
            fatal(f"sale_price non aggiornato: {b['sale_price']}")
        print(f"  ✓ sale_price aggiornato a {b['sale_price']}")

        # ------------------------------------------------------
        # 12) PATCH supplier — verifica E.164 validator
        # ------------------------------------------------------
        step(12, f"PATCH /suppliers/{supplier_ids[0]} con whatsapp non valido — atteso 422")
        s, b = http_call("PATCH", f"{base}/suppliers/{supplier_ids[0]}",
                         body={"whatsapp": "333abc"}, token=token)
        if s != 422:
            fatal(f"atteso 422 validation error, ottenuto {s} (body={b})")
        print(f"  ✓ validation rifiuta WhatsApp non-E.164")

        # ------------------------------------------------------
        # 13) Validazione sale_price negativo
        # ------------------------------------------------------
        step(13, "POST /products con sale_price negativo — atteso 422")
        s, b = http_call("POST", f"{base}/products",
                         body={"name": f"{tag} Negativo", "unit": "pz", "sale_price": "-1"},
                         token=token)
        if s != 422:
            fatal(f"atteso 422, ottenuto {s} (body={b})")
        print(f"  ✓ validation rifiuta sale_price < 0")

        # ------------------------------------------------------
        # 14) Soft delete prodotto (nessun lotto → ok)
        # ------------------------------------------------------
        step(14, f"DELETE /products/{product_ids[-1]} — soft delete (nessun lotto)")
        s, b = http_call("DELETE", f"{base}/products/{product_ids[-1]}", token=token)
        assert_status(s, 204, "delete product", b)
        s, b = http_call("GET", f"{base}/products/{product_ids[-1]}", token=token)
        assert_status(s, 200, "get deleted product", b)
        if b["active"] is not False:
            fatal(f"prodotto dovrebbe essere active=false, è {b['active']}")
        print(f"  ✓ prodotto soft-deleted (active=false)")

        print("\n✅ Tutti i check sono passati.")

    finally:
        # Cleanup: soft-delete tutti i prodotti e fornitori creati.
        print("\n— Cleanup —")
        for pid in product_ids:
            http_call("DELETE", f"{base}/products/{pid}", token=token)
        for sid in supplier_ids:
            http_call("DELETE", f"{base}/suppliers/{sid}", token=token)
        print(f"  Soft-deletati {len(product_ids)} prodotti e {len(supplier_ids)} fornitori taggati {tag}.")


if __name__ == "__main__":
    main()
