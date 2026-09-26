"""Security regressions.

Each test here corresponds to a real defect found during a pre-publication
audit, not a hypothetical one. They are written to fail loudly if the fix is
ever undone.
"""

from __future__ import annotations

import httpx
import pytest

from app.fred_client import FredClient, FredError, redact

FAKE_KEY = "SECRET_KEY_abcdef0123456789abcd"


def _client_with(handler) -> FredClient:
    client = FredClient(api_key=FAKE_KEY, max_per_minute=10_000)
    client._client = httpx.Client(
        base_url="https://api.stlouisfed.org/fred",
        transport=httpx.MockTransport(handler),
    )
    return client


class TestKeyRedaction:
    """The key travels in the query string, and httpx embeds the full URL in
    its error messages. Those messages are persisted to core.ingest_series_log
    and served by the public pipeline endpoint, so an unsanitised error is a
    credential disclosure."""

    def test_redacts_a_key_in_a_url(self):
        url = "https://api.stlouisfed.org/fred/series?series_id=X&api_key=abc123DEF&file_type=json"
        cleaned = redact(url)
        assert "abc123DEF" not in cleaned
        assert "api_key=***REDACTED***" in cleaned

    def test_redacts_the_literal_key_anywhere(self):
        assert FAKE_KEY not in redact(f"boom {FAKE_KEY} boom", FAKE_KEY)

    def test_leaves_innocent_text_alone(self):
        assert redact("timeout calling /series") == "timeout calling /series"

    @pytest.mark.parametrize("status", [401, 403, 404, 418, 451])
    def test_no_http_error_exposes_the_key(self, status):
        """A 403 is what FRED returns for a revoked key -- the case most likely
        to hit this path is exactly the one that must not echo it back."""

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(status, text="denied")

        with _client_with(handler) as client:
            with pytest.raises(FredError) as caught:
                client.get_series("UNRATE")

        message = str(caught.value)
        assert FAKE_KEY not in message, f"{status} leaked the API key"
        assert "api_key=" not in message or "REDACTED" in message

    def test_bad_request_body_does_not_echo_the_key(self):
        """FRED sometimes reflects the request back in a 400 body."""

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(400, text=f"Bad Request for api_key={FAKE_KEY}")

        with _client_with(handler) as client:
            with pytest.raises(FredError) as caught:
                client.get_series("UNRATE")

        assert FAKE_KEY not in str(caught.value)

    def test_non_json_body_fails_without_leaking(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, text="<html>gateway</html>")

        with _client_with(handler) as client:
            with pytest.raises(FredError) as caught:
                client.get_series("UNRATE")

        assert FAKE_KEY not in str(caught.value)


class TestRefreshEndpointGuard:
    """POST /api/pipeline/refresh spends ~90 calls of a 120/minute budget and
    rebuilds every derived table. It must not be anonymously triggerable."""

    def test_disabled_when_no_token_is_configured(self, monkeypatch):
        from app.api.routers import pipeline

        monkeypatch.setattr(
            pipeline, "get_settings", lambda: _settings_with_token("")
        )
        with pytest.raises(Exception) as caught:
            pipeline._require_admin("anything")
        assert getattr(caught.value, "status_code", None) == 404

    def test_wrong_token_is_refused(self, monkeypatch):
        from app.api.routers import pipeline

        monkeypatch.setattr(
            pipeline, "get_settings", lambda: _settings_with_token("correct-token")
        )
        with pytest.raises(Exception) as caught:
            pipeline._require_admin("wrong-token")
        assert getattr(caught.value, "status_code", None) == 404

    def test_missing_token_is_refused(self, monkeypatch):
        from app.api.routers import pipeline

        monkeypatch.setattr(
            pipeline, "get_settings", lambda: _settings_with_token("correct-token")
        )
        with pytest.raises(Exception):
            pipeline._require_admin(None)

    def test_correct_token_is_accepted(self, monkeypatch):
        from app.api.routers import pipeline

        monkeypatch.setattr(
            pipeline, "get_settings", lambda: _settings_with_token("correct-token")
        )
        pipeline._require_admin("correct-token")  # must not raise

    def test_refusal_does_not_distinguish_disabled_from_wrong(self, monkeypatch):
        """Both cases answer 404 so probing cannot tell them apart."""
        from app.api.routers import pipeline

        codes = []
        for configured, supplied in [("", "guess"), ("real-token", "guess")]:
            monkeypatch.setattr(
                pipeline, "get_settings", lambda c=configured: _settings_with_token(c)
            )
            try:
                pipeline._require_admin(supplied)
            except Exception as exc:  # noqa: BLE001
                codes.append(getattr(exc, "status_code", None))
        assert codes == [404, 404]


class _Stub:
    def __init__(self, token: str) -> None:
        self.admin_token = token


def _settings_with_token(token: str) -> _Stub:
    return _Stub(token)


class TestSqlParameterisation:
    """The routers build WHERE clauses by joining fragments. The fragments are
    literals and every value is bound -- this pins that invariant."""

    def test_no_router_interpolates_a_value_into_sql(self):
        import pathlib
        import re

        routers = pathlib.Path(__file__).resolve().parents[1] / "app" / "api" / "routers"
        # An f-string SQL line that contains a brace expression which is not one
        # of the known-safe literal joins would be a finding.
        allowed = {'{" and ".join(clauses)}', "{clause}"}
        offenders: list[str] = []
        for path in routers.glob("*.py"):
            for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                for expr in re.findall(r"\{[^}]+\}", line):
                    if expr in allowed:
                        continue
                    if "select" in line.lower() or "where" in line.lower():
                        if "f\"" in line or "f'" in line:
                            offenders.append(f"{path.name}:{number}: {expr}")
        assert not offenders, "possible SQL interpolation: " + "; ".join(offenders)
