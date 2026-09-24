"""Correlation matrix and the lead/lag study."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app import db
from app.series_catalog import LEAD_LAG_TARGETS

router = APIRouter(prefix="/api/correlations", tags=["relationships"])

VALID_WINDOWS = {"5y", "10y", "full"}


@router.get("")
def correlation_matrix(window: str = Query("10y")) -> dict:
    if window not in VALID_WINDOWS:
        raise HTTPException(status_code=400, detail=f"window must be one of {sorted(VALID_WINDOWS)}")

    rows = db.query(
        """select series_a, series_b, corr, n_obs
             from analytics.correlations
            where window_label = %s""",
        (window,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail=f"no correlations stored for window {window}")

    labels = db.query(
        """select s.series_id, s.display_name, s.category
             from core.series s
            where s.series_id = any(%s)""",
        (sorted({r["series_a"] for r in rows}),),
    )
    order = [row["series_id"] for row in sorted(labels, key=lambda r: (r["category"], r["series_id"]))]

    return {
        "window": window,
        "order": order,
        "labels": {r["series_id"]: r for r in labels},
        "cells": rows,
        "note": (
            "Computed on year-over-year changes, not levels: correlating two "
            "trending level series mostly measures the shared trend."
        ),
    }


@router.get("/strongest")
def strongest_pairs(window: str = Query("10y"), limit: int = Query(12, ge=1, le=50)) -> list[dict]:
    """The most strongly related distinct pairs, positive or negative."""
    return db.query(
        """select c.series_a, c.series_b, c.corr, c.n_obs,
                  sa.display_name as name_a, sb.display_name as name_b,
                  sa.category as category_a, sb.category as category_b
             from analytics.correlations c
             join core.series sa on sa.series_id = c.series_a
             join core.series sb on sb.series_id = c.series_b
            where c.window_label = %s and c.series_a < c.series_b
            order by abs(c.corr) desc
            limit %s""",
        (window, limit),
    )


@router.get("/leadlag/{target_id}")
def lead_lag(target_id: str, top: int = Query(8, ge=1, le=30)) -> dict:
    target_id = target_id.upper()
    best = db.query(
        """select b.series_id, b.best_lag, b.best_corr, b.contemp_corr,
                  s.display_name, s.category
             from analytics.lead_lag_best b
             join core.series s using (series_id)
            where b.target_id = %s
            order by abs(b.best_corr) desc
            limit %s""",
        (target_id, top),
    )
    if not best:
        raise HTTPException(status_code=404, detail=f"no lead/lag study for {target_id}")

    curves = db.query(
        """select series_id, lag_months, corr from analytics.lead_lag
            where target_id = %s and series_id = any(%s)
            order by series_id, lag_months""",
        (target_id, [r["series_id"] for r in best]),
    )
    by_series: dict[str, list[dict]] = {}
    for row in curves:
        by_series.setdefault(row["series_id"], []).append(
            {"lag": row["lag_months"], "corr": row["corr"]}
        )

    target = db.query_one(
        "select series_id, display_name, category from core.series where series_id = %s",
        (target_id,),
    )
    return {
        "target": target,
        "available_targets": list(LEAD_LAG_TARGETS),
        "best": best,
        "curves": by_series,
        "note": (
            "Negative lag means the indicator turns before the target: its value "
            "that many months earlier lines up with the target today."
        ),
    }
