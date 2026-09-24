export type UnitKind = "percent" | "index" | "usd" | "count" | "ratio";

export type Transform = "level" | "yoy" | "mom" | "index100" | "zscore";

export interface SparkPoint {
  d: string;
  v: number | null;
}

export interface SeriesCard {
  series_id: string;
  display_name: string;
  title: string;
  category: string;
  unit_kind: UnitKind;
  /** Multiplier converting the stored value into base units (GDP is in billions). */
  scale: number;
  default_transform: Transform;
  units_short: string | null;
  frequency_short: string | null;
  higher_is_better: boolean | null;
  latest_date: string | null;
  latest_value: number | null;
  previous_value: number | null;
  change_1p: number | null;
  pct_1p: number | null;
  pct_12m: number | null;
  diff_12m: number | null;
  zscore_5y: number | null;
  pctile_10y: number | null;
  min_5y: number | null;
  max_5y: number | null;
  stale_days: number | null;
  history_start: string | null;
  obs_count: number | null;
  spark: SparkPoint[] | null;
}

export interface SignalMeta {
  signal_key: string;
  label: string;
  description: string;
  unit: string;
  threshold: number;
  direction: "above" | "below";
  latest_date: string | null;
  latest_value: number | null;
  latest_state: "normal" | "warning" | "triggered" | "unknown";
}

export interface IngestRun {
  run_id: number;
  trigger: string;
  mode: string;
  status: "running" | "success" | "partial" | "failed";
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  series_total: number;
  series_ok: number;
  series_failed: number;
  rows_upserted: number;
  api_calls: number;
  error: string | null;
}

export interface Overview {
  headline: SeriesCard[];
  pulse: SeriesCard[];
  categories: {
    category: string;
    category_rank: number;
    label: string;
    blurb: string;
    series_count: number;
    latest_date: string | null;
    avg_zscore: number | null;
  }[];
  signals: SignalMeta[];
  coverage: {
    series: number;
    observations: number;
    since: string;
    latest: string;
  };
  last_run: IngestRun | null;
}

export interface CatalogEntry extends SeriesCard {
  frequency: string | null;
  seasonal_adjustment_short: string | null;
  priority: number;
  last_updated: string | null;
}

export interface CatalogResponse {
  series: CatalogEntry[];
  categories: { key: string; label: string; blurb: string; count: number }[];
  total: number;
}

export interface ObservationPoint {
  obs_date: string;
  value: number | null;
  pct_1p: number | null;
  pct_12m: number | null;
  diff_12m: number | null;
  rolling_3: number | null;
  rolling_12: number | null;
  zscore_5y: number | null;
  pctile_10y: number | null;
  drawdown: number | null;
  plotted: number | null;
}

export interface ObservationsResponse {
  series_id: string;
  transform: Transform;
  points: ObservationPoint[];
  count: number;
}

export interface RecessionWindow {
  start_date: string;
  end_date: string | null;
}

export interface SignalDetail {
  meta: SignalMeta;
  points: { obs_date: string; value: number | null; state: string }[];
  episodes: {
    start_date: string;
    end_date: string | null;
    peak_value: number | null;
    length_days: number | null;
  }[];
}

export interface CurveResponse {
  as_of: string | null;
  inverted: boolean;
  points: {
    series_id: string;
    tenor_years: number;
    label: string;
    current: number | null;
    year_ago: number | null;
  }[];
}

export interface CorrelationResponse {
  window: string;
  order: string[];
  labels: Record<
    string,
    { series_id: string; display_name: string; category: string }
  >;
  cells: { series_a: string; series_b: string; corr: number; n_obs: number }[];
  note: string;
}

export interface StrongestPair {
  series_a: string;
  series_b: string;
  corr: number;
  n_obs: number;
  name_a: string;
  name_b: string;
  category_a: string;
  category_b: string;
}

export interface LeadLagResponse {
  target: { series_id: string; display_name: string; category: string };
  available_targets: string[];
  best: {
    series_id: string;
    best_lag: number;
    best_corr: number;
    contemp_corr: number | null;
    display_name: string;
    category: string;
  }[];
  curves: Record<string, { lag: number; corr: number }[]>;
  note: string;
}

export interface ForecastResponse {
  series_id: string;
  meta: {
    series_id: string;
    model: string;
    horizon: number;
    mape: number | null;
    rmse: number | null;
    naive_mape: number | null;
    skill: number | null;
    train_start: string;
    train_end: string;
  };
  forecast: { obs_date: string; yhat: number; lower: number; upper: number }[];
  actuals: { obs_date: string; value: number }[];
}

export interface PipelineResponse {
  runs: IngestRun[];
  analytics_runs: {
    run_id: number;
    started_at: string;
    finished_at: string | null;
    duration_ms: number | null;
    status: string;
    stages: Record<string, Record<string, number>> | null;
    error: string | null;
  }[];
  totals: {
    observations: number;
    series: number;
    metric_rows: number;
    earliest: string;
    latest: string;
  };
  freshness: {
    series_id: string;
    display_name: string;
    category: string;
    frequency_short: string | null;
    last_updated: string | null;
    latest_date: string | null;
    reference_lag_days: number | null;
    published_days_ago: number | null;
    obs_count: number | null;
    history_start: string | null;
    freshness: "fresh" | "stale" | "unknown";
  }[];
  stale_count: number;
  gaps: { series_id: string; missing: number }[];
}

export interface SeriesDetail {
  meta: CatalogEntry & {
    units: string | null;
    notes: string | null;
    seasonal_adjustment: string | null;
    observation_start: string | null;
    observation_end: string | null;
  };
  forecast: ForecastResponse["meta"] | null;
}
