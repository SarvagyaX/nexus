"""Validated application settings sourced from environment or local .env files."""

from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Secrets are never rendered by model repr."""

    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_env: Literal["development", "testing", "production"] = Field(
        default="development", validation_alias="APP_ENV"
    )
    backend_host: str = Field(default="0.0.0.0", validation_alias="BACKEND_HOST")
    backend_port: int = Field(default=8000, ge=1, le=65535, validation_alias="BACKEND_PORT")
    postgres_url: SecretStr = Field(validation_alias="POSTGRES_URL")
    redis_url: SecretStr | None = Field(default=None, validation_alias="REDIS_URL")
    llm_provider: str = Field(default="mock", validation_alias="LLM_PROVIDER")
    llm_api_key: SecretStr | None = Field(default=None, validation_alias="LLM_API_KEY")
    ollama_base_url: str = Field(default="http://localhost:11434", validation_alias="OLLAMA_BASE_URL")
    llm_model: str = Field(default="llama3.2", validation_alias="LLM_MODEL")
    frontend_origin: str = Field(default="http://localhost:5173", validation_alias="FRONTEND_ORIGIN")
    demo_auth_enabled: bool = Field(default=False, validation_alias="DEMO_AUTH_ENABLED")
    demo_admin_email: str | None = Field(default=None, validation_alias="DEMO_ADMIN_EMAIL")
    demo_admin_password: SecretStr | None = Field(default=None, validation_alias="DEMO_ADMIN_PASSWORD")
    demo_admin_display_name: str = Field(default="NEXUS Demo Administrator", validation_alias="DEMO_ADMIN_DISPLAY_NAME")
    demo_workspace_name: str = Field(default="NEXUS Demo", validation_alias="DEMO_WORKSPACE_NAME")
    demo_workspace_slug: str = Field(default="nexus-demo", validation_alias="DEMO_WORKSPACE_SLUG")
    session_cookie_secure: bool | None = Field(default=None, validation_alias="SESSION_COOKIE_SECURE")
    session_ttl_seconds: int = Field(default=43_200, ge=300, le=2_592_000, validation_alias="SESSION_TTL_SECONDS")
    service_name: str = "nexus-api"
    trusted_hosts: str = Field(default="*", validation_alias="TRUSTED_HOSTS")

    # Notification & Delivery Settings (Optional SMTP & Outbound Webhooks)
    smtp_host: str | None = Field(default=None, validation_alias="SMTP_HOST")
    smtp_port: int = Field(default=587, validation_alias="SMTP_PORT")
    smtp_user: str | None = Field(default=None, validation_alias="SMTP_USER")
    smtp_password: SecretStr | None = Field(default=None, validation_alias="SMTP_PASSWORD")
    smtp_from_email: str = Field(default="notifications@nexus.local", validation_alias="SMTP_FROM_EMAIL")
    smtp_use_tls: bool = Field(default=True, validation_alias="SMTP_USE_TLS")
    default_webhook_url: str | None = Field(default=None, validation_alias="DEFAULT_WEBHOOK_URL")

    @property
    def is_smtp_configured(self) -> bool:
        return bool(self.smtp_host and self.smtp_host.strip())

    @property
    def trusted_hosts_list(self) -> list[str]:
        if not self.trusted_hosts or self.trusted_hosts.strip() == "*":
            return ["*"]
        return [h.strip() for h in self.trusted_hosts.split(",") if h.strip()]

    @field_validator("postgres_url")
    @classmethod
    def validate_postgres_url(cls, value: SecretStr) -> SecretStr:
        url = value.get_secret_value()
        if not url.startswith(("postgresql://", "postgresql+psycopg://")):
            raise ValueError("POSTGRES_URL must use the PostgreSQL protocol")
        return value

    @model_validator(mode="after")
    def validate_auth_configuration(self) -> "Settings":
        if self.app_env == "production":
            if self.demo_auth_enabled:
                raise ValueError("DEMO_AUTH_ENABLED cannot be enabled in production")
            if self.session_cookie_secure is False:
                raise ValueError("SESSION_COOKIE_SECURE must be enabled in production")
            insecure_placeholders = {
                "replace-with-a-local-development-password",
                "replace-with-a-unique-local-demo-password",
                "nexus_local_dev_2026",
                "change-me",
                "changeme",
            }
            pg_url = self.postgres_url.get_secret_value().lower()
            for placeholder in insecure_placeholders:
                if placeholder in pg_url:
                    raise ValueError(f"POSTGRES_URL contains an insecure default placeholder: '{placeholder}'")
        origin = urlsplit(self.frontend_origin)
        if (
            origin.scheme not in {"http", "https"}
            or not origin.netloc
            or origin.path
            or origin.query
            or origin.fragment
            or origin.username
            or origin.password
            or "*" in self.frontend_origin
        ):
            raise ValueError("FRONTEND_ORIGIN must be one explicit HTTP(S) origin")
        return self

    @property
    def secure_session_cookie(self) -> bool:
        if self.session_cookie_secure is not None:
            return self.session_cookie_secure
        return self.app_env == "production"

    @property
    def sqlalchemy_database_url(self) -> str:
        """Return a psycopg SQLAlchemy URL without exposing it in repr/logs."""
        url = self.postgres_url.get_secret_value()
        if url.startswith("postgresql://"):
            return url.replace("postgresql://", "postgresql+psycopg://", 1)
        return url


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
