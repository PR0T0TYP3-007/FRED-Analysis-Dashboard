"""Pipeline health: ingest history, freshness and per-series data quality."""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

from app import db

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])


@router.get("")
def pipeline_overview(limit: int = Query(20, ge=1, le=100)) -> dict:
    runs = db.query(
        """select run_id, trigger, mode, status, started_at, finished_at,
                  duration_ms, series_total, series_ok, series_failed,
                  rows_upserted, api_calls, error
             from core.ingest_runs
            order by started_at desc limit %s""",
        (limit,),
    )

    analytics_runs = db.query(
        """select run_id, started_at, finished_at, duration_ms, status, stages, error
             from analytics.runs order by started_at desc limit %s""",
        (limit,),
    )

    totals = db.query_one(
        """select (select count(*) from core.observations)                as observations,
                  (select count(*) from core.series where is_active)      as series,
                  (select count(*) from analytics.series_metrics)         as metric_rows,
                  (select min(obs_date) from core.observations)           as earliest,
                  (select max(obs_date) from core.observations)           as latest"""
    )

    # Freshness is judged on when FRED last *published* the series, not on how
    # old the newest reference period is: a monthly series reporting July data
    # in late September is perfectly current, it just has a publication lag.
    freshness = db.query(
        """select s.series_id, s.display_name, s.category, s.frequency_short,
                  s.last_updated,
                  sn.latest_date, sn.stale_days as reference_lag_days,
                  sn.obs_count, sn.history_start,
                  extract(day from now() - s.last_updated)::int as published_days_ago,
                  case
                    when s.last_updated is null then 'unknown'
                    when s.frequency_short in ('D', 'W')
                         and now() - s.last_updated > interval '10 days'  then 'stale'
                    when s.frequency_short = 'M'
                         and now() - s.last_updated > interval '45 days'  then 'stale'
                    when s.frequency_short in ('Q', 'SA', 'A')
                         and now() - s.last_updated > interval '120 days' then 'stale'
                    else 'fresh'
                  end as freshness
             from core.series s
             left join analytics.series_snapshot sn using (series_id)
            where s.is_active
            order by s.last_updated asc nulls first"""
    )

    gaps = db.query(
        """select series_id, count(*) as missing
             from core.observations
            where value is null
            group by 1 order by 2 desc limit 10"""
    )

    return {
        "runs": runs,
        "analytics_runs": analytics_runs,
        "totals": totals,
        "freshness": freshness,
        "stale_count": sum(1 for f in freshness if f["freshness"] == "stale"),
        "gaps": gaps,
    }


@router.get("/runs/{run_id}")
def run_detail(run_id: int) -> dict:
    run = db.query_one("select * from core.ingest_runs where run_id = %s", (run_id,))
    if not run:
        raise HTTPException(status_code=404, detail=f"unknown run {run_id}")
    series = db.query(
        """select series_id, status, rows_upserted, latest_date, duration_ms, message
             from core.ingest_series_log
            where run_id = %s
            order by status desc, duration_ms desc""",
        (run_id,),
    )
    return {"run": run, "series": series}


@router.post("/refresh")
def trigger_refresh(background: BackgroundTasks, full: bool = Query(False)) -> dict:
    """Kick off an ingest + analytics pass without blocking the request.

    Handy for demos; a production deployment would put this behind auth and a
    proper job queue rather than FastAPI background tasks.
    """
    from app.analytics.runner import run_analytics
    from app.ingest import run_ingest

    def job() -> None:
        report = run_ingest(full_refresh=full, trigger="api")
        if report.status != "failed":
            run_analytics()

    background.add_task(job)
    return {"status": "accepted", "mode": "full" if full else "incremental"}
