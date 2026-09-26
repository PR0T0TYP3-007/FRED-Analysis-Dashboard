"""FastAPI application: a thin, cached read layer over the analytics tables.

Nothing here computes anything. Every number on the dashboard was produced by
the analytics pass and written to a table, so a request is a `select`. That is
what keeps the UI responsive over a hundred and fifty thousand observations.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse

from app import db
from app.api.routers import correlations, overview, pipeline, series, signals
from app.config import get_settings

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.get_pool()  # fail fast if Postgres is unreachable
    log.info("connection pool ready")
    yield
    db.close_pool()


app = FastAPI(
    title="FRED Macro Warehouse API",
    version="1.0.0",
    description=(
        "Read API over a locally-warehoused slice of the St. Louis Fed FRED "
        "database: 45 curated US macro series, their derived metrics, recession "
        "signals, cross-series relationships and short-horizon forecasts."
    ),
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.include_router(overview.router)
app.include_router(series.router)
app.include_router(signals.router)
app.include_router(correlations.router)
app.include_router(pipeline.router)


@app.get("/health", tags=["meta"])
def health() -> dict:
    """Readiness: touches the database, so it fails if Postgres is unreachable.

    Use this for a platform health check. Do NOT point an uptime pinger at it
    -- see /ping.
    """
    row = db.query_one("select count(*) as n from core.observations")
    return {"status": "ok", "observations": row["n"] if row else 0}


@app.get("/ping", tags=["meta"])
def ping() -> dict:
    """Liveness only. Deliberately does not touch the database.

    An uptime pinger exists to stop the host suspending an idle service. If it
    hit /health instead, every ping would also wake a scale-to-zero database
    and burn its compute allowance around the clock -- paying for a warm
    database to serve nobody. This keeps the web service alive and lets the
    database sleep until someone actually asks for data.
    """
    return {"status": "alive"}
