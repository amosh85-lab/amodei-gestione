"""One-off helper that screenshots every SPA page authenticated.

Uses Playwright so it can:
  - seed localStorage with the auth token via an init script (before the
    page's own JS runs) so the SPA mounts straight into an authenticated
    state
  - wait for `networkidle` so async ES-module imports and the inevitable
    chain of fetches (/auth/me + per-page data) all finish before the
    PNG is captured

Pre-requisites:
  - backend running locally on 8000 with localhost:5501 in ALLOWED_ORIGINS
  - frontend served via `python3 -m http.server 5501` from /frontend
  - Playwright installed: `.venv/bin/playwright install chromium`

Usage:
  .venv/bin/python tools/screenshot_pages.py [--first-product N]
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import ssl
import sys
from pathlib import Path
from typing import Any
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError


BACKEND = os.environ.get("AMODEI_BACKEND", "http://localhost:8000")
FRONTEND = os.environ.get("AMODEI_FRONTEND", "http://localhost:5501")
OUT_DIR = Path("/tmp/amodei-shots")
OUT_DIR.mkdir(parents=True, exist_ok=True)


def _ssl_ctx() -> ssl.SSLContext | None:
    try:
        import certifi
    except ImportError:
        return None
    return ssl.create_default_context(cafile=certifi.where())


SSL_CTX = _ssl_ctx()


def http_json(method: str, url: str, body: dict | None = None, token: str | None = None) -> tuple[int, Any]:
    headers = {"Accept": "application/json"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urlrequest.Request(url, data=data, method=method, headers=headers)
    open_kwargs: dict[str, Any] = {"timeout": 10}
    if url.startswith("https://") and SSL_CTX is not None:
        open_kwargs["context"] = SSL_CTX
    try:
        with urlrequest.urlopen(req, **open_kwargs) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw) if raw else None
    except HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")
    except URLError as exc:
        sys.exit(f"Errore di rete verso {url}: {exc.reason}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--first-product", type=int, default=None,
                    help="ID prodotto per la pagina dettaglio (autodetected se omesso)")
    args = ap.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit("playwright non installato. Esegui: .venv/bin/pip install playwright && .venv/bin/playwright install chromium")

    print("=== Amodei screenshot helper (Playwright) ===")
    email = input("Admin email: ").strip().lower()
    password = getpass.getpass("Admin password (input nascosto): ")

    print("→ Login backend…", flush=True)
    code, body = http_json("POST", f"{BACKEND}/auth/login", body={"email": email, "password": password})
    if code != 200:
        sys.exit(f"Login fallito: {code} {body}")
    token = body["access_token"]
    user = body["user"]
    print(f"  token ok ({len(token)} char) — user={user['email']} role={user['role']}")

    pid = args.first_product
    if pid is None:
        print("→ Cerco un prodotto per la pagina dettaglio…", flush=True)
        code, body = http_json("GET", f"{BACKEND}/products?active=true", token=token)
        if code == 200 and body:
            pid = body[0]["id"]
            print(f"  uso product_id={pid} ({body[0]['name']})")
        else:
            print("  nessun prodotto trovato — salto la pagina dettaglio")

    pages: list[tuple[str, str, bool]] = [
        # (name, hash, requires_auth_seeded)
        ("login",          "/login",                  False),
        ("home",           "/",                       True),
        ("magazzino",      "/magazzino",              True),
        ("carico",         "/magazzino/carico",       True),
        ("fornitori",      "/fornitori",              True),
        ("menu-singoli",   "/menu?tab=singoli",       True),
        ("menu-combinati", "/menu?tab=combinati",     True),
        ("menu-new",       "/menu/combined/new",      True),
        ("chiusura",       "/chiusura-serale",        True),
        ("pasti-list",      "/pasti-staff",            True),
        ("pasti-new",       "/pasti-staff/nuovo",      True),
        ("pasti-stats",     "/pasti-staff/statistiche", True),
        ("segnala",         "/segnala",                True),
        ("riordini-aperte", "/riordini?tab=aperte",    True),
        ("riordini-bozze",  "/riordini?tab=bozze",     True),
        ("riordini-nuovo",  "/riordini/nuovo",         True),
        ("cassa-lunch",     "/cassa?tab=lunch",        True),
        ("cassa-dinner",    "/cassa?tab=dinner",       True),
        ("cassa-total",     "/cassa?tab=total",        True),
        ("cassa-storico",   "/cassa/storico",          True),
        ("cassa-stats",     "/cassa/statistiche",      True),
        ("report-sprechi",  "/report/sprechi",         True),
        ("report-margini",  "/report/margini",         True),
        ("riordini-previsti", "/riordini-previsti",    True),
        ("impostazioni",    "/impostazioni",           True),
        ("benvenuto",       "/benvenuto",              True),
    ]
    if pid is not None:
        pages.insert(4, ("detail", f"/magazzino/{pid}", True))

    init_script = (
        f"localStorage.setItem('amodei.token', {json.dumps(token)});\n"
        f"localStorage.setItem('amodei.user', {json.dumps(json.dumps(user))});"
    )

    desktop_viewport = {"width": 1440, "height": 900}
    mobile_viewport = {"width": 390, "height": 844}
    mobile_ua = (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 "
        "Mobile/15E148 Safari/604.1"
    )

    print("\n→ Genero gli screenshot:")
    with sync_playwright() as p:
        browser = p.chromium.launch()

        for name, hash_path, seed_auth in pages:
            url = f"{FRONTEND}/index.html#{hash_path}"

            for label, viewport, ua in [
                ("desktop", desktop_viewport, None),
                ("mobile",  mobile_viewport,  mobile_ua),
            ]:
                ctx_kwargs: dict[str, Any] = {"viewport": viewport}
                if ua:
                    ctx_kwargs["user_agent"] = ua
                    ctx_kwargs["device_scale_factor"] = 2
                    ctx_kwargs["is_mobile"] = True
                context = browser.new_context(**ctx_kwargs)
                if seed_auth:
                    context.add_init_script(init_script)
                page = context.new_page()
                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=15000)
                    # Wait for the SPA to swap "Caricamento…" with real content.
                    page.wait_for_function(
                        "() => !document.querySelector('#app p.muted')"
                        "       || !document.querySelector('#app p.muted').textContent.includes('Caricamento')",
                        timeout=8000,
                    )
                    page.wait_for_load_state("networkidle", timeout=6000)
                except Exception as e:
                    print(f"    ⚠ {name} {label}: {e}")
                out = OUT_DIR / f"{name}-{label}.png"
                page.screenshot(path=str(out), full_page=True)
                size_kb = out.stat().st_size // 1024
                print(f"  - {name} {label} → {out} ({size_kb} KB)")
                context.close()

        browser.close()

    print(f"\n✅ Fatto. PNG in {OUT_DIR}/")
    print("Apri tutte con:  open /tmp/amodei-shots/*.png")


if __name__ == "__main__":
    main()
