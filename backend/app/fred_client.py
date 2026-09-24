"""A small, well-behaved client for the FRED API.

FRED allows 120 requests/minute per key and answers a burst with HTTP 429. The
client therefore carries its own token-bucket limiter, retries transient
failures with exponential backoff, and counts calls so the ingest run can
record exactly how much of the budget it spent.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Iterable

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.config import get_settings

log = logging.getLogger(__name__)

BASE_URL = "https://api.stlouisfed.org/fred"


class FredError(RuntimeError):
    """Raised for FRED-side failures that survived the retry policy."""


class FredTransientError(FredError):
    """Rate limits, timeouts and 5xx -- worth retrying."""


@dataclass
class RateLimiter:
    """Thread-safe token bucket that smooths calls across a 60 second window."""

    max_per_minute: int
    _timestamps: list[float] = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def acquire(self) -> None:
        while True:
            with self._lock:
                now = time.monotonic()
                self._timestamps = [t for t in self._timestamps if now - t < 60.0]
                if len(self._timestamps) < self.max_per_minute:
                    self._timestamps.append(now)
                    return
                sleep_for = 60.0 - (now - self._timestamps[0]) + 0.05
            log.debug("rate limit reached, sleeping %.2fs", sleep_for)
            time.sleep(max(sleep_for, 0.01))


@dataclass(slots=True)
class Observation:
    obs_date: date
    value: float | None
    realtime_start: date | None
    realtime_end: date | None


def _parse_date(raw: str | None) -> date | None:
    if not raw or raw in {".", ""}:
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        return None


def _parse_value(raw: str | None) -> float | None:
    # FRED encodes "no observation for this period" as a single dot.
    if raw is None or raw.strip() in {".", ""}:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


class FredClient:
    """Synchronous FRED client. Safe to share across threads."""

    def __init__(
        self,
        api_key: str | None = None,
        max_per_minute: int | None = None,
        timeout: float = 30.0,
    ) -> None:
        settings = get_settings()
        self.api_key = api_key or settings.fred_api_key
        self.limiter = RateLimiter(max_per_minute or settings.fred_max_rpm)
        self._client = httpx.Client(
            base_url=BASE_URL,
            timeout=timeout,
            headers={"User-Agent": "fred-macro-warehouse/1.0"},
            transport=httpx.HTTPTransport(retries=1),
        )
        self._calls = 0
        self._calls_lock = threading.Lock()

    # -- lifecycle ------------------------------------------------------------
    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "FredClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    @property
    def call_count(self) -> int:
        with self._calls_lock:
            return self._calls

    # -- transport ------------------------------------------------------------
    @retry(
        retry=retry_if_exception_type(FredTransientError),
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=1.5, min=2, max=30),
        reraise=True,
    )
    def _get(self, path: str, params: dict[str, Any]) -> dict:
        self.limiter.acquire()
        payload = {**params, "api_key": self.api_key, "file_type": "json"}
        try:
            response = self._client.get(path, params=payload)
        except httpx.TimeoutException as exc:
            raise FredTransientError(f"timeout calling {path}") from exc
        except httpx.HTTPError as exc:
            raise FredTransientError(f"transport error calling {path}: {exc}") from exc

        with self._calls_lock:
            self._calls += 1

        if response.status_code == 429:
            raise FredTransientError("rate limited by FRED (429)")
        if response.status_code >= 500:
            raise FredTransientError(f"FRED {response.status_code} on {path}")
        if response.status_code == 400:
            # FRED returns a readable reason in the body for bad series ids.
            raise FredError(f"FRED rejected request to {path}: {response.text[:300]}")
        response.raise_for_status()
        return response.json()

    # -- endpoints ------------------------------------------------------------
    def get_series(self, series_id: str) -> dict:
        data = self._get("/series", {"series_id": series_id})
        items = data.get("seriess") or []
        if not items:
            raise FredError(f"no metadata returned for series {series_id}")
        return items[0]

    def get_observations(
        self,
        series_id: str,
        observation_start: str | date | None = None,
        observation_end: str | date | None = None,
    ) -> list[Observation]:
        params: dict[str, Any] = {"series_id": series_id, "sort_order": "asc"}
        if observation_start:
            params["observation_start"] = str(observation_start)
        if observation_end:
            params["observation_end"] = str(observation_end)

        data = self._get("/series/observations", params)
        out: list[Observation] = []
        for row in data.get("observations", []):
            obs_date = _parse_date(row.get("date"))
            if obs_date is None:
                continue
            out.append(
                Observation(
                    obs_date=obs_date,
                    value=_parse_value(row.get("value")),
                    realtime_start=_parse_date(row.get("realtime_start")),
                    realtime_end=_parse_date(row.get("realtime_end")),
                )
            )
        return out

    def get_releases_for(self, series_ids: Iterable[str]) -> dict[str, dict]:
        """Metadata for several series, one call each (FRED has no batch endpoint)."""
        return {sid: self.get_series(sid) for sid in series_ids}
