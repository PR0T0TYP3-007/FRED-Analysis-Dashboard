"""Cross-series relationships: correlation matrix and lead/lag study.

Correlating two trending level series produces a number near 1.0 that means
nothing -- both go up over time. Everything here is therefore computed on
year-over-year changes (or first differences for series already expressed as a
rate), which removes the common trend and makes the coefficients interpretable.
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

# Series already expressed as a rate/percent: difference them instead of taking
# a percentage change of a percentage.
RATE_LIKE = {
    "UNRATE",
    "U6RATE",
    "CIVPART",
    "FEDFUNDS",
    "DGS2",
    "DGS10",
    "DGS30",
    "DGS3MO",
    "T10Y2Y",
    "T10Y3M",
    "MORTGAGE30US",
    "VIXCLS",
    "BAMLH0A0HYM2",
    "DRCCLACBS",
    "DRTSCILM",
    "T5YIE",
    "T10YIE",
    "T5YIFR",
    "UMCSENT",
}

WINDOWS: dict[str, int | None] = {"5y": 60, "10y": 120, "full": None}
MIN_OBS = 24
MAX_LAG_MONTHS = 12


def to_monthly_changes(series_id: str, series: pd.Series) -> pd.Series:
    """Month-end resample, then de-trend into a comparable change measure."""
    monthly = series.dropna().resample("MS").last().dropna()
    if len(monthly) < MIN_OBS:
        return pd.Series(dtype="float64")
    if series_id in RATE_LIKE:
        return monthly.diff(12).dropna()  # year-over-year change in percentage points
    return ((monthly / monthly.shift(12) - 1.0) * 100.0).replace(
        [np.inf, -np.inf], np.nan
    ).dropna()


def build_change_frame(panel: dict[str, pd.Series], series_ids: list[str]) -> pd.DataFrame:
    columns = {}
    for series_id in series_ids:
        raw = panel.get(series_id)
        if raw is None:
            continue
        changes = to_monthly_changes(series_id, raw)
        if not changes.empty:
            columns[series_id] = changes
    if not columns:
        return pd.DataFrame()
    return pd.DataFrame(columns).sort_index()


def correlation_rows(frame: pd.DataFrame) -> list[dict]:
    """Pairwise Pearson correlations over each window, long-format."""
    rows: list[dict] = []
    if frame.empty:
        return rows

    for label, months in WINDOWS.items():
        window = frame if months is None else frame.tail(months)
        if window.shape[0] < MIN_OBS:
            continue
        corr = window.corr(min_periods=MIN_OBS)
        counts = window.notna().astype(int)
        pair_counts = counts.T.dot(counts)

        for a in corr.columns:
            for b in corr.columns:
                value = corr.at[a, b]
                if pd.isna(value):
                    continue
                rows.append(
                    {
                        "window_label": label,
                        "series_a": a,
                        "series_b": b,
                        "corr": float(value),
                        "n_obs": int(pair_counts.at[a, b]),
                    }
                )
    return rows


def lead_lag_rows(
    frame: pd.DataFrame, targets: list[str], max_lag: int = MAX_LAG_MONTHS
) -> tuple[list[dict], list[dict]]:
    """Cross-correlate every series against each target at +/- `max_lag` months.

    A negative lag means the series moves *before* the target: shifting the
    series forward in time lines it up with the target's later move, which is
    what makes an indicator leading rather than coincident.
    """
    detail: list[dict] = []
    best: list[dict] = []
    if frame.empty:
        return detail, best

    for target in targets:
        if target not in frame.columns:
            continue
        target_series = frame[target]
        for series_id in frame.columns:
            if series_id == target:
                continue
            candidate = frame[series_id]
            scores: dict[int, float] = {}
            for lag in range(-max_lag, max_lag + 1):
                shifted = candidate.shift(-lag)
                joined = pd.concat([target_series, shifted], axis=1).dropna()
                if len(joined) < MIN_OBS:
                    continue
                value = joined.iloc[:, 0].corr(joined.iloc[:, 1])
                if pd.isna(value):
                    continue
                scores[lag] = float(value)
                detail.append(
                    {
                        "target_id": target,
                        "series_id": series_id,
                        "lag_months": lag,
                        "corr": float(value),
                    }
                )
            if not scores:
                continue
            best_lag = max(scores, key=lambda k: abs(scores[k]))
            best.append(
                {
                    "target_id": target,
                    "series_id": series_id,
                    "best_lag": best_lag,
                    "best_corr": scores[best_lag],
                    "contemp_corr": scores.get(0),
                }
            )
    return detail, best
