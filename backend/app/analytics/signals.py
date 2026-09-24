"""Composite recession / stress signals derived from the raw panel.

These are the pieces of actual macro analysis in the project -- each one is a
rule a practitioner would recognise, computed from the warehouse rather than
pulled pre-baked from FRED:

* **Yield curve spread** (10Y-2Y and 10Y-3M) with inversion episodes dated.
* **Sahm rule**, recomputed from `UNRATE` rather than downloading
  `SAHMREALTIME`, so the dashboard can show the ingredients. It fires when the
  3-month average unemployment rate rises 0.50pp above its own minimum over the
  preceding 12 months.
* **Credit stress**, the high-yield spread expressed as a trailing percentile.
* **Macro heat**, an equal-weight composite z-score across growth, labour,
  prices and financial conditions, sign-corrected so positive always means "the
  economy is running hot".
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

SAHM_TRIGGER = 0.50
INVERSION_MIN_DAYS = 10  # ignore one-off daily blips when dating episodes


@dataclass
class SignalDefinition:
    key: str
    label: str
    description: str
    unit: str
    threshold: float
    direction: str  # 'below' or 'above' -- which side is the alarm
    series: pd.Series = field(repr=False, default_factory=pd.Series)

    def state_for(self, value: float | None) -> str:
        if value is None or np.isnan(value):
            return "unknown"
        if self.direction == "below":
            if value < self.threshold:
                return "triggered"
            return "warning" if value < self.threshold + abs(self.threshold or 0.5) * 0.5 else "normal"
        if value > self.threshold:
            return "triggered"
        return "warning" if value > self.threshold * 0.75 else "normal"


def _state_series(definition: SignalDefinition) -> pd.Series:
    return definition.series.map(lambda v: definition.state_for(v))


def yield_curve_signals(panel: dict[str, pd.Series]) -> list[SignalDefinition]:
    """10Y-2Y and 10Y-3M spreads, preferring FRED's own spread series."""
    out: list[SignalDefinition] = []

    spread_2y = panel.get("T10Y2Y")
    if spread_2y is None and {"DGS10", "DGS2"} <= panel.keys():
        spread_2y = (panel["DGS10"] - panel["DGS2"]).dropna()
    if spread_2y is not None and not spread_2y.empty:
        out.append(
            SignalDefinition(
                key="curve_10y2y",
                label="10Y-2Y Curve",
                description=(
                    "Term spread between the 10-year and 2-year Treasury. A sustained "
                    "inversion has preceded every US recession since 1970."
                ),
                unit="pp",
                threshold=0.0,
                direction="below",
                series=spread_2y.dropna(),
            )
        )

    spread_3m = panel.get("T10Y3M")
    if spread_3m is None and {"DGS10", "DGS3MO"} <= panel.keys():
        spread_3m = (panel["DGS10"] - panel["DGS3MO"]).dropna()
    if spread_3m is not None and not spread_3m.empty:
        out.append(
            SignalDefinition(
                key="curve_10y3m",
                label="10Y-3M Curve",
                description=(
                    "The spread the New York Fed uses in its recession probability "
                    "model; it typically inverts later but with fewer false alarms."
                ),
                unit="pp",
                threshold=0.0,
                direction="below",
                series=spread_3m.dropna(),
            )
        )
    return out


def sahm_rule(unrate: pd.Series) -> pd.Series:
    """Real-time Sahm rule recomputed from the monthly unemployment rate.

    3-month moving average of UNRATE, minus the lowest such average over the
    preceding 12 months. Values at or above 0.50 have historically coincided
    with the early months of a recession.
    """
    monthly = unrate.dropna().resample("MS").last().dropna()
    if len(monthly) < 15:
        return pd.Series(dtype="float64")
    ma3 = monthly.rolling(3).mean()
    trailing_min = ma3.rolling(12, min_periods=12).min()
    return (ma3 - trailing_min).dropna()


def credit_stress(hy_spread: pd.Series) -> pd.Series:
    """High-yield spread as a trailing 10-year percentile, 0-100."""
    clean = hy_spread.dropna()
    if clean.empty:
        return clean
    return (clean.rolling(2520, min_periods=250).rank(pct=True) * 100).dropna()


# Components of the macro heat composite. `sign` flips series where a high
# reading means a *cold* economy, so the composite always reads one direction.
HEAT_COMPONENTS: tuple[tuple[str, str, int], ...] = (
    ("INDPRO", "yoy", +1),
    ("PAYEMS", "yoy", +1),
    ("RSAFS", "yoy", +1),
    ("UNRATE", "level", -1),
    ("ICSA", "level", -1),
    ("CPILFESL", "yoy", +1),
    ("UMCSENT", "level", +1),
    ("T10Y2Y", "level", +1),
)


def macro_heat(panel: dict[str, pd.Series]) -> pd.Series:
    """Equal-weight composite z-score of the cycle's main components."""
    parts: list[pd.Series] = []
    for series_id, mode, sign in HEAT_COMPONENTS:
        raw = panel.get(series_id)
        if raw is None or raw.dropna().empty:
            continue
        monthly = raw.dropna().resample("MS").last().dropna()
        if mode == "yoy":
            monthly = (monthly / monthly.shift(12) - 1.0) * 100.0
        monthly = monthly.dropna()
        if len(monthly) < 60:
            continue
        # Standardise against the full history so the scale is stable over time.
        std = monthly.std()
        if not std or np.isnan(std):
            continue
        parts.append(sign * (monthly - monthly.mean()) / std)

    if not parts:
        return pd.Series(dtype="float64")

    combined = pd.concat(parts, axis=1)
    # Require at least half the components present before publishing a reading.
    min_parts = max(2, combined.shape[1] // 2)
    heat = combined.mean(axis=1).where(combined.notna().sum(axis=1) >= min_parts)
    return heat.dropna()


def find_episodes(
    series: pd.Series, kind: str, below: float = 0.0, min_days: int = INVERSION_MIN_DAYS
) -> list[dict]:
    """Date contiguous stretches where `series` sits below `below`."""
    clean = series.dropna()
    if clean.empty:
        return []

    flag = clean < below
    # Group consecutive runs of the same boolean value.
    group_id = (flag != flag.shift()).cumsum()
    episodes: list[dict] = []
    for _, chunk in clean.groupby(group_id):
        if not bool(chunk.iloc[0] < below):
            continue
        start: date = chunk.index[0].date()
        end: date = chunk.index[-1].date()
        length = (end - start).days
        if length < min_days:
            continue
        episodes.append(
            {
                "kind": kind,
                "start_date": start,
                "end_date": end,
                "peak_value": float(chunk.min()),
                "length_days": length,
                "note": None,
            }
        )
    return episodes


def find_episodes_above(
    series: pd.Series, kind: str, above: float, min_days: int = 1
) -> list[dict]:
    """Date contiguous stretches where `series` sits at or above `above`."""
    clean = series.dropna()
    if clean.empty:
        return []

    flag = clean >= above
    group_id = (flag != flag.shift()).cumsum()
    episodes: list[dict] = []
    for _, chunk in clean.groupby(group_id):
        if not bool(chunk.iloc[0] >= above):
            continue
        start: date = chunk.index[0].date()
        end: date = chunk.index[-1].date()
        length = (end - start).days
        if length < min_days:
            continue
        episodes.append(
            {
                "kind": kind,
                "start_date": start,
                "end_date": end,
                "peak_value": float(chunk.max()),
                "length_days": length,
                "note": None,
            }
        )
    return episodes


def recession_episodes(usrec: pd.Series) -> list[dict]:
    """Translate the NBER 0/1 indicator into start/end pairs for chart shading."""
    clean = usrec.dropna()
    if clean.empty:
        return []
    flag = clean > 0.5
    group_id = (flag != flag.shift()).cumsum()
    episodes: list[dict] = []
    for _, chunk in clean.groupby(group_id):
        if not bool(chunk.iloc[0] > 0.5):
            continue
        start = chunk.index[0].date()
        end = chunk.index[-1].date()
        episodes.append(
            {
                "kind": "recession",
                "start_date": start,
                "end_date": end,
                "peak_value": 1.0,
                "length_days": (end - start).days,
                "note": "NBER-dated contraction",
            }
        )
    return episodes
