"""Orchestrates the transform half of the pipeline.

Reads the whole raw panel once, runs every analytics stage over it in memory,
then replaces the derived tables inside a single transaction. Readers either
see the previous complete set of results or the new one -- never a half-built
mixture.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import date, datetime

import numpy as np
import pandas as pd
import psycopg
from psycopg.rows import dict_row

from app.analytics import forecast as forecast_mod
from app.analytics import relationships, signals, transforms
from app.config import get_settings
from app.series_catalog import (
    CORRELATION_SERIES,
    FORECAST_SERIES,
    LEAD_LAG_TARGETS,
)

log = logging.getLogger(__name__)


# -----------------------------------------------------------------------------
# loading
# -----------------------------------------------------------------------------
def load_panel(conn: psycopg.Connection) -> tuple[dict[str, pd.Series], dict[str, dict]]:
    """Pull every active series into memory as a dict of date-indexed Series."""
    with conn.cursor() as cur:
        cur.execute(
            """select series_id, frequency_short, unit_kind, category, display_name
                 from core.series where is_active"""
        )
        meta = {r["series_id"]: r for r in cur.fetchall()}

        cur.execute(
            """select series_id, obs_date, value
                 from core.observations
                where value is not null
                order by series_id, obs_date"""
        )
        rows = cur.fetchall()

    if not rows:
        return {}, meta

    frame = pd.DataFrame(rows)
    frame["obs_date"] = pd.to_datetime(frame["obs_date"])
    panel: dict[str, pd.Series] = {}
    for series_id, chunk in frame.groupby("series_id", sort=False):
        series = chunk.set_index("obs_date")["value"].astype("float64").sort_index()
        panel[str(series_id)] = series[~series.index.duplicated(keep="last")]
    return panel, meta


def _f(x: object) -> float | None:
    if x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return None if (np.isnan(v) or np.isinf(v)) else v


# -----------------------------------------------------------------------------
# stages
# -----------------------------------------------------------------------------
def stage_metrics(
    conn: psycopg.Connection,
    panel: dict[str, pd.Series],
    meta: dict[str, dict],
    as_of: date,
) -> dict[str, int]:
    metric_rows: list[tuple] = []
    snapshot_rows: list[tuple] = []

    for series_id, series in panel.items():
        frequency = (meta.get(series_id) or {}).get("frequency_short")
        computed = transforms.compute_series_metrics(series.to_frame("value"), frequency)
        if computed.empty:
            continue

        for idx, row in computed.iterrows():
            metric_rows.append(
                (
                    series_id,
                    idx.date(),
                    _f(row["value"]),
                    _f(row.get("change_1p")),
                    _f(row.get("pct_1p")),
                    _f(row.get("pct_3p")),
                    _f(row.get("pct_12m")),
                    _f(row.get("diff_12m")),
                    _f(row.get("annualized_1p")),
                    _f(row.get("rolling_3")),
                    _f(row.get("rolling_12")),
                    _f(row.get("zscore_5y")),
                    _f(row.get("pctile_10y")),
                    _f(row.get("drawdown")),
                )
            )

        snapshot = transforms.build_snapshot(series_id, computed, frequency, as_of)
        if snapshot:
            snapshot_rows.append(tuple(snapshot[k] for k in _SNAPSHOT_KEYS))

    with conn.cursor() as cur:
        cur.execute("truncate analytics.series_metrics")
        if metric_rows:
            with cur.copy(
                """copy analytics.series_metrics (
                       series_id, obs_date, value, change_1p, pct_1p, pct_3p, pct_12m,
                       diff_12m, annualized_1p, rolling_3, rolling_12, zscore_5y,
                       pctile_10y, drawdown
                   ) from stdin"""
            ) as copy:
                for row in metric_rows:
                    copy.write_row(row)

        cur.execute("truncate analytics.series_snapshot")
        if snapshot_rows:
            cur.executemany(
                f"""insert into analytics.series_snapshot ({", ".join(_SNAPSHOT_KEYS)})
                    values ({", ".join(["%s"] * len(_SNAPSHOT_KEYS))})""",
                snapshot_rows,
            )

    return {"metric_rows": len(metric_rows), "snapshots": len(snapshot_rows)}


_SNAPSHOT_KEYS = (
    "series_id",
    "latest_date",
    "latest_value",
    "previous_value",
    "change_1p",
    "pct_1p",
    "pct_12m",
    "diff_12m",
    "zscore_5y",
    "pctile_10y",
    "min_5y",
    "max_5y",
    "obs_count",
    "history_start",
    "stale_days",
    "spark",
)


def stage_signals(conn: psycopg.Connection, panel: dict[str, pd.Series]) -> dict[str, int]:
    definitions = signals.yield_curve_signals(panel)

    if "UNRATE" in panel:
        sahm = signals.sahm_rule(panel["UNRATE"])
        if not sahm.empty:
            definitions.append(
                signals.SignalDefinition(
                    key="sahm_rule",
                    label="Sahm Rule",
                    description=(
                        "Three-month average unemployment rate minus its lowest "
                        "reading in the previous twelve months. Recomputed here from "
                        "UNRATE; 0.50 and above has marked the start of a recession."
                    ),
                    unit="pp",
                    threshold=signals.SAHM_TRIGGER,
                    direction="above",
                    series=sahm,
                )
            )

    if "BAMLH0A0HYM2" in panel:
        stress = signals.credit_stress(panel["BAMLH0A0HYM2"])
        if not stress.empty:
            definitions.append(
                signals.SignalDefinition(
                    key="credit_stress",
                    label="Credit Stress",
                    description=(
                        "High-yield corporate spread expressed as its trailing "
                        "ten-year percentile. Above 80 means credit is pricing risk "
                        "more harshly than in 80% of the past decade."
                    ),
                    unit="pctile",
                    threshold=80.0,
                    direction="above",
                    series=stress,
                )
            )

    heat = signals.macro_heat(panel)
    if not heat.empty:
        definitions.append(
            signals.SignalDefinition(
                key="macro_heat",
                label="Macro Heat",
                description=(
                    "Equal-weight composite z-score across production, payrolls, "
                    "retail sales, unemployment, claims, core prices, sentiment and "
                    "the curve. Positive means the economy is running above its own "
                    "long-run normal."
                ),
                unit="z",
                threshold=-0.75,
                direction="below",
                series=heat,
            )
        )

    signal_rows: list[tuple] = []
    meta_rows: list[tuple] = []
    for definition in definitions:
        series = definition.series.dropna()
        if series.empty:
            continue
        for idx, value in series.items():
            clean = _f(value)
            signal_rows.append(
                (definition.key, idx.date(), clean, definition.state_for(clean))
            )
        latest_value = _f(series.iloc[-1])
        meta_rows.append(
            (
                definition.key,
                definition.label,
                definition.description,
                definition.unit,
                definition.threshold,
                definition.direction,
                series.index[-1].date(),
                latest_value,
                definition.state_for(latest_value),
            )
        )

    # Episodes: curve inversions plus NBER-dated recessions for chart shading.
    episodes: list[dict] = []
    for definition in definitions:
        if definition.key.startswith("curve_"):
            episodes.extend(
                signals.find_episodes(definition.series, kind=f"inversion_{definition.key[6:]}")
            )
        elif definition.key == "sahm_rule":
            # Monthly series, so a single observation is already a full episode.
            episodes.extend(
                signals.find_episodes_above(
                    definition.series, kind="sahm_rule", above=signals.SAHM_TRIGGER, min_days=0
                )
            )
    if "USREC" in panel:
        episodes.extend(signals.recession_episodes(panel["USREC"]))

    with conn.cursor() as cur:
        cur.execute("truncate analytics.signals")
        if signal_rows:
            with cur.copy(
                "copy analytics.signals (signal_key, obs_date, value, state) from stdin"
            ) as copy:
                for row in signal_rows:
                    copy.write_row(row)

        cur.execute("truncate analytics.signal_meta")
        if meta_rows:
            cur.executemany(
                """insert into analytics.signal_meta
                       (signal_key, label, description, unit, threshold, direction,
                        latest_date, latest_value, latest_state)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                meta_rows,
            )

        cur.execute("truncate analytics.episodes restart identity")
        if episodes:
            cur.executemany(
                """insert into analytics.episodes
                       (kind, start_date, end_date, peak_value, length_days, note)
                   values (%(kind)s, %(start_date)s, %(end_date)s, %(peak_value)s,
                           %(length_days)s, %(note)s)
                   on conflict (kind, start_date) do nothing""",
                episodes,
            )

    return {"signal_points": len(signal_rows), "signals": len(meta_rows), "episodes": len(episodes)}


def stage_relationships(conn: psycopg.Connection, panel: dict[str, pd.Series]) -> dict[str, int]:
    frame = relationships.build_change_frame(panel, list(CORRELATION_SERIES))
    corr_rows = relationships.correlation_rows(frame)
    detail, best = relationships.lead_lag_rows(frame, list(LEAD_LAG_TARGETS))

    with conn.cursor() as cur:
        cur.execute("truncate analytics.correlations")
        if corr_rows:
            cur.executemany(
                """insert into analytics.correlations (window_label, series_a, series_b, corr, n_obs)
                   values (%(window_label)s, %(series_a)s, %(series_b)s, %(corr)s, %(n_obs)s)""",
                corr_rows,
            )

        cur.execute("truncate analytics.lead_lag")
        if detail:
            cur.executemany(
                """insert into analytics.lead_lag (target_id, series_id, lag_months, corr)
                   values (%(target_id)s, %(series_id)s, %(lag_months)s, %(corr)s)""",
                detail,
            )

        cur.execute("truncate analytics.lead_lag_best")
        if best:
            cur.executemany(
                """insert into analytics.lead_lag_best
                       (target_id, series_id, best_lag, best_corr, contemp_corr)
                   values (%(target_id)s, %(series_id)s, %(best_lag)s, %(best_corr)s,
                           %(contemp_corr)s)""",
                best,
            )

    return {"correlations": len(corr_rows), "lead_lag": len(detail), "lead_lag_best": len(best)}


def stage_forecasts(conn: psycopg.Connection, panel: dict[str, pd.Series]) -> dict[str, int]:
    forecast_rows: list[tuple] = []
    meta_rows: list[tuple] = []

    for series_id in FORECAST_SERIES:
        series = panel.get(series_id)
        if series is None:
            continue
        frame, meta = forecast_mod.forecast_series(series)
        if frame.empty or not meta:
            log.info("no forecast produced for %s", series_id)
            continue
        for idx, row in frame.iterrows():
            forecast_rows.append(
                (series_id, idx.date(), _f(row["yhat"]), _f(row["lower"]), _f(row["upper"]))
            )
        meta_rows.append(
            (
                series_id,
                meta["model"],
                meta["horizon"],
                _f(meta["mape"]),
                _f(meta["rmse"]),
                _f(meta["naive_mape"]),
                _f(meta["skill"]),
                meta["train_start"],
                meta["train_end"],
            )
        )

    with conn.cursor() as cur:
        cur.execute("truncate analytics.forecasts")
        if forecast_rows:
            cur.executemany(
                """insert into analytics.forecasts (series_id, obs_date, yhat, lower, upper)
                   values (%s, %s, %s, %s, %s)""",
                forecast_rows,
            )
        cur.execute("truncate analytics.forecast_meta")
        if meta_rows:
            cur.executemany(
                """insert into analytics.forecast_meta
                       (series_id, model, horizon, mape, rmse, naive_mape, skill,
                        train_start, train_end)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                meta_rows,
            )

    return {"forecast_points": len(forecast_rows), "forecast_series": len(meta_rows)}


# -----------------------------------------------------------------------------
# entry point
# -----------------------------------------------------------------------------
def run_analytics(skip_forecasts: bool = False) -> dict:
    settings = get_settings()
    started = time.perf_counter()
    as_of = datetime.now().date()
    stages: dict[str, dict] = {}

    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute("insert into analytics.runs default values returning run_id")
            run_id = cur.fetchone()["run_id"]
        conn.commit()

        try:
            panel, meta = load_panel(conn)
            if not panel:
                raise RuntimeError("no observations in core.observations -- run ingest first")

            log.info("loaded %d series", len(panel))
            stages["metrics"] = stage_metrics(conn, panel, meta, as_of)
            log.info("metrics: %s", stages["metrics"])
            stages["signals"] = stage_signals(conn, panel)
            log.info("signals: %s", stages["signals"])
            stages["relationships"] = stage_relationships(conn, panel)
            log.info("relationships: %s", stages["relationships"])
            if not skip_forecasts:
                stages["forecasts"] = stage_forecasts(conn, panel)
                log.info("forecasts: %s", stages["forecasts"])

            duration_ms = int((time.perf_counter() - started) * 1000)
            with conn.cursor() as cur:
                cur.execute(
                    """update analytics.runs
                          set status = 'success', finished_at = now(),
                              duration_ms = %s, stages = %s
                        where run_id = %s""",
                    (duration_ms, json.dumps(stages), run_id),
                )
            conn.commit()
        except Exception as exc:
            conn.rollback()
            with conn.cursor() as cur:
                cur.execute(
                    """update analytics.runs
                          set status = 'failed', finished_at = now(), error = %s
                        where run_id = %s""",
                    (str(exc)[:2000], run_id),
                )
            conn.commit()
            raise

    return {
        "run_id": run_id,
        "duration_ms": int((time.perf_counter() - started) * 1000),
        "stages": stages,
    }
