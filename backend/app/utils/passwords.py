"""Password hashing helpers built on top of ``bcrypt`` (no passlib).

bcrypt has a hard 72-byte input limit. We sidestep it by pre-hashing the
password with SHA-256 and base64-encoding the digest (44 ASCII bytes —
well under the limit) before handing it to bcrypt. This is the same
pattern used by Django and several auth libraries; it lets the app accept
passwords of any length while keeping bcrypt as the actual KDF.

Trade-off to be aware of: stored hashes are NOT interchangeable with
"raw bcrypt" hashes. Always go through ``hash_password`` / ``verify_password``.
"""
from __future__ import annotations

import base64
import hashlib

import bcrypt

# Cost factor. 12 ≈ 250 ms on modern hardware — a good balance between user
# wait time and brute-force resistance for an internal business app.
BCRYPT_ROUNDS = 12


def _preprocess(password: str) -> bytes:
    digest = hashlib.sha256(password.encode("utf-8")).digest()
    return base64.b64encode(digest)


def hash_password(password: str) -> str:
    """Return a bcrypt hash string suitable for storage in ``User.password_hash``."""
    if not password:
        raise ValueError("Password vuota.")
    hashed = bcrypt.hashpw(_preprocess(password), bcrypt.gensalt(rounds=BCRYPT_ROUNDS))
    return hashed.decode("ascii")


def verify_password(password: str, hashed: str) -> bool:
    """True iff ``password`` matches the previously-stored ``hashed`` value."""
    if not password or not hashed:
        return False
    try:
        return bcrypt.checkpw(_preprocess(password), hashed.encode("ascii"))
    except ValueError:
        # Malformed stored hash — treat as a non-match rather than crashing.
        return False
