"""The extract/load half of the pipeline.

Design notes
------------
* **Incremental by default.** For each series we look up the latest date we
  already hold and ask FRED only for what follows, with a short overlap window
  so revisions to recent periods are picked up. `--full` re-pulls everything.
* **Idempotent.** Every write is an `insert ... on conflict do update`, so a run
  can be repeated or interrupted without corrupting the table.
* **Observable.** Each run writes a row to `core.ingest_runs` and a row per
  series to `core.ingest_series_log`, which is what the Pipeline screen reads.
* **Parallel but polite.** Series are fetched on a small thread pool; the shared
  rate limiter in `FredClient` keeps the whole pool under the FRED budget.
"""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import date, timedelta

import psycopg
from psycopg.rows import dict_row

from app.config import get_settings
from app.fred_client import FredClient, FredError, Observation
from app.series_catalog import (
    CATALOG,
    SeriesSpec,
    category_rank,
    scale_disagreement,
)

log = logging.getLogger(__name__)

# How far back to re-request on an incremental run. FRED revises recent periods
# (payrolls in particular) for months after first publication.
REVISION_OVERLAP_DAYS = 400


@dataclass
class SeriesResult:
    series_id: str
    status: str
    rows: int = 0
    latest_date: date | None = None
    duration_ms: int = 0
    message: str | None = None


@dataclass
class IngestReport:
    run_id: int
    status: str
    series_total: int
    series_ok: int
    series_failed: int
    rows_upserted: int
    api_calls: int
    duration_ms: int
    results: list[SeriesResult]

    def summary(self) -> str:
        return (
            f"run {self.run_id}: {self.status} -- {self.series_ok}/{self.series_total} series, "
            f"{self.rows_upserted:,} rows, {self.api_calls} API calls, "
            f"{self.duration_ms / 1000:.1f}s"
        )


# -----------------------------------------------------------------------------
# metadata + observation writes
# -----------------------------------------------------------------------------
UPSERT_SERIES = """
insert into core.series (
    series_id, title, display_name, category, category_rank, unit_kind, scale, default_transform,
    higher_is_better, units, units_short, frequency, frequency_short,
    seasonal_adjustment, seasonal_adjustment_short, observation_start,
    observation_end, last_updated, popularity, notes, priority, is_active, updated_at
) values (
    %(series_id)s, %(title)s, %(display_name)s, %(category)s, %(category_rank)s, %(unit_kind)s,
    %(scale)s, %(default_transform)s, %(higher_is_better)s, %(units)s, %(units_short)s,
    %(frequency)s, %(frequency_short)s, %(seasonal_adjustment)s,
    %(seasonal_adjustment_short)s, %(observation_start)s, %(observation_end)s,
    %(last_updated)s, %(popularity)s, %(notes)s, %(priority)s, true, now()
)
on conflict (series_id) do update set
    title                     = excluded.title,
    display_name              = excluded.display_name,
    category                  = excluded.category,
    category_rank             = excluded.category_rank,
    unit_kind                 = excluded.unit_kind,
    scale                     = excluded.scale,
    default_transform         = excluded.default_transform,
    higher_is_better          = excluded.higher_is_better,
    units                     = excluded.units,
    units_short               = excluded.units_short,
    frequency                 = excluded.frequency,
    frequency_short           = excluded.frequency_short,
    seasonal_adjustment       = excluded.seasonal_adjustment,
    seasonal_adjustment_short = excluded.seasonal_adjustment_short,
    observation_start         = excluded.observation_start,
    observation_end           = excluded.observation_end,
    last_updated              = excluded.last_updated,
    popularity                = excluded.popularity,
    notes                     = excluded.notes,
    priority                  = excluded.priority,
    is_active                 = true,
    updated_at                = now();
"""

UPSERT_OBSERVATIONS = """
insert into core.observations (series_id, obs_date, value, realtime_start, realtime_end)
values (%s, %s, %s, %s, %s)
on conflict (series_id, obs_date) do update set
    value          = excluded.value,
    realtime_start = excluded.realtime_start,
    realtime_end   = excluded.realtime_end,
    ingested_at    = now()
where core.observations.value is distinct from excluded.value;
"""


def _parse_fred_date(raw: str | None) -> date | None:
    if not raw or raw in {".", ""}:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def _to_int(raw: object) -> int | None:
    try:
        return int(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _metadata_row(spec: SeriesSpec, meta: dict) -> dict:
    last_updated = meta.get("last_updated")

    # FRED states the magnitude in its units string. If our hand-declared scale
    # disagrees, every figure for this series will be wrong by a round factor --
    # and wrong by exactly the kind of factor that still looks like a number.
    complaint = scale_disagreement(spec, meta.get("units"))
    if complaint:
        log.warning("scale mismatch -- %s", complaint)

    return {
        "series_id": spec.series_id,
        "title": meta.get("title") or spec.display_name,
        "display_name": spec.display_name,
        "category": spec.category,
        "category_rank": category_rank(spec.category),
        "unit_kind": spec.unit_kind,
        "scale": spec.scale,
        "default_transform": spec.default_transform,
        "higher_is_better": spec.higher_is_better,
        "units": meta.get("units"),
        "units_short": meta.get("units_short"),
        "frequency": meta.get("frequency"),
        "frequency_short": meta.get("frequency_short"),
        "seasonal_adjustment": meta.get("seasonal_adjustment"),
        "seasonal_adjustment_short": meta.get("seasonal_adjustment_short"),
        "observation_start": _parse_fred_date(meta.get("observation_start")),
        "observation_end": _parse_fred_date(meta.get("observation_end")),
        # FRED returns e.g. "2026-09-05 08:31:02-05"; Postgres parses it directly.
        "last_updated": last_updated or None,
        "popularity": _to_int(meta.get("popularity")),
        "notes": meta.get("notes"),
        "priority": spec.priority,
    }


def _write_observations(
    conn: psycopg.Connection, series_id: str, observations: list[Observation]
) -> int:
    if not observations:
        return 0
    payload = [
        (series_id, o.obs_date, o.value, o.realtime_start, o.realtime_end)
        for o in observations
    ]
    with conn.cursor() as cur:
        cur.executemany(UPSERT_OBSERVATIONS, payload)
        return cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0


def _latest_dates(conn: psycopg.Connection) -> dict[str, date]:
    with conn.cursor() as cur:
        cur.execute("select series_id, max(obs_date) as d from core.observations group by 1")
        return {r["series_id"]: r["d"] for r in cur.fetchall() if r["d"]}


# -----------------------------------------------------------------------------
# run orchestration
# -----------------------------------------------------------------------------
def _ingest_one(
    client: FredClient,
    dsn: str,
    spec: SeriesSpec,
    start_from: str | date,
) -> SeriesResult:
    started = time.perf_counter()
    try:
        meta = client.get_series(spec.series_id)
        observations = client.get_observations(spec.series_id, observation_start=start_from)

        with psycopg.connect(dsn, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(UPSERT_SERIES, _metadata_row(spec, meta))
            rows = _write_observations(conn, spec.series_id, observations)
            conn.commit()

        latest = max((o.obs_date for o in observations), default=None)
        return SeriesResult(
            series_id=spec.series_id,
            status="ok",
            rows=rows,
            latest_date=latest,
            duration_ms=int((time.perf_counter() - started) * 1000),
        )
    except FredError as exc:
        log.warning("%s failed: %s", spec.series_id, exc)
        return SeriesResult(
            spec.series_id,
            "failed",
            duration_ms=int((time.perf_counter() - started) * 1000),
            message=str(exc)[:500],
        )
    except Exception as exc:  # noqa: BLE001 - one bad series must not kill the run
        log.exception("%s raised", spec.series_id)
        return SeriesResult(
            spec.series_id,
            "failed",
            duration_ms=int((time.perf_counter() - started) * 1000),
            message=f"{type(exc).__name__}: {exc}"[:500],
        )


def run_ingest(
    full_refresh: bool = False,
    trigger: str = "manual",
    only: list[str] | None = None,
) -> IngestReport:
    settings = get_settings()
    dsn = settings.database_url
    specs = [s for s in CATALOG if not only or s.series_id in set(only)]

    started = time.perf_counter()
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """insert into core.ingest_runs (trigger, mode, series_total)
                   values (%s, %s, %s) returning run_id""",
                (trigger, "full" if full_refresh else "incremental", len(specs)),
            )
            run_id = cur.fetchone()["run_id"]
        conn.commit()
        latest = {} if full_refresh else _latest_dates(conn)

    def start_for(spec: SeriesSpec) -> str | date:
        if full_refresh or spec.series_id not in latest:
            return settings.fred_observation_start
        return latest[spec.series_id] - timedelta(days=REVISION_OVERLAP_DAYS)

    results: list[SeriesResult] = []
    with FredClient() as client:
        with ThreadPoolExecutor(max_workers=settings.ingest_concurrency) as pool:
            futures = {
                pool.submit(_ingest_one, client, dsn, spec, start_for(spec)): spec
                for spec in specs
            }
            for future in as_completed(futures):
                result = future.result()
                results.append(result)
                log.info(
                    "%-14s %-7s %6d rows  %5dms",
                    result.series_id,
                    result.status,
                    result.rows,
                    result.duration_ms,
                )
        api_calls = client.call_count

    ok = sum(1 for r in results if r.status == "ok")
    failed = len(results) - ok
    rows = sum(r.rows for r in results)
    duration_ms = int((time.perf_counter() - started) * 1000)
    status = "success" if failed == 0 else ("partial" if ok else "failed")

    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.executemany(
                """insert into core.ingest_series_log
                       (run_id, series_id, status, rows_upserted, latest_date, duration_ms, message)
                   values (%s, %s, %s, %s, %s, %s, %s)""",
                [
                    (run_id, r.series_id, r.status, r.rows, r.latest_date, r.duration_ms, r.message)
                    for r in results
                ],
            )
            cur.execute(
                """update core.ingest_runs
                      set status = %s, finished_at = now(), duration_ms = %s,
                          series_ok = %s, series_failed = %s, rows_upserted = %s,
                          api_calls = %s
                    where run_id = %s""",
                (status, duration_ms, ok, failed, rows, api_calls, run_id),
            )
        conn.commit()

    return IngestReport(
        run_id=run_id,
        status=status,
        series_total=len(specs),
        series_ok=ok,
        series_failed=failed,
        rows_upserted=rows,
        api_calls=api_calls,
        duration_ms=duration_ms,
        results=sorted(results, key=lambda r: r.series_id),
    )
