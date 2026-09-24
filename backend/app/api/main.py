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
    row = db.query_one("select count(*) as n from core.observations")
    return {"status": "ok", "observations": row["n"] if row else 0}
