"""Overview screen: the headline tiles, category rollups and current regime."""

from __future__ import annotations

import json

from fastapi import APIRouter

from app import db
from app.series_catalog import CATEGORIES, HEADLINE_SERIES, PULSE_SERIES

router = APIRouter(prefix="/api/overview", tags=["overview"])

CARD_SQL = """
select s.series_id, s.display_name, s.title, s.category, s.unit_kind,
       s.scale, s.default_transform, s.units_short, s.frequency_short,
       s.higher_is_better,
       sn.latest_date, sn.latest_value, sn.previous_value, sn.change_1p,
       sn.pct_1p, sn.pct_12m, sn.diff_12m, sn.zscore_5y, sn.pctile_10y,
       sn.min_5y, sn.max_5y, sn.stale_days, sn.history_start, sn.obs_count,
       sn.spark
  from core.series s
  join analytics.series_snapshot sn using (series_id)
 where s.series_id = any(%s)
"""


def _cards(series_ids: tuple[str, ...]) -> list[dict]:
    rows = db.query(CARD_SQL, (list(series_ids),))
    by_id = {r["series_id"]: r for r in rows}
    ordered = [by_id[sid] for sid in series_ids if sid in by_id]
    for row in ordered:
        if isinstance(row.get("spark"), str):
            row["spark"] = json.loads(row["spark"])
    return ordered


@router.get("")
def get_overview() -> dict:
    headline = _cards(HEADLINE_SERIES)
    pulse = _cards(PULSE_SERIES)

    categories = db.query(
        """select s.category,
                  min(s.category_rank)            as category_rank,
                  count(*)                        as series_count,
                  max(sn.latest_date)             as latest_date,
                  min(sn.stale_days)              as freshest_days,
                  avg(sn.zscore_5y)               as avg_zscore
             from core.series s
             left join analytics.series_snapshot sn using (series_id)
            where s.is_active
            group by 1"""
    )
    for row in categories:
        meta = CATEGORIES.get(row["category"], {})
        row["label"] = meta.get("label", row["category"].title())
        row["blurb"] = meta.get("blurb", "")

    signals = db.query(
        """select signal_key, label, description, unit, threshold, direction,
                  latest_date, latest_value, latest_state
             from analytics.signal_meta
            order by case signal_key
                       when 'curve_10y2y' then 1 when 'sahm_rule' then 2
                       when 'macro_heat' then 3 else 4 end"""
    )

    coverage = db.query_one(
        """select count(*)                        as series,
                  sum(obs_count)                  as observations,
                  min(history_start)              as since,
                  max(latest_date)                as latest
             from analytics.series_snapshot"""
    )

    last_run = db.query_one(
        """select run_id, status, trigger, started_at, finished_at, duration_ms,
                  series_ok, series_failed, rows_upserted, api_calls
             from core.ingest_runs
            order by started_at desc limit 1"""
    )

    return {
        "headline": headline,
        "pulse": pulse,
        "categories": sorted(categories, key=lambda r: r["category_rank"]),
        "signals": signals,
        "coverage": coverage,
        "last_run": last_run,
    }


@router.get("/recessions")
def get_recessions() -> list[dict]:
    """NBER contraction windows, used to shade every time-series chart."""
    return db.query(
        """select start_date, end_date
             from analytics.episodes
            where kind = 'recession'
            order by start_date"""
    )
