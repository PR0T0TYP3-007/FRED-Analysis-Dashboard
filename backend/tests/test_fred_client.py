"""Tests for the FRED client's parsing and rate limiting.

The ingest layer is only as reliable as its handling of FRED's quirks: missing
observations arrive as a literal ".", and the API answers a burst with a 429.
"""

from __future__ import annotations

import time
from datetime import date

import httpx
import pytest

from app.fred_client import (
    FredClient,
    FredError,
    FredTransientError,
    RateLimiter,
    _parse_date,
    _parse_value,
)


class TestValueParsing:
    @pytest.mark.parametrize("raw", [".", "", "  ", None])
    def test_missing_observations_become_none(self, raw):
        """FRED encodes a gap as a dot; it must not become 0.0."""
        assert _parse_value(raw) is None

    @pytest.mark.parametrize(("raw", "expected"), [("4.1", 4.1), ("-0.25", -0.25), ("0", 0.0)])
    def test_numbers_parse(self, raw, expected):
        assert _parse_value(raw) == pytest.approx(expected)

    def test_garbage_is_none_rather_than_an_exception(self):
        assert _parse_value("n/a") is None


class TestDateParsing:
    def test_iso_dates_parse(self):
        assert _parse_date("2024-03-01") == date(2024, 3, 1)

    @pytest.mark.parametrize("raw", [".", "", None, "not-a-date", "2024-13-45"])
    def test_bad_dates_become_none(self, raw):
        assert _parse_date(raw) is None


class TestRateLimiter:
    def test_allows_calls_up_to_the_budget_without_blocking(self):
        limiter = RateLimiter(max_per_minute=5)
        started = time.monotonic()
        for _ in range(5):
            limiter.acquire()
        assert time.monotonic() - started < 0.5

    def test_prunes_timestamps_older_than_the_window(self):
        limiter = RateLimiter(max_per_minute=2)
        limiter._timestamps = [time.monotonic() - 61.0, time.monotonic() - 70.0]
        started = time.monotonic()
        limiter.acquire()
        assert time.monotonic() - started < 0.5


def _client_with(handler) -> FredClient:
    client = FredClient(api_key="x" * 32, max_per_minute=1000)
    client._client = httpx.Client(
        base_url="https://api.stlouisfed.org/fred",
        transport=httpx.MockTransport(handler),
    )
    return client


class TestTransport:
    def test_observations_parse_into_typed_rows(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "observations": [
                        {"date": "2024-01-01", "value": "4.1",
                         "realtime_start": "2024-02-02", "realtime_end": "9999-12-31"},
                        {"date": "2024-02-01", "value": ".",
                         "realtime_start": "2024-03-01", "realtime_end": "9999-12-31"},
                    ]
                },
            )

        with _client_with(handler) as client:
            rows = client.get_observations("UNRATE")

        assert len(rows) == 2
        assert rows[0].obs_date == date(2024, 1, 1) and rows[0].value == pytest.approx(4.1)
        assert rows[1].value is None, "a gap must survive as NULL, not become zero"

    def test_rate_limit_is_retried_then_surfaces(self):
        calls = {"n": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            calls["n"] += 1
            return httpx.Response(429, text="too many requests")

        with _client_with(handler) as client:
            with pytest.raises(FredTransientError):
                client.get_series("UNRATE")

        assert calls["n"] == 5, "the retry policy should make five attempts"

    def test_bad_series_id_fails_fast_without_retrying(self):
        calls = {"n": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            calls["n"] += 1
            return httpx.Response(400, text="Bad Request. The series does not exist.")

        with _client_with(handler) as client:
            with pytest.raises(FredError):
                client.get_series("NOPE")

        assert calls["n"] == 1, "a 400 is permanent; retrying it just wastes budget"

    def test_api_calls_are_counted(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"seriess": [{"title": "T"}]})

        with _client_with(handler) as client:
            client.get_series("UNRATE")
            client.get_series("CPIAUCSL")
            assert client.call_count == 2

    def test_empty_metadata_is_an_error(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"seriess": []})

        with _client_with(handler) as client:
            with pytest.raises(FredError, match="no metadata"):
                client.get_series("UNRATE")
