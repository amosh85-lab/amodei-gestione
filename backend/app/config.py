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

    @property
    def allowed_origins_list(self) -> list[str]:
        raw = self.allowed_origins.strip()
        if raw in ("", "*"):
            return ["*"]
        return [origin.strip() for origin in raw.split(",") if origin.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
