"""Image upload helper.

Saves user-supplied images to a local directory that's mounted as a
persistent volume in production (Railway). Validates size + MIME by
actually opening the file with Pillow, downscales wide images and
re-encodes everything as JPEG for predictable size / EXIF stripping.

Returns a relative URL path (e.g. ``/uploads/receipts/abc.jpg``) that the
FastAPI ``StaticFiles`` mount serves directly. The frontend prepends the
API base URL — no absolute URLs are stored in the database.
"""
from __future__ import annotations

import logging
import re
import uuid
from io import BytesIO
from pathlib import Path

from fastapi import UploadFile
from PIL import Image, UnidentifiedImageError

logger = logging.getLogger("amodei.storage")

# Layout: <source_root>/uploads
# - dev (CWD=backend/):        backend/uploads
# - Docker (WORKDIR=/app):     /app/uploads      ← Railway volume mounts here
UPLOAD_ROOT: Path = Path(__file__).resolve().parents[2] / "uploads"

MAX_BYTES = 5 * 1024 * 1024            # 5 MB hard cap
MAX_WIDTH = 1600                       # downscale anything wider
JPEG_QUALITY = 85
SAFE_FOLDER_RE = re.compile(r"^[a-z0-9_-]+$")


class UploadError(ValueError):
    """User-facing upload error (caught by the router, mapped to 400)."""


def ensure_upload_root() -> Path:
    """Make sure the upload root exists. Safe to call at startup."""
    UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    return UPLOAD_ROOT


def upload_image(file: UploadFile, folder: str) -> str:
    """Validate, normalise and persist an image. Return the public URL path.

    Raises :class:`UploadError` on any validation problem so the router can
    convert it into a 400 with the original message.
    """
    if not folder or not SAFE_FOLDER_RE.match(folder):
        raise UploadError("Cartella di destinazione non valida.")

    # --- size guard: read up to MAX_BYTES + 1 to detect overflow ---
    file.file.seek(0)
    contents = file.file.read(MAX_BYTES + 1)
    if len(contents) == 0:
        raise UploadError("File vuoto.")
    if len(contents) > MAX_BYTES:
        raise UploadError(f"File troppo grande (max {MAX_BYTES // 1024 // 1024} MB).")

    # --- format guard: Pillow .verify() catches almost everything ---
    try:
        # verify() consumes the stream, so we open twice.
        Image.open(BytesIO(contents)).verify()
        img = Image.open(BytesIO(contents))
    except (UnidentifiedImageError, OSError) as exc:
        raise UploadError("Il file non sembra un'immagine valida.") from exc

    # --- normalise to RGB on white (handles transparent PNGs) ---
    if img.mode in ("RGBA", "LA"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        background.paste(img, mask=img.split()[-1])
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    # --- downscale if wider than MAX_WIDTH ---
    if img.width > MAX_WIDTH:
        ratio = MAX_WIDTH / img.width
        img = img.resize((MAX_WIDTH, int(img.height * ratio)), Image.LANCZOS)

    # --- persist ---
    target_dir = ensure_upload_root() / folder
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.jpg"
    target_path = target_dir / filename
    img.save(target_path, format="JPEG", quality=JPEG_QUALITY, optimize=True)

    logger.info(
        "Image saved: %s (%d bytes raw, final %d bytes)",
        target_path, len(contents), target_path.stat().st_size,
    )
    return f"/uploads/{folder}/{filename}"
