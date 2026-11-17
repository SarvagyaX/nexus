import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_settings_support_testing_environment_and_hide_database_url() -> None:
    settings = Settings(
        _env_file=None,
        APP_ENV="testing",
        POSTGRES_URL="postgresql://test:test@localhost/nexus_test",
        REDIS_URL="redis://localhost:6379/0",
        LLM_PROVIDER="mock",
        LLM_API_KEY="test-key",
    )

    assert settings.app_env == "testing"
    assert settings.sqlalchemy_database_url.startswith("postgresql+psycopg://")
    assert "test:test" not in repr(settings)
    assert "test-key" not in repr(settings)


def test_settings_reject_unknown_environment() -> None:
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            APP_ENV="staging",
            POSTGRES_URL="postgresql://test:test@localhost/nexus_test",
        )


def test_settings_require_database_url() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, APP_ENV="testing")


def test_production_rejects_demo_auth_and_insecure_cookies() -> None:
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            APP_ENV="production",
            POSTGRES_URL="postgresql://produser:StrongProdPass123!@localhost/nexus_prod",
            DEMO_AUTH_ENABLED=True,
            SESSION_COOKIE_SECURE=True,
        )

    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            APP_ENV="production",
            POSTGRES_URL="postgresql://produser:StrongProdPass123!@localhost/nexus_prod",
            DEMO_AUTH_ENABLED=False,
            SESSION_COOKIE_SECURE=False,
        )


def test_production_rejects_insecure_placeholders() -> None:
    with pytest.raises(ValidationError, match="insecure default placeholder"):
        Settings(
            _env_file=None,
            APP_ENV="production",
            POSTGRES_URL="postgresql://nexus_dev:replace-with-a-local-development-password@postgres:5432/nexus_dev",
            DEMO_AUTH_ENABLED=False,
            SESSION_COOKIE_SECURE=True,
        )

    with pytest.raises(ValidationError, match="insecure default placeholder"):
        Settings(
            _env_file=None,
            APP_ENV="production",
            POSTGRES_URL="postgresql://nexus_dev:nexus_local_dev_2026@postgres:5432/nexus_dev",
            DEMO_AUTH_ENABLED=False,
            SESSION_COOKIE_SECURE=True,
        )


def test_trusted_hosts_configuration() -> None:
    settings_default = Settings(
        _env_file=None,
        APP_ENV="testing",
        POSTGRES_URL="postgresql://test:test@localhost/nexus_test",
    )
    assert settings_default.trusted_hosts_list == ["*"]

    settings_custom = Settings(
        _env_file=None,
        APP_ENV="testing",
        POSTGRES_URL="postgresql://test:test@localhost/nexus_test",
        TRUSTED_HOSTS="nexus.example.com, api.nexus.local",
    )
    assert settings_custom.trusted_hosts_list == ["nexus.example.com", "api.nexus.local"]


def test_frontend_origin_must_be_a_single_origin_without_path() -> None:
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            APP_ENV="testing",
            POSTGRES_URL="postgresql://test:test@localhost/nexus_test",
            FRONTEND_ORIGIN="https://example.com/path",
        )
