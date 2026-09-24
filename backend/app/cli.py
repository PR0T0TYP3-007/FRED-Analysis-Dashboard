"""Operator entry point: `python -m app.cli <command>`."""

from __future__ import annotations

import logging

import typer
from rich.console import Console
from rich.logging import RichHandler
from rich.table import Table

from app import db
from app.analytics.runner import run_analytics
from app.config import get_settings
from app.ingest import run_ingest

console = Console()
cli = typer.Typer(
    add_completion=False,
    help="FRED macro warehouse -- ingest, analyse and serve US economic data.",
)


def _setup_logging(verbose: bool = False) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(message)s",
        datefmt="%H:%M:%S",
        handlers=[RichHandler(console=console, show_path=False, rich_tracebacks=True)],
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)


@cli.command()
def init() -> None:
    """Create the database if needed and apply the schema."""
    _setup_logging()
    settings = get_settings()
    created = db.ensure_database()
    console.print(
        f"[green]database[/] {settings.database_name} "
        f"{'created' if created else 'already present'}"
    )
    db.apply_schema()
    console.print("[green]schema[/] applied (core + analytics)")


@cli.command()
def ingest(
    full: bool = typer.Option(False, "--full", help="Re-pull complete history, ignoring what is stored."),
    only: str = typer.Option("", "--only", help="Comma-separated series ids to restrict the run."),
    trigger: str = typer.Option("manual", "--trigger", hidden=True),
    verbose: bool = typer.Option(False, "--verbose", "-v"),
) -> None:
    """Pull observations from FRED into core.*"""
    _setup_logging(verbose)
    ids = [s.strip().upper() for s in only.split(",") if s.strip()] or None
    report = run_ingest(full_refresh=full, trigger=trigger, only=ids)

    colour = {"success": "green", "partial": "yellow", "failed": "red"}[report.status]
    console.print(f"[{colour}]{report.summary()}[/]")
    if report.series_failed:
        table = Table(title="failed series", show_lines=False)
        table.add_column("series")
        table.add_column("message", overflow="fold")
        for result in report.results:
            if result.status == "failed":
                table.add_row(result.series_id, result.message or "")
        console.print(table)
        raise typer.Exit(code=1 if report.status == "failed" else 0)


@cli.command()
def analyze(
    skip_forecasts: bool = typer.Option(False, "--skip-forecasts"),
    verbose: bool = typer.Option(False, "--verbose", "-v"),
) -> None:
    """Rebuild every derived table in analytics.*"""
    _setup_logging(verbose)
    result = run_analytics(skip_forecasts=skip_forecasts)
    console.print(
        f"[green]analytics run {result['run_id']}[/] finished in "
        f"{result['duration_ms'] / 1000:.1f}s"
    )
    for stage, counts in result["stages"].items():
        console.print(f"  {stage:<14} {counts}")


@cli.command()
def refresh(
    full: bool = typer.Option(False, "--full"),
    verbose: bool = typer.Option(False, "--verbose", "-v"),
) -> None:
    """Run the full pipeline: ingest, then analytics."""
    _setup_logging(verbose)
    report = run_ingest(full_refresh=full, trigger="manual")
    console.print(report.summary())
    if report.status == "failed":
        raise typer.Exit(code=1)
    result = run_analytics()
    console.print(f"analytics run {result['run_id']} ok ({result['duration_ms'] / 1000:.1f}s)")


@cli.command()
def status() -> None:
    """Show what is in the warehouse and how fresh it is."""
    _setup_logging()
    rows = db.query(
        """select s.category,
                  count(*)                          as series,
                  sum(sn.obs_count)                 as observations,
                  min(sn.history_start)             as since,
                  max(sn.latest_date)               as latest,
                  max(sn.stale_days)                as worst_stale
             from core.series s
             left join analytics.series_snapshot sn using (series_id)
            where s.is_active
            group by 1 order by 1"""
    )
    table = Table(title="warehouse status")
    for column in ("category", "series", "observations", "since", "latest", "worst stale (d)"):
        table.add_column(column)
    for row in rows:
        table.add_row(
            row["category"],
            str(row["series"]),
            f"{row['observations'] or 0:,}",
            str(row["since"] or "-"),
            str(row["latest"] or "-"),
            str(row["worst_stale"] if row["worst_stale"] is not None else "-"),
        )
    console.print(table)

    last = db.query_one(
        "select * from core.ingest_runs order by started_at desc limit 1"
    )
    if last:
        console.print(
            f"last ingest: run {last['run_id']} [{last['status']}] "
            f"{last['started_at']:%Y-%m-%d %H:%M} -- "
            f"{last['rows_upserted']:,} rows, {last['api_calls']} API calls"
        )


@cli.command()
def serve(
    reload: bool = typer.Option(False, "--reload", help="Auto-reload on code changes."),
) -> None:
    """Run the read API that the dashboard talks to."""
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "app.api.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=reload,
        log_level="info",
    )


@cli.command()
def schedule(
    run_now: bool = typer.Option(False, "--run-now", help="Run once at startup, then wait."),
) -> None:
    """Start the blocking scheduler that refreshes the warehouse daily."""
    from app.scheduler import start_scheduler

    _setup_logging()
    start_scheduler(run_now=run_now)


if __name__ == "__main__":
    cli()
