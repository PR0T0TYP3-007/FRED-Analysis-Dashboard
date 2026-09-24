"""Tests for the analytical logic.

These cover the places where a silent error would put a wrong number on the
dashboard without anything failing: frequency-aware lags, the Sahm rule, episode
dating, the lead/lag sign convention, and the backtest's honesty about a model
that cannot beat a naive baseline.
"""

from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd
import pytest

from app.analytics import relationships, signals, transforms
from app.analytics.forecast import backtest, forecast_series


def monthly(values: list[float], start: str = "2010-01-01") -> pd.Series:
    index = pd.date_range(start, periods=len(values), freq="MS")
    return pd.Series(values, index=index, dtype="float64")


# --------------------------------------------------------------------------- #
# transforms
# --------------------------------------------------------------------------- #
class TestPeriodsPerYear:
    @pytest.mark.parametrize(
        ("code", "expected"),
        [("M", 12), ("Q", 4), ("A", 1), ("D", 252), ("W", 52), (None, 12), ("zzz", 12)],
    )
    def test_maps_frequency_codes(self, code, expected):
        assert transforms.periods_per_year(code) == expected


class TestSeriesMetrics:
    def test_yoy_uses_series_frequency_not_a_fixed_offset(self):
        """A quarterly series must look back 4 rows for a year, not 12."""
        index = pd.date_range("2015-01-01", periods=12, freq="QS")
        values = pd.Series([100.0 * (1.02**i) for i in range(12)], index=index)

        result = transforms.compute_series_metrics(values.to_frame("value"), "Q")

        # Four quarters of 2% compounding is ~8.24% year over year.
        assert result["pct_12m"].iloc[-1] == pytest.approx(8.2432, abs=1e-3)
        # Reading it as a monthly series would have produced NaN here.
        assert not np.isnan(result["pct_12m"].iloc[-1])

    def test_yoy_on_monthly_series(self):
        values = monthly([100.0] * 12 + [110.0])
        result = transforms.compute_series_metrics(values.to_frame("value"), "M")
        assert result["pct_12m"].iloc[-1] == pytest.approx(10.0)
        assert result["diff_12m"].iloc[-1] == pytest.approx(10.0)

    def test_zero_base_yields_nan_not_infinity(self):
        """A zero previous value must not produce inf and poison the JSON."""
        values = monthly([0.0, 5.0, 10.0])
        result = transforms.compute_series_metrics(values.to_frame("value"), "M")
        assert np.isnan(result["pct_1p"].iloc[1])
        assert not np.isinf(result.select_dtypes("float64").to_numpy()).any()

    def test_drawdown_is_zero_at_a_new_high(self):
        values = monthly([10.0, 20.0, 15.0, 25.0])
        result = transforms.compute_series_metrics(values.to_frame("value"), "M")
        assert result["drawdown"].iloc[-1] == pytest.approx(0.0)
        assert result["drawdown"].iloc[2] == pytest.approx(-25.0)

    def test_empty_input_is_handled(self):
        empty = pd.DataFrame({"value": pd.Series(dtype="float64")})
        assert transforms.compute_series_metrics(empty, "M").empty

    def test_snapshot_reports_staleness_against_as_of(self):
        values = monthly([1.0] * 30, start="2020-01-01")
        metrics = transforms.compute_series_metrics(values.to_frame("value"), "M")
        snapshot = transforms.build_snapshot("TEST", metrics, "M", date(2022, 8, 1))

        assert snapshot is not None
        assert snapshot["latest_date"] == date(2022, 6, 1)
        assert snapshot["stale_days"] == 61
        assert snapshot["obs_count"] == 30


# --------------------------------------------------------------------------- #
# signals
# --------------------------------------------------------------------------- #
class TestSahmRule:
    def test_flat_unemployment_never_triggers(self):
        result = signals.sahm_rule(monthly([4.0] * 40))
        assert result.max() == pytest.approx(0.0)

    def test_fires_when_unemployment_climbs_half_a_point(self):
        # Twenty months flat, then a climb of 0.3pp per month.
        values = [3.5] * 20 + [3.8, 4.1, 4.4, 4.7, 5.0]
        result = signals.sahm_rule(monthly(values))
        assert result.iloc[-1] > signals.SAHM_TRIGGER
        assert result.iloc[0] == pytest.approx(0.0)

    def test_too_short_a_history_returns_empty(self):
        assert signals.sahm_rule(monthly([4.0] * 10)).empty


class TestEpisodes:
    def test_dates_a_contiguous_inversion(self):
        index = pd.date_range("2022-01-01", periods=100, freq="D")
        values = np.concatenate([np.ones(30), -np.ones(40), np.ones(30)])
        episodes = signals.find_episodes(
            pd.Series(values, index=index), kind="inversion", min_days=5
        )

        assert len(episodes) == 1
        assert episodes[0]["start_date"] == date(2022, 1, 31)
        assert episodes[0]["end_date"] == date(2022, 3, 11)
        assert episodes[0]["peak_value"] == pytest.approx(-1.0)

    def test_ignores_blips_shorter_than_the_minimum(self):
        index = pd.date_range("2022-01-01", periods=30, freq="D")
        values = np.ones(30)
        values[10] = -1.0  # single-day dip
        assert signals.find_episodes(pd.Series(values, index=index), "inversion", min_days=5) == []

    def test_above_threshold_episodes(self):
        values = monthly([0.0] * 5 + [0.6, 0.7] + [0.0] * 5)
        episodes = signals.find_episodes_above(values, kind="sahm", above=0.5, min_days=0)
        assert len(episodes) == 1
        assert episodes[0]["peak_value"] == pytest.approx(0.7)

    def test_recession_windows_from_the_nber_flag(self):
        values = monthly([0.0] * 4 + [1.0] * 3 + [0.0] * 4)
        episodes = signals.recession_episodes(values)
        assert len(episodes) == 1
        assert episodes[0]["start_date"] == date(2010, 5, 1)
        assert episodes[0]["end_date"] == date(2010, 7, 1)

    def test_no_episodes_in_a_quiet_series(self):
        assert signals.find_episodes(monthly([1.0] * 20), "inversion") == []


class TestSignalState:
    def test_below_threshold_signal_triggers_when_it_goes_negative(self):
        definition = signals.SignalDefinition(
            key="curve", label="Curve", description="", unit="pp",
            threshold=0.0, direction="below",
        )
        assert definition.state_for(-0.5) == "triggered"
        assert definition.state_for(2.0) == "normal"
        assert definition.state_for(None) == "unknown"

    def test_above_threshold_signal_triggers_when_it_climbs(self):
        definition = signals.SignalDefinition(
            key="sahm", label="Sahm", description="", unit="pp",
            threshold=0.5, direction="above",
        )
        assert definition.state_for(0.6) == "triggered"
        assert definition.state_for(0.1) == "normal"


class TestMacroHeat:
    def test_returns_empty_without_enough_components(self):
        assert signals.macro_heat({"UNRATE": monthly([4.0] * 10)}).empty

    def test_composite_is_standardised(self):
        rng = np.random.default_rng(0)
        panel = {
            key: pd.Series(
                rng.normal(100, 5, 240),
                index=pd.date_range("2005-01-01", periods=240, freq="MS"),
            )
            for key in ("INDPRO", "PAYEMS", "RSAFS", "UNRATE")
        }
        heat = signals.macro_heat(panel)
        assert not heat.empty
        # An equal-weight average of z-scores sits near zero on average.
        assert abs(heat.mean()) < 0.5


# --------------------------------------------------------------------------- #
# relationships
# --------------------------------------------------------------------------- #
class TestChangeTransforms:
    def test_rate_like_series_are_differenced_not_divided(self):
        """A rate goes from 4.0 to 4.4: that is +0.4pp, not +10%.

        The series needs at least `MIN_OBS` points before the function will
        publish anything, so the fixture runs two full years.
        """
        values = monthly([4.0] * 24 + [4.4])
        result = relationships.to_monthly_changes("UNRATE", values)
        assert result.iloc[-1] == pytest.approx(0.4)

    def test_level_series_use_percentage_change(self):
        values = monthly([100.0] * 24 + [110.0])
        result = relationships.to_monthly_changes("INDPRO", values)
        assert result.iloc[-1] == pytest.approx(10.0)

    def test_short_series_is_dropped(self):
        assert relationships.to_monthly_changes("INDPRO", monthly([1.0] * 5)).empty


class TestLeadLag:
    def test_negative_lag_means_the_indicator_leads(self):
        """Construct a series that genuinely leads the target by 3 months."""
        rng = np.random.default_rng(42)
        n = 200
        index = pd.date_range("2000-01-01", periods=n, freq="MS")
        driver = pd.Series(rng.normal(0, 1, n), index=index).rolling(4).mean()

        frame = pd.DataFrame(
            {
                "TARGET": driver.shift(3),   # target repeats the driver 3 months later
                "LEADER": driver,
            }
        ).dropna()

        _, best = relationships.lead_lag_rows(frame, ["TARGET"], max_lag=6)
        leader = next(row for row in best if row["series_id"] == "LEADER")

        assert leader["best_lag"] == -3, "a leading indicator must report a negative lag"
        assert leader["best_corr"] > 0.95

    def test_correlation_matrix_is_symmetric_and_unit_diagonal(self):
        rng = np.random.default_rng(1)
        index = pd.date_range("2000-01-01", periods=180, freq="MS")
        frame = pd.DataFrame(
            {"A": rng.normal(0, 1, 180), "B": rng.normal(0, 1, 180)}, index=index
        )
        rows = relationships.correlation_rows(frame)
        lookup = {(r["window_label"], r["series_a"], r["series_b"]): r["corr"] for r in rows}

        assert lookup[("full", "A", "A")] == pytest.approx(1.0)
        assert lookup[("full", "A", "B")] == pytest.approx(lookup[("full", "B", "A")])

    def test_empty_frame_yields_no_rows(self):
        assert relationships.correlation_rows(pd.DataFrame()) == []


# --------------------------------------------------------------------------- #
# forecasting
# --------------------------------------------------------------------------- #
class TestForecast:
    def test_projects_the_requested_horizon_with_an_ordered_interval(self):
        trend = monthly([100.0 + i * 0.5 for i in range(120)], start="2010-01-01")
        frame, meta = forecast_series(trend, horizon=12)

        assert len(frame) == 12
        assert (frame["lower"] <= frame["yhat"]).all()
        assert (frame["yhat"] <= frame["upper"]).all()
        # The band must widen with the horizon, not stay flat.
        width = frame["upper"] - frame["lower"]
        assert width.iloc[-1] > width.iloc[0]
        assert meta["train_end"] == trend.index[-1].date()

    def test_short_history_produces_no_forecast(self):
        frame, meta = forecast_series(monthly([1.0] * 12))
        assert frame.empty and meta == {}

    def test_backtest_reports_no_skill_on_a_random_walk(self):
        """On a pure random walk nothing should beat carrying the last value."""
        rng = np.random.default_rng(7)
        walk = monthly(list(np.cumsum(rng.normal(0, 1, 200)) + 100), start="2005-01-01")
        stats = backtest(walk)

        assert stats["folds"] > 0
        assert stats["skill"] is not None
        # Honest reporting matters more than a flattering number here.
        assert stats["skill"] < 0.25

    def test_backtest_finds_skill_on_a_clean_trend(self):
        trend = monthly([50.0 + i * 1.5 for i in range(200)], start="2005-01-01")
        stats = backtest(trend)
        assert stats["skill"] is not None and stats["skill"] > 0.5
