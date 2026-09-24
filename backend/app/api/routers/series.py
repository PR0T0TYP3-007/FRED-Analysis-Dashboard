"""Series catalog, observations and per-series detail."""

from __future__ import annotations

import json
from datetime import date

from fastapi import APIRouter, HTTPException, Query

from app import db
from app.series_catalog import CATEGORIES

router = APIRouter(prefix="/api/series", tags=["series"])

VALID_TRANSFORMS = {"level", "yoy", "mom", "index100", "zscore"}

TRANSFORM_COLUMN = {
    "level": "m.value",
    "yoy": "m.pct_12m",
    "mom": "m.pct_1p",
    "zscore": "m.zscore_5y",
}


@router.get("")
def list_series(
    category: str | None = Query(None),
    search: str | None = Query(None, description="Case-insensitive match on id or name."),
) -> dict:
    clauses = ["s.is_active"]
    params: list[object] = []
    if category and category != "all":
        clauses.append("s.category = %s")
        params.append(category)
    if search:
        clauses.append("(s.series_id ilike %s or s.display_name ilike %s or s.title ilike %s)")
        params.extend([f"%{search}%"] * 3)

    rows = db.query(
        f"""select s.series_id, s.display_name, s.title, s.category, s.unit_kind,
                   s.scale, s.units_short, s.frequency, s.frequency_short,
                   s.seasonal_adjustment_short, s.default_transform,
                   s.higher_is_better, s.priority, s.last_updated,
                   sn.latest_date, sn.latest_value, sn.pct_12m, sn.diff_12m,
                   sn.pct_1p, sn.zscore_5y, sn.pctile_10y, sn.stale_days,
                   sn.obs_count, sn.history_start, sn.spark
              from core.series s
              left join analytics.series_snapshot sn using (series_id)
             where {" and ".join(clauses)}
             order by s.category_rank, s.priority""",
        params,
    )
    for row in rows:
        if isinstance(row.get("spark"), str):
            row["spark"] = json.loads(row["spark"])

    return {
        "series": rows,
        "categories": [
            {"key": key, **value, "count": sum(1 for r in rows if r["category"] == key)}
            for key, value in CATEGORIES.items()
        ],
        "total": len(rows),
    }


@router.get("/{series_id}")
def get_series(series_id: str) -> dict:
    series_id = series_id.upper()
    meta = db.query_one(
        """select s.*, sn.latest_date, sn.latest_value, sn.previous_value,
                  sn.change_1p, sn.pct_1p, sn.pct_12m, sn.diff_12m, sn.zscore_5y,
                  sn.pctile_10y, sn.min_5y, sn.max_5y, sn.obs_count,
                  sn.history_start, sn.stale_days
             from core.series s
             left join analytics.series_snapshot sn using (series_id)
            where s.series_id = %s""",
        (series_id,),
    )
    if not meta:
        raise HTTPException(status_code=404, detail=f"unknown series {series_id}")

    forecast_meta = db.query_one(
        "select * from analytics.forecast_meta where series_id = %s", (series_id,)
    )
    return {"meta": meta, "forecast": forecast_meta}


@router.get("/{series_id}/observations")
def get_observations(
    series_id: str,
    start: date | None = Query(None),
    end: date | None = Query(None),
    transform: str = Query("level"),
) -> dict:
    series_id = series_id.upper()
    if transform not in VALID_TRANSFORMS:
        raise HTTPException(
            status_code=400,
            detail=f"transform must be one of {sorted(VALID_TRANSFORMS)}",
        )

    clauses = ["m.series_id = %s"]
    params: list[object] = [series_id]
    if start:
        clauses.append("m.obs_date >= %s")
        params.append(start)
    if end:
        clauses.append("m.obs_date <= %s")
        params.append(end)

    rows = db.query(
        f"""select m.obs_date, m.value, m.pct_1p, m.pct_12m, m.diff_12m,
                   m.rolling_3, m.rolling_12, m.zscore_5y, m.pctile_10y, m.drawdown
              from analytics.series_metrics m
             where {" and ".join(clauses)}
             order by m.obs_date""",
        params,
    )
    if not rows:
        raise HTTPException(status_code=404, detail=f"no observations for {series_id}")

    # index100 is the one transform that depends on the requested window, so it
    # is applied here rather than precomputed.
    if transform == "index100":
        base = next((r["value"] for r in rows if r["value"]), None)
        for row in rows:
            row["plotted"] = (
                None if row["value"] is None or not base else row["value"] / base * 100.0
            )
    else:
        column = TRANSFORM_COLUMN[transform].split(".")[1]
        for row in rows:
            row["plotted"] = row[column]

    return {"series_id": series_id, "transform": transform, "points": rows, "count": len(rows)}


@router.get("/{series_id}/forecast")
def get_forecast(series_id: str, history: int = Query(60, ge=12, le=600)) -> dict:
    series_id = series_id.upper()
    meta = db.query_one(
        "select * from analytics.forecast_meta where series_id = %s", (series_id,)
    )
    if not meta:
        raise HTTPException(status_code=404, detail=f"no forecast published for {series_id}")

    points = db.query(
        """select obs_date, yhat, lower, upper
             from analytics.forecasts
            where series_id = %s order by obs_date""",
        (series_id,),
    )
    actuals = db.query(
        """select obs_date, value from analytics.series_metrics
            where series_id = %s and value is not null
            order by obs_date desc limit %s""",
        (series_id, history),
    )
    return {
        "series_id": series_id,
        "meta": meta,
        "forecast": points,
        "actuals": list(reversed(actuals)),
    }


@router.get("/{series_id}/compare/{other_id}")
def compare(series_id: str, other_id: str) -> dict:
    """Two series on one normalised footing, plus their measured relationship."""
    a, b = series_id.upper(), other_id.upper()
    relationship = db.query_one(
        """select corr, n_obs from analytics.correlations
            where window_label = '10y' and series_a = %s and series_b = %s""",
        (a, b),
    )
    lead_lag = db.query_one(
        """select best_lag, best_corr, contemp_corr from analytics.lead_lag_best
            where target_id = %s and series_id = %s""",
        (a, b),
    )
    return {"a": a, "b": b, "correlation_10y": relationship, "lead_lag": lead_lag}
