"""Recession and stress signals, plus the episodes derived from them."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException, Query

from app import db

router = APIRouter(prefix="/api/signals", tags=["signals"])


@router.get("")
def list_signals() -> dict:
    meta = db.query(
        """select signal_key, label, description, unit, threshold, direction,
                  latest_date, latest_value, latest_state
             from analytics.signal_meta
            order by case signal_key
                       when 'curve_10y2y' then 1 when 'curve_10y3m' then 2
                       when 'sahm_rule' then 3 when 'macro_heat' then 4 else 5 end"""
    )
    counts = {
        row["latest_state"]: row["n"]
        for row in db.query(
            "select latest_state, count(*) as n from analytics.signal_meta group by 1"
        )
    }
    triggered = counts.get("triggered", 0)
    warning = counts.get("warning", 0)
    verdict = "elevated" if triggered else ("watch" if warning else "clear")
    return {"signals": meta, "state_counts": counts, "verdict": verdict}


@router.get("/episodes")
def list_episodes(kind: str | None = Query(None)) -> list[dict]:
    clause, params = ("where kind = %s", [kind]) if kind else ("", [])
    return db.query(
        f"""select id, kind, start_date, end_date, peak_value, length_days, note
              from analytics.episodes {clause}
             order by start_date desc""",
        params,
    )


@router.get("/curve")
def treasury_curve() -> dict:
    """The current Treasury curve, plus the same curve one year ago."""
    tenors = [
        ("DGS3MO", 0.25, "3M"),
        ("DGS2", 2.0, "2Y"),
        ("DGS10", 10.0, "10Y"),
        ("DGS30", 30.0, "30Y"),
    ]
    ids = [t[0] for t in tenors]

    latest = {
        r["series_id"]: r
        for r in db.query(
            """select distinct on (series_id) series_id, obs_date, value
                 from core.observations
                where series_id = any(%s) and value is not null
                order by series_id, obs_date desc""",
            (ids,),
        )
    }
    year_ago = {
        r["series_id"]: r
        for r in db.query(
            """select distinct on (series_id) series_id, obs_date, value
                 from core.observations
                where series_id = any(%s) and value is not null
                  and obs_date <= current_date - interval '1 year'
                order by series_id, obs_date desc""",
            (ids,),
        )
    }

    points = [
        {
            "series_id": sid,
            "tenor_years": years,
            "label": label,
            "current": (latest.get(sid) or {}).get("value"),
            "year_ago": (year_ago.get(sid) or {}).get("value"),
        }
        for sid, years, label in tenors
    ]
    as_of = max((r["obs_date"] for r in latest.values()), default=None)
    inverted = False
    short = next((p["current"] for p in points if p["series_id"] == "DGS2"), None)
    long = next((p["current"] for p in points if p["series_id"] == "DGS10"), None)
    if short is not None and long is not None:
        inverted = long < short
    return {"as_of": as_of, "points": points, "inverted": inverted}


@router.get("/{signal_key}")
def signal_history(
    signal_key: str,
    start: date | None = Query(None),
    limit: int = Query(20000, ge=100, le=100000),
) -> dict:
    meta = db.query_one(
        "select * from analytics.signal_meta where signal_key = %s", (signal_key,)
    )
    if not meta:
        raise HTTPException(status_code=404, detail=f"unknown signal {signal_key}")

    clauses = ["signal_key = %s"]
    params: list[object] = [signal_key]
    if start:
        clauses.append("obs_date >= %s")
        params.append(start)
    params.append(limit)

    points = db.query(
        f"""select obs_date, value, state from analytics.signals
             where {" and ".join(clauses)}
             order by obs_date limit %s""",
        params,
    )
    kind = f"inversion_{signal_key[6:]}" if signal_key.startswith("curve_") else signal_key
    episodes = db.query(
        """select start_date, end_date, peak_value, length_days
             from analytics.episodes where kind = %s order by start_date""",
        (kind,),
    )
    return {"meta": meta, "points": points, "episodes": episodes}
