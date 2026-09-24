"""Per-series derived metrics.

Everything here is computed once per pipeline run and written to
`analytics.series_metrics` / `analytics.series_snapshot`, so the API stays a
thin read layer and the dashboard never waits on a window function.

Two details that matter for correctness:

* **Year-over-year needs the series frequency**, not a fixed row offset. A
  monthly series needs a 12-row lag, a quarterly one 4, a daily one ~252
  trading rows. `periods_per_year` resolves that from the FRED frequency code.
* **Percent-type series are differenced, not divided.** A move in the
  unemployment rate from 4.0 to 4.4 is "+0.4pp", not "+10%". `pct_12m` is left
  as the ratio change only where a ratio is meaningful; `diff_12m` always
  carries the absolute change and the frontend picks the right one per unit.
"""

from __future__ import annotations

import json
import logging
from datetime import date

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

SPARK_POINTS = 60

# FRED frequency_short -> observations per calendar year.
PERIODS_PER_YEAR: dict[str, int] = {
    "D": 252,   # business-daily
    "W": 52,
    "BW": 26,
    "M": 12,
    "Q": 4,
    "SA": 2,
    "A": 1,
}


def periods_per_year(frequency_short: str | None) -> int:
    if not frequency_short:
        return 12
    return PERIODS_PER_YEAR.get(frequency_short.strip().upper(), 12)


def _safe_pct(current: pd.Series, previous: pd.Series) -> pd.Series:
    """Percent change that yields NaN (not inf) when the base is zero."""
    base = previous.replace(0.0, np.nan)
    return (current / base - 1.0) * 100.0


def compute_series_metrics(frame: pd.DataFrame, frequency_short: str | None) -> pd.DataFrame:
    """Build the derived panel for a single series.

    `frame` must be indexed by observation date, ascending, with a `value`
    column. Missing observations are dropped first so lags count real periods.
    """
    df = frame.dropna(subset=["value"]).sort_index().copy()
    if df.empty:
        return df.assign(**{c: pd.Series(dtype="float64") for c in _METRIC_COLUMNS})

    ppy = periods_per_year(frequency_short)
    value = df["value"].astype("float64")

    df["change_1p"] = value.diff()
    df["pct_1p"] = _safe_pct(value, value.shift(1))
    df["pct_3p"] = _safe_pct(value, value.shift(3))
    df["pct_12m"] = _safe_pct(value, value.shift(ppy))
    df["diff_12m"] = value - value.shift(ppy)

    # Annualised rate of the most recent period's change, which is how monthly
    # inflation and quarterly GDP are quoted in practice.
    with np.errstate(over="ignore", invalid="ignore"):
        ratio = (value / value.shift(1)).replace([np.inf, -np.inf], np.nan)
        df["annualized_1p"] = (np.power(ratio.where(ratio > 0), ppy) - 1.0) * 100.0

    df["rolling_3"] = value.rolling(3, min_periods=2).mean()
    df["rolling_12"] = value.rolling(ppy, min_periods=max(2, ppy // 2)).mean()

    # Trailing 5-year z-score: where does today sit against its own recent past?
    win5 = max(ppy * 5, 8)
    roll5 = value.rolling(win5, min_periods=max(8, win5 // 4))
    std5 = roll5.std().replace(0.0, np.nan)
    df["zscore_5y"] = (value - roll5.mean()) / std5

    # Trailing 10-year percentile rank, 0 = lowest in a decade, 1 = highest.
    win10 = max(ppy * 10, 12)
    df["pctile_10y"] = (
        value.rolling(win10, min_periods=max(12, win10 // 4))
        .rank(pct=True)
        .astype("float64")
    )

    running_max = value.cummax().replace(0.0, np.nan)
    df["drawdown"] = (value / running_max - 1.0) * 100.0

    return df.replace([np.inf, -np.inf], np.nan)


_METRIC_COLUMNS = (
    "change_1p",
    "pct_1p",
    "pct_3p",
    "pct_12m",
    "diff_12m",
    "annualized_1p",
    "rolling_3",
    "rolling_12",
    "zscore_5y",
    "pctile_10y",
    "drawdown",
)


def _clean(x: object) -> float | None:
    if x is None:
        return None
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return None if (np.isnan(f) or np.isinf(f)) else f


def build_snapshot(
    series_id: str,
    metrics: pd.DataFrame,
    frequency_short: str | None,
    as_of: date,
) -> dict | None:
    """Collapse a metrics panel into the single row the cards read."""
    if metrics.empty:
        return None

    ppy = periods_per_year(frequency_short)
    last = metrics.iloc[-1]
    latest_date = metrics.index[-1].date()
    value = metrics["value"]
    tail_5y = value.tail(max(ppy * 5, 8))

    spark_frame = metrics.tail(SPARK_POINTS)
    spark = [
        {"d": idx.date().isoformat(), "v": _clean(v)}
        for idx, v in zip(spark_frame.index, spark_frame["value"], strict=True)
    ]

    return {
        "series_id": series_id,
        "latest_date": latest_date,
        "latest_value": _clean(last["value"]),
        "previous_value": _clean(value.iloc[-2]) if len(value) > 1 else None,
        "change_1p": _clean(last.get("change_1p")),
        "pct_1p": _clean(last.get("pct_1p")),
        "pct_12m": _clean(last.get("pct_12m")),
        "diff_12m": _clean(last.get("diff_12m")),
        "zscore_5y": _clean(last.get("zscore_5y")),
        "pctile_10y": _clean(last.get("pctile_10y")),
        "min_5y": _clean(tail_5y.min()),
        "max_5y": _clean(tail_5y.max()),
        "obs_count": int(len(metrics)),
        "history_start": metrics.index[0].date(),
        "stale_days": (as_of - latest_date).days,
        "spark": json.dumps(spark),
    }
