"""Daily refresh scheduler.

FRED publishes on a weekday-morning cadence, so the default job runs once each
weekday morning in US Eastern time: ingest, then rebuild analytics. A misfire
grace period means a laptop that was asleep at 07:30 still runs the job when it
wakes, and `max_instances=1` stops two refreshes overlapping.
"""

from __future__ import annotations

import logging

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from app.analytics.runner import run_analytics
from app.config import get_settings
from app.ingest import run_ingest

log = logging.getLogger(__name__)


def refresh_job() -> None:
    log.info("scheduled refresh starting")
    report = run_ingest(trigger="schedule")
    log.info(report.summary())
    if report.status == "failed":
        log.error("ingest failed; skipping analytics so the last good results stand")
        return
    result = run_analytics()
    log.info("analytics run %s finished in %.1fs", result["run_id"], result["duration_ms"] / 1000)


def build_scheduler() -> BlockingScheduler:
    settings = get_settings()
    scheduler = BlockingScheduler(timezone=settings.schedule_timezone)
    scheduler.add_job(
        refresh_job,
        trigger=CronTrigger(
            day_of_week="mon-fri",
            hour=settings.schedule_cron_hour,
            minute=settings.schedule_cron_minute,
            timezone=settings.schedule_timezone,
        ),
        id="fred_daily_refresh",
        name="FRED daily refresh",
        max_instances=1,
        coalesce=True,
        misfire_grace_time=6 * 60 * 60,
    )
    return scheduler


def start_scheduler(run_now: bool = False) -> None:
    settings = get_settings()
    scheduler = build_scheduler()
    log.info(
        "scheduler armed: weekdays at %02d:%02d %s",
        settings.schedule_cron_hour,
        settings.schedule_cron_minute,
        settings.schedule_timezone,
    )
    if run_now:
        refresh_job()
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        log.info("scheduler stopped")
