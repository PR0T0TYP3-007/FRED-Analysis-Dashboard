import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  useCatalog,
  useObservations,
  useRecessions,
  useSeriesDetail,
} from "../lib/api";
import {
  FREQUENCY_LABEL,
  TRANSFORM_LABEL,
  changeFor,
  formatDate,
  formatPlotted,
  formatValue,
  moveSentiment,
} from "../lib/format";
import {
  Chip,
  EmptyNote,
  ErrorNote,
  Eyebrow,
  Panel,
  Skeleton,
  StatusChip,
} from "../components/ui";
import TimeSeriesChart, { type SeriesInput } from "../components/charts/TimeSeriesChart";
import Sparkline from "../components/charts/Sparkline";
import {
  DataTable,
  MAX_COMPARE,
  SERIES_COLORS,
  useViewToggle,
} from "../components/charts/primitives";
import type { Transform } from "../lib/types";

const RANGES = [
  { key: "5y", label: "5Y", years: 5 },
  { key: "10y", label: "10Y", years: 10 },
  { key: "25y", label: "25Y", years: 25 },
  { key: "max", label: "Max", years: 0 },
] as const;

const TRANSFORMS: Transform[] = ["level", "yoy", "mom", "index100", "zscore"];

function startDateFor(years: number): string | undefined {
  if (!years) return undefined;
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date.toISOString().slice(0, 10);
}

export default function ExplorerPage() {
  const { seriesId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const category = searchParams.get("category") ?? "all";
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("25y");
  const [transform, setTransform] = useState<Transform>("level");
  const [compare, setCompare] = useState<string[]>([]);
  const toggle = useViewToggle();

  const catalog = useCatalog(category, search || undefined);
  const recessions = useRecessions();

  // Default to the first series in the catalog when the route has none.
  const activeId = seriesId ?? catalog.data?.series[0]?.series_id;
  const detail = useSeriesDetail(activeId);

  // Adopt the series' own natural transform when the user switches series.
  useEffect(() => {
    if (detail.data?.meta.default_transform) {
      setTransform(detail.data.meta.default_transform);
    }
  }, [detail.data?.meta.series_id, detail.data?.meta.default_transform]);

  const years = RANGES.find((r) => r.key === range)?.years ?? 0;
  const start = startDateFor(years);

  const primary = useObservations(activeId, transform, start);
  const compareA = useObservations(compare[0], transform, start);
  const compareB = useObservations(compare[1], transform, start);

  const meta = detail.data?.meta;
  const unit = meta?.unit_kind ?? "count";
  const scale = meta?.scale ?? 1;

  const chartSeries = useMemo<SeriesInput[]>(() => {
    const entries: SeriesInput[] = [];
    if (primary.data && meta) {
      entries.push({
        id: meta.series_id,
        label: meta.display_name,
        color: SERIES_COLORS[0],
        points: primary.data.points.map((p) => ({ date: p.obs_date, value: p.plotted })),
      });
    }
    [compareA, compareB].forEach((query, index) => {
      const id = compare[index];
      if (!id || !query.data) return;
      const entry = catalog.data?.series.find((s) => s.series_id === id);
      entries.push({
        id,
        label: entry?.display_name ?? id,
        color: SERIES_COLORS[index + 1],
        points: query.data.points.map((p) => ({ date: p.obs_date, value: p.plotted })),
      });
    });
    return entries;
  }, [primary.data, compareA.data, compareB.data, compare, meta, catalog.data]);

  // Mixing units on one axis is meaningless, so comparison forces a unitless
  // transform rather than reaching for a second y-axis.
  const comparisonNeedsRebase =
    compare.length > 0 && (transform === "level" || transform === "index100") &&
    chartSeries.length > 1 &&
    new Set(
      chartSeries.map(
        (s) =>
          catalog.data?.series.find((entry) => entry.series_id === s.id)?.unit_kind ?? "level",
      ),
    ).size > 1;

  useEffect(() => {
    if (comparisonNeedsRebase && transform === "level") setTransform("index100");
  }, [comparisonNeedsRebase, transform]);

  function toggleCompare(id: string) {
    setCompare((current) => {
      if (current.includes(id)) return current.filter((c) => c !== id);
      // The primary series occupies one slot, so the comparison list holds
      // MAX_COMPARE - 1. Past that, the oldest selection drops out.
      const limit = MAX_COMPARE - 1;
      if (current.length >= limit) return [...current.slice(1), id];
      return [...current, id];
    });
  }

  const change = meta ? changeFor(meta) : null;
  const sentiment = meta && change ? moveSentiment(meta, change.value) : "neutral";

  return (
    <div className="flex flex-col gap-8">
      <header>
        <Eyebrow>Explorer</Eyebrow>
        <h1 className="display mt-3 text-[clamp(2.25rem,5.5vw,3.75rem)]">
          {meta ? meta.display_name : "Series explorer"}
        </h1>
        {meta && (
          <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-[var(--color-ink-2)]">
            {meta.title}
          </p>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr] xl:grid-cols-[360px_1fr]">
        {/* ---- catalog rail --------------------------------------------- */}
        <aside className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 bg-[var(--color-panel)] p-4">
            <label className="flex flex-col gap-1.5">
              <span className="label-xs text-[var(--color-ink-3)]">Search</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="CPI, unemployment, DGS10…"
                className="border border-[var(--color-rule-strong)] bg-[var(--color-raised)] px-3 py-2 text-[13px] outline-none placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-ink)]"
              />
            </label>

            <div className="flex flex-wrap gap-1.5">
              <Chip
                active={category === "all"}
                onClick={() => setSearchParams({}, { replace: true })}
              >
                All
              </Chip>
              {catalog.data?.categories.map((c) => (
                <Chip
                  key={c.key}
                  active={category === c.key}
                  onClick={() => setSearchParams({ category: c.key }, { replace: true })}
                >
                  {c.label.split(" ")[0]}
                </Chip>
              ))}
            </div>
          </div>

          <div className="max-h-[560px] overflow-y-auto border border-[var(--color-rule)]">
            {catalog.isLoading && <Skeleton height={200} label="Loading catalog" />}
            {catalog.data?.series.map((entry) => {
              const isActive = entry.series_id === activeId;
              const isCompared = compare.includes(entry.series_id);
              return (
                <div
                  key={entry.series_id}
                  className={`flex items-center gap-3 border-b border-[var(--color-rule)] px-3 py-2.5 last:border-b-0 ${
                    isActive ? "bg-[var(--color-ink)] text-[var(--color-ground)]" : "bg-[var(--color-panel)]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => navigate(`/explorer/${entry.series_id}`)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span
                      className={`label-xs ${isActive ? "text-[var(--color-ground)]/60" : "text-[var(--color-ink-3)]"}`}
                    >
                      {entry.series_id}
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] font-medium">
                      {entry.display_name}
                    </span>
                  </button>

                  <span className={isActive ? "text-[var(--color-ground)]" : "text-[var(--color-ink-3)]"}>
                    <Sparkline points={entry.spark} width={54} height={20} color="currentColor" fill={false} />
                  </span>

                  <button
                    type="button"
                    onClick={() => toggleCompare(entry.series_id)}
                    disabled={isActive}
                    aria-pressed={isCompared}
                    title={isActive ? "Already the primary series" : "Add to comparison"}
                    className={`label-xs h-6 w-6 shrink-0 border transition-colors disabled:opacity-25 ${
                      isCompared
                        ? "border-[var(--color-s2)] bg-[var(--color-s2)] text-white"
                        : isActive
                          ? "border-[var(--color-ground)]/30"
                          : "border-[var(--color-rule-strong)] hover:bg-[var(--color-raised)]"
                    }`}
                  >
                    {isCompared ? "−" : "+"}
                  </button>
                </div>
              );
            })}
            {catalog.data?.series.length === 0 && (
              <EmptyNote>No series match that search.</EmptyNote>
            )}
          </div>
        </aside>

        {/* ---- detail ---------------------------------------------------- */}
        <div className="flex min-w-0 flex-col gap-6">
          {meta && (
            <div className="tile-grid grid-cols-2 lg:grid-cols-4">
              <div className="bg-[var(--color-panel)] p-4">
                <p className="label-xs text-[var(--color-ink-3)]">Latest</p>
                <p className="figure-xl mt-2 text-[1.6rem]">
                  {formatValue(meta.latest_value, unit, { compact: true, scale })}
                </p>
                <p className="label-xs mt-1.5 text-[var(--color-ink-3)]">
                  {formatDate(meta.latest_date)}
                </p>
              </div>
              <div className="bg-[var(--color-panel)] p-4">
                <p className="label-xs text-[var(--color-ink-3)]">Year over year</p>
                <p
                  className="figure-xl mt-2 text-[1.6rem]"
                  style={{
                    color:
                      sentiment === "good"
                        ? "var(--color-pos)"
                        : sentiment === "bad"
                          ? "var(--color-neg)"
                          : "var(--color-ink)",
                  }}
                >
                  {change?.text}
                </p>
                <p className="label-xs mt-1.5 text-[var(--color-ink-3)]">
                  {unit === "percent" ? "percentage points" : "percent"}
                </p>
              </div>
              <div className="bg-[var(--color-panel)] p-4">
                <p className="label-xs text-[var(--color-ink-3)]">5Y z-score</p>
                <p className="figure-xl mt-2 text-[1.6rem]">
                  {meta.zscore_5y === null ? "—" : `${meta.zscore_5y > 0 ? "+" : ""}${meta.zscore_5y.toFixed(2)}σ`}
                </p>
                <p className="label-xs mt-1.5 text-[var(--color-ink-3)]">
                  {meta.pctile_10y === null
                    ? "—"
                    : `${Math.round(meta.pctile_10y * 100)}th pctile of 10y`}
                </p>
              </div>
              <div className="bg-[var(--color-panel)] p-4">
                <p className="label-xs text-[var(--color-ink-3)]">History</p>
                <p className="figure-xl mt-2 text-[1.6rem]">
                  {meta.obs_count?.toLocaleString() ?? "—"}
                </p>
                <p className="label-xs mt-1.5 text-[var(--color-ink-3)]">
                  obs since {formatDate(meta.history_start)}
                </p>
              </div>
            </div>
          )}

          <Panel
            title={meta ? `${meta.display_name} · ${TRANSFORM_LABEL[transform]}` : "Chart"}
            subtitle={
              comparisonNeedsRebase
                ? "Series with different units are indexed to 100 at the start of the window — two scales on one chart would be misleading."
                : meta?.units ?? undefined
            }
            actions={
              <>
                <div className="flex border border-[var(--color-rule-strong)]" role="group" aria-label="Range">
                  {RANGES.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setRange(option.key)}
                      aria-pressed={range === option.key}
                      className={`label-xs px-2.5 py-1.5 transition-colors ${
                        range === option.key
                          ? "bg-[var(--color-ink)] text-[var(--color-ground)]"
                          : "text-[var(--color-ink-2)] hover:bg-[var(--color-raised)]"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {toggle.control}
              </>
            }
            footnote={
              meta
                ? `${meta.series_id} · ${FREQUENCY_LABEL[meta.frequency_short ?? ""] ?? meta.frequency ?? "—"} · ${
                    meta.seasonal_adjustment_short ?? "NSA"
                  } · FRED`
                : undefined
            }
          >
            <div className="mb-4 flex flex-wrap gap-1.5">
              {TRANSFORMS.map((option) => (
                <Chip
                  key={option}
                  active={transform === option}
                  onClick={() => setTransform(option)}
                >
                  {TRANSFORM_LABEL[option]}
                </Chip>
              ))}
              {compare.length > 0 && (
                <span className="ml-auto flex items-center gap-2">
                  <span className="label-xs text-[var(--color-ink-3)]">
                    Comparing {compare.length + 1}/{MAX_COMPARE}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCompare([])}
                    className="label-xs border border-[var(--color-rule-strong)] px-2 py-1 text-[var(--color-ink-2)] hover:bg-[var(--color-raised)]"
                  >
                    Clear
                  </button>
                </span>
              )}
            </div>

            {primary.isLoading ? (
              <Skeleton height={340} />
            ) : primary.isError ? (
              <ErrorNote error={primary.error} />
            ) : chartSeries.length === 0 ? (
              <EmptyNote>Select a series to chart.</EmptyNote>
            ) : toggle.view === "chart" ? (
              <TimeSeriesChart
                height={380}
                series={chartSeries}
                fill={chartSeries.length === 1}
                zeroLine={transform === "yoy" || transform === "mom" || transform === "zscore"}
                recessions={recessions.data ?? []}
                formatValue={(v) => formatPlotted(v, transform, unit, scale).replace(/^\+/, "")}
                formatTooltip={(v) => formatPlotted(v, transform, unit, scale)}
                ariaLabel={`${meta?.display_name ?? activeId} as ${TRANSFORM_LABEL[transform]}`}
              />
            ) : (
              <DataTable
                maxHeight={380}
                columns={["Date", ...chartSeries.map((s) => s.id)]}
                rows={(primary.data?.points ?? [])
                  .slice(-250)
                  .reverse()
                  .map((point) => [
                    formatDate(point.obs_date),
                    ...chartSeries.map((s) => {
                      const match = s.points.find((p) => p.date === point.obs_date);
                      return formatPlotted(match?.value ?? null, transform, unit, scale);
                    }),
                  ])}
              />
            )}
          </Panel>

          {meta?.notes && (
            <Panel title="Source notes" subtitle={`As published by FRED for ${meta.series_id}`}>
              <p className="max-w-3xl text-[13px] leading-relaxed text-[var(--color-ink-2)]">
                {meta.notes}
              </p>
            </Panel>
          )}

          {detail.data?.forecast && (
            <Panel
              title="A projection exists for this series"
              subtitle={`${detail.data.forecast.model} · backtested MAPE ${
                detail.data.forecast.mape?.toFixed(2) ?? "—"
              }%`}
              actions={
                <a
                  href={`/forecasts/${meta?.series_id}`}
                  className="label-xs border border-[var(--color-rule-strong)] px-2.5 py-1.5 text-[var(--color-ink-2)] hover:bg-[var(--color-raised)]"
                >
                  Open forecast
                </a>
              }
            >
              <div className="flex items-center gap-3">
                <StatusChip
                  state={
                    (detail.data.forecast.skill ?? 0) > 0.1
                      ? "normal"
                      : (detail.data.forecast.skill ?? 0) > 0
                        ? "warning"
                        : "triggered"
                  }
                />
                <p className="text-[13px] text-[var(--color-ink-2)]">
                  {(detail.data.forecast.skill ?? 0) > 0
                    ? `Beats a naive random-walk baseline by ${(
                        (detail.data.forecast.skill ?? 0) * 100
                      ).toFixed(0)}% on walk-forward error.`
                    : "Does not beat a naive baseline — shown for transparency, not for decisions."}
                </p>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
