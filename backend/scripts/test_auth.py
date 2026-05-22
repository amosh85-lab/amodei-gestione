"""End-to-end smoke test for the /auth endpoints.

Uses only the stdlib (urllib) so it can run without installing requests.
Run from backend/:
    .venv/bin/python -m scripts.test_auth                  # localhost
    .venv/bin/python -m scripts.test_auth --base-url <URL> # remote (Railway)
"""
from __future__ import annotations

import argparse
import getpass
import json
import sys
from typing import Any
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError


def http_call(
    method: str,
    url: str,
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
    try:
        with urlrequest.urlopen(req, timeout=timeout) as resp:
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Test end-to-end di /auth")
    parser.add_argument(
        "--base-url",
        default="http://localhost:8000",
        help="Base URL del backend (es. https://amodei-gestione-production.up.railway.app)",
    )
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    print(f"=== Test /auth contro {base} ===")

    email = input("Admin email: ").strip().lower()
    password = getpass.getpass("Admin password (input nascosto): ")
    if not email or not password:
        sys.exit("Email o password vuota — esco.")

    # 1) Login con credenziali corrette
    step(1, "POST /auth/login (credenziali corrette)")
    status, body = http_call("POST", f"{base}/auth/login", body={"email": email, "password": password})
    print(f"  status={status}")
    if status != 200:
        fatal(f"login fallito: {body}")
    token = body.get("access_token")
    user_obj = body.get("user")
    if not token or not user_obj:
        fatal(f"payload inatteso: {body}")
    print(f"  token={token[:40]}…")
    print(f"  user={user_obj}")

    # 2) /auth/me con token valido
    step(2, "GET /auth/me (con token)")
    status, body = http_call("GET", f"{base}/auth/me", token=token)
    print(f"  status={status}")
    print(f"  body={body}")
    if status != 200:
        fatal(f"atteso 200, ottenuto {status}")
    if body.get("email") != user_obj.get("email"):
        fatal(f"email su /me non combacia: {body!r}")

    # 3) /auth/me senza token
    step(3, "GET /auth/me (senza token) — deve dare 401")
    status, body = http_call("GET", f"{base}/auth/me")
    print(f"  status={status}")
    if status != 401:
        fatal(f"atteso 401, ottenuto {status} (body={body})")

    # 4) /auth/me con token malformato
    step(4, "GET /auth/me (token malformato) — deve dare 401")
    status, body = http_call("GET", f"{base}/auth/me", token="not.a.real.token")
    print(f"  status={status}")
    if status != 401:
        fatal(f"atteso 401, ottenuto {status} (body={body})")

    # 5) Login con password sbagliata
    step(5, "POST /auth/login (password errata) — deve dare 401 generico")
    status, body = http_call("POST", f"{base}/auth/login", body={"email": email, "password": "wrong-password-xxx"})
    print(f"  status={status}  detail={body.get('detail') if isinstance(body, dict) else body}")
    if status != 401:
        fatal(f"atteso 401, ottenuto {status}")
    if isinstance(body, dict) and body.get("detail") != "Credenziali non valide":
        fatal(f"messaggio errore non generico: {body.get('detail')!r}")

    # 6) Login con email inesistente — deve dare lo stesso messaggio generico
    step(6, "POST /auth/login (email inesistente) — stesso messaggio generico")
    status, body = http_call(
        "POST", f"{base}/auth/login",
        body={"email": "ghost-no-user@example.com", "password": "whatever"},
    )
    print(f"  status={status}  detail={body.get('detail') if isinstance(body, dict) else body}")
    if status != 401:
        fatal(f"atteso 401, ottenuto {status}")
    if isinstance(body, dict) and body.get("detail") != "Credenziali non valide":
        fatal(f"messaggio errore non generico: {body.get('detail')!r}")

    print("\n✅ Tutti i check sono passati.")


if __name__ == "__main__":
    main()
