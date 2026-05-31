"""Application settings, loaded from environment variables (and a local .env)."""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Centralised configuration. Each value is overridable via env var."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- meta ---
    app_version: str = "0.1.0"
    environment: str = "development"

    # --- cors ---
    # Comma-separated origins. Use "*" only in local dev.
    allowed_origins: str = "*"

    # --- database ---
    # Railway injects DATABASE_URL automatically; locally use .env or leave unset
    # until the database layer is actually exercised.
    database_url: str | None = None

    # --- auth (placeholders, used in later prompts) ---
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expires_minutes: int = 60 * 8

    # --- observability ---
    # When set, errors are sent to Sentry. Leave empty in dev.
    sentry_dsn: str | None = None
    # Sample rate for transactions (performance traces); 0.0 = off.
    sentry_traces_sample_rate: float = 0.0

    # --- web push (VAPID) ---
    # Se vuote, gli endpoint /push/* rispondono 503 e nessuna notifica viene
    # inviata — il resto dell'app continua a funzionare normalmente.
    #
    # vapid_public_key: 65 byte uncompressed EC point (curva SECP256R1)
    #   codificato come base64url SENZA padding. Questa è la chiave che il
    #   client riceve da GET /push/vapid-public-key e passa a
    #   PushManager.subscribe come applicationServerKey.
    # vapid_private_key: la STESSA chiave privata in formato PKCS8 DER
    #   codificato base64url (NON raw 32 byte, NON PEM). È il formato
    #   accettato da pywebpush.Vapid.from_string().
    #   Vedi reference_push_setup.md per lo script di generazione.
    vapid_public_key: str | None = None
    vapid_private_key: str | None = None
    vapid_subject: str = "mailto:amosh85@gmail.com"

    @property
    def allowed_origins_list(self) -> list[str]:
        raw = self.allowed_origins.strip()
        if raw in ("", "*"):
            return ["*"]
        return [origin.strip() for origin in raw.split(",") if origin.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
