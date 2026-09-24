-- =============================================================================
--  FRED macro warehouse -- idempotent DDL
--
--  core.*       raw, source-of-truth data mirrored from the FRED API
--  analytics.*  derived tables rebuilt by the analytics pass after each ingest
-- =============================================================================

create schema if not exists core;
create schema if not exists analytics;

-- -----------------------------------------------------------------------------
-- core.series -- one row per FRED series we track, merged from our own curated
-- catalog (grouping / display metadata) and the FRED `series` endpoint.
-- -----------------------------------------------------------------------------
create table if not exists core.series (
    series_id                 text primary key,
    title                     text not null,
    display_name              text,
    category                  text not null default 'other',
    unit_kind                 text not null default 'count',   -- percent | index | usd | count | ratio
    scale                     double precision not null default 1,  -- stored value -> base units
    default_transform         text not null default 'level',   -- level | yoy | mom | index100
    higher_is_better          boolean,
    units                     text,
    units_short               text,
    frequency                 text,
    frequency_short           text,
    seasonal_adjustment       text,
    seasonal_adjustment_short text,
    observation_start         date,
    observation_end           date,
    last_updated              timestamptz,
    popularity                integer,
    notes                     text,
    priority                  integer not null default 100,
    is_active                 boolean not null default true,
    created_at                timestamptz not null default now(),
    updated_at                timestamptz not null default now()
);

create index if not exists series_category_idx on core.series (category, priority);

-- -----------------------------------------------------------------------------
-- core.observations -- the raw time series values, one row per (series, date).
-- FRED sends "." for missing periods; those are stored as NULL so gaps survive.
-- -----------------------------------------------------------------------------
create table if not exists core.observations (
    series_id      text not null references core.series (series_id) on delete cascade,
    obs_date       date not null,
    value          double precision,
    realtime_start date,
    realtime_end   date,
    ingested_at    timestamptz not null default now(),
    primary key (series_id, obs_date)
);

create index if not exists observations_date_idx on core.observations (obs_date);
create index if not exists observations_series_date_idx
    on core.observations (series_id, obs_date desc);

-- -----------------------------------------------------------------------------
-- core.ingest_runs / core.ingest_series_log -- pipeline observability. Every
-- scheduled or manual run is recorded so the dashboard can show data freshness
-- and failures instead of silently serving stale numbers.
-- -----------------------------------------------------------------------------
create table if not exists core.ingest_runs (
    run_id          bigserial primary key,
    trigger         text not null default 'manual',           -- manual | schedule | api
    mode            text not null default 'incremental',      -- incremental | full
    status          text not null default 'running',          -- running | success | partial | failed
    started_at      timestamptz not null default now(),
    finished_at     timestamptz,
    duration_ms     integer,
    series_total    integer not null default 0,
    series_ok       integer not null default 0,
    series_failed   integer not null default 0,
    rows_upserted   integer not null default 0,
    api_calls       integer not null default 0,
    error           text
);

create index if not exists ingest_runs_started_idx on core.ingest_runs (started_at desc);

create table if not exists core.ingest_series_log (
    id            bigserial primary key,
    run_id        bigint not null references core.ingest_runs (run_id) on delete cascade,
    series_id     text not null,
    status        text not null,                              -- ok | failed | skipped
    rows_upserted integer not null default 0,
    latest_date   date,
    duration_ms   integer,
    message       text
);

create index if not exists ingest_series_log_run_idx on core.ingest_series_log (run_id);

-- -----------------------------------------------------------------------------
-- analytics.series_metrics -- the derived panel. Rebuilt in full after ingest;
-- cheap at this data volume and it keeps the API a pure read layer.
-- -----------------------------------------------------------------------------
create table if not exists analytics.series_metrics (
    series_id        text not null references core.series (series_id) on delete cascade,
    obs_date         date not null,
    value            double precision,
    change_1p        double precision,   -- absolute change vs previous period
    pct_1p           double precision,   -- % change vs previous period
    pct_3p           double precision,
    pct_12m          double precision,   -- year-over-year %
    diff_12m         double precision,   -- year-over-year absolute change
    annualized_1p    double precision,   -- period change, annualized
    rolling_3        double precision,
    rolling_12       double precision,
    zscore_5y        double precision,
    pctile_10y       double precision,   -- 0-1 rank within trailing 10 years
    drawdown         double precision,   -- % below trailing all-time high
    primary key (series_id, obs_date)
);

create index if not exists series_metrics_date_idx on analytics.series_metrics (obs_date);

-- -----------------------------------------------------------------------------
-- analytics.series_snapshot -- one row per series: everything the overview and
-- explorer cards need, so those screens never aggregate at request time.
-- -----------------------------------------------------------------------------
create table if not exists analytics.series_snapshot (
    series_id        text primary key references core.series (series_id) on delete cascade,
    latest_date      date,
    latest_value     double precision,
    previous_value   double precision,
    change_1p        double precision,
    pct_1p           double precision,
    pct_12m          double precision,
    diff_12m         double precision,
    zscore_5y        double precision,
    pctile_10y       double precision,
    min_5y           double precision,
    max_5y           double precision,
    obs_count        integer,
    history_start    date,
    stale_days       integer,
    spark            jsonb,              -- trailing points for card sparklines
    computed_at      timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- analytics.signals -- derived composite indicators kept as time series so they
-- can be charted next to the raw data (yield curve spread, Sahm rule, ...).
-- -----------------------------------------------------------------------------
create table if not exists analytics.signals (
    signal_key  text not null,
    obs_date    date not null,
    value       double precision,
    state       text,                    -- normal | warning | triggered
    primary key (signal_key, obs_date)
);

create table if not exists analytics.signal_meta (
    signal_key   text primary key,
    label        text not null,
    description  text,
    unit         text,
    threshold    double precision,
    direction    text default 'below',   -- which side of `threshold` is the alarm
    latest_date  date,
    latest_value double precision,
    latest_state text,
    computed_at  timestamptz not null default now()
);

-- Discrete episodes derived from the signals (curve inversions, recessions).
create table if not exists analytics.episodes (
    id          bigserial primary key,
    kind        text not null,           -- inversion | recession | sahm
    start_date  date not null,
    end_date    date,                    -- null = ongoing
    peak_value  double precision,
    length_days integer,
    note        text,
    unique (kind, start_date)
);

-- -----------------------------------------------------------------------------
-- analytics.correlations / lead_lag -- cross-series relationships computed on
-- year-over-year changes (stationary enough to make the numbers meaningful).
-- -----------------------------------------------------------------------------
create table if not exists analytics.correlations (
    window_label text not null,          -- 5y | 10y | full
    series_a     text not null,
    series_b     text not null,
    corr         double precision,
    n_obs        integer,
    primary key (window_label, series_a, series_b)
);

create table if not exists analytics.lead_lag (
    target_id    text not null,
    series_id    text not null,
    lag_months   integer not null,       -- negative = series_id leads target
    corr         double precision,
    primary key (target_id, series_id, lag_months)
);

create table if not exists analytics.lead_lag_best (
    target_id      text not null,
    series_id      text not null,
    best_lag       integer,
    best_corr      double precision,
    contemp_corr   double precision,
    primary key (target_id, series_id)
);

-- -----------------------------------------------------------------------------
-- analytics.forecasts -- 12-period-ahead ETS forecast per series, with the
-- walk-forward backtest error that earns the forecast its place on screen.
-- -----------------------------------------------------------------------------
create table if not exists analytics.forecasts (
    series_id   text not null references core.series (series_id) on delete cascade,
    obs_date    date not null,
    yhat        double precision,
    lower       double precision,
    upper       double precision,
    primary key (series_id, obs_date)
);

create table if not exists analytics.forecast_meta (
    series_id       text primary key references core.series (series_id) on delete cascade,
    model           text,
    horizon         integer,
    mape            double precision,
    rmse            double precision,
    naive_mape      double precision,   -- seasonal-naive baseline for comparison
    skill           double precision,   -- 1 - mape / naive_mape
    train_start     date,
    train_end       date,
    computed_at     timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- analytics.runs -- bookkeeping for the analytics pass itself.
-- -----------------------------------------------------------------------------
create table if not exists analytics.runs (
    run_id      bigserial primary key,
    started_at  timestamptz not null default now(),
    finished_at timestamptz,
    duration_ms integer,
    status      text not null default 'running',
    stages      jsonb,
    error       text
);

-- -----------------------------------------------------------------------------
-- Convenience view: latest non-null observation per series, straight from core.
-- -----------------------------------------------------------------------------
create or replace view core.latest_observation as
select distinct on (o.series_id)
       o.series_id, o.obs_date, o.value
from core.observations o
where o.value is not null
order by o.series_id, o.obs_date desc;

-- Added after the first release: FRED reports each series in its own magnitude
-- (GDP in billions, payrolls in thousands), and the UI needs the multiplier to
-- render real quantities.
alter table core.series add column if not exists scale double precision not null default 1;

-- Reading order for the category rails: growth first, cycle reference last.
-- Alphabetical ordering would open the explorer on "credit", which is not
-- where anyone starts.
alter table core.series add column if not exists category_rank integer not null default 99;
