"""Typed runtime configuration, loaded once from the project-root .env file."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = PROJECT_ROOT / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore"
    )

    fred_api_key: str = Field(alias="FRED_API_KEY")
    database_url: str = Field(alias="DATABASE_URL")

    fred_max_rpm: int = Field(default=110, alias="FRED_MAX_RPM")
    fred_observation_start: str = Field(default="1960-01-01", alias="FRED_OBSERVATION_START")
    ingest_concurrency: int = Field(default=6, alias="INGEST_CONCURRENCY")

    schedule_cron_hour: int = Field(default=7, alias="SCHEDULE_CRON_HOUR")
    schedule_cron_minute: int = Field(default=30, alias="SCHEDULE_CRON_MINUTE")
    schedule_timezone: str = Field(default="America/New_York", alias="SCHEDULE_TIMEZONE")

    api_host: str = Field(default="127.0.0.1", alias="API_HOST")
    api_port: int = Field(default=8000, alias="API_PORT")
    cors_origins: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173", alias="CORS_ORIGINS"
    )

    @field_validator("fred_api_key")
    @classmethod
    def _check_key(cls, v: str) -> str:
        if not v or len(v) < 16:
            raise ValueError(
                "FRED_API_KEY looks invalid. Get one at "
                "https://fredaccount.stlouisfed.org/apikeys and put it in .env"
            )
        return v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def admin_database_url(self) -> str:
        """Same server, but pointed at the always-present `postgres` database.

        Used only to CREATE DATABASE on first run.
        """
        base, _, _ = self.database_url.rpartition("/")
        return f"{base}/postgres"

    @property
    def database_name(self) -> str:
        return self.database_url.rpartition("/")[2].split("?")[0]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
