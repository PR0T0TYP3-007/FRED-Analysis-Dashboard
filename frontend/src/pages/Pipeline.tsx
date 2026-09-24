import { useMemo, useState } from "react";

import { usePipeline } from "../lib/api";
import { formatDate, formatDateTime, formatDuration, relativeTime } from "../lib/format";
import {
  Chip,
  EmptyNote,
  ErrorNote,
  Eyebrow,
  Panel,
  SectionLabel,
  Skeleton,
  StatusChip,
} from "../components/ui";

const RUN_STATE: Record<string, string> = {
  success: "normal",
  partial: "warning",
  failed: "triggered",
  running: "unknown",
};

export default function PipelinePage() {
  const pipeline = usePipeline();
  const [filter, setFilter] = useState<"all" | "stale" | "fresh">("all");

  const freshness = useMemo(() => {
    const rows = pipeline.data?.freshness ?? [];
    if (filter === "all") return rows;
    return rows.filter((row) => row.freshness === filter);
  }, [pipeline.data, filter]);

  if (pipeline.isLoading) return <Skeleton height={400} label="Loading pipeline" />;
  if (pipeline.isError) return <ErrorNote error={pipeline.error} />;

  const data = pipeline.data!;
  const lastRun = data.runs[0];
  const lastAnalytics = data.analytics_runs[0];

  return (
    <div className="flex flex-col gap-10">
      <header>
        <Eyebrow>Pipeline</Eyebrow>
        <h1 className="display mt-3 max-w-3xl text-[clamp(2.5rem,6.5vw,4.5rem)]">
          Where the numbers came from.
        </h1>
        <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-[var(--color-ink-2)]">
          A dashboard is only as trustworthy as its loader. Every ingest writes a run
          record and a row per series, so staleness and failures are visible here
          instead of quietly showing up as wrong numbers on the other screens.
        </p>
      </header>

      <section className="tile-grid grid-cols-2 lg:grid-cols-4">
        <div className="bg-[var(--color-ink)] p-5 text-[var(--color-ground)]">
          <p className="label-xs text-[var(--color-ground)]/60">Observations</p>
          <p className="figure-xl mt-3 text-[2.1rem]">
            {data.totals.observations.toLocaleString()}
          </p>
          <p className="label-xs mt-2 text-[var(--color-ground)]/60">
            {formatDate(data.totals.earliest)} → {formatDate(data.totals.latest)}
          </p>
        </div>
        <div className="bg-[var(--color-panel)] p-5">
          <p className="label-xs text-[var(--color-ink-3)]">Series tracked</p>
          <p className="figure-xl mt-3 text-[2.1rem]">{data.totals.series}</p>
          <p className="label-xs mt-2 text-[var(--color-ink-3)]">
            {data.totals.metric_rows.toLocaleString()} derived rows
          </p>
        </div>
        <div
          className={`p-5 ${
            data.stale_count > 0
              ? "bg-[var(--color-terracotta)] text-[#fdf6f2]"
              : "bg-[var(--color-forest)] text-[#eef6f2]"
          }`}
        >
          <p className="label-xs opacity-70">Stale series</p>
          <p className="figure-xl mt-3 text-[2.1rem]">{data.stale_count}</p>
          <p className="label-xs mt-2 opacity-70">
            judged on FRED&apos;s own publication date
          </p>
        </div>
        <div className="bg-[var(--color-panel)] p-5">
          <p className="label-xs text-[var(--color-ink-3)]">Last refresh</p>
          <p className="figure-xl mt-3 text-[2.1rem]">
            {lastRun ? relativeTime(lastRun.started_at) : "—"}
          </p>
          <p className="label-xs mt-2 text-[var(--color-ink-3)]">
            {lastRun ? `${lastRun.api_calls} API calls · ${formatDuration(lastRun.duration_ms)}` : "—"}
          </p>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Panel title="Ingest runs" subtitle="Extract and load from the FRED API into core.*">
          {data.runs.length === 0 ? (
            <EmptyNote>No runs recorded yet.</EmptyNote>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    {["Run", "Started", "Status", "Series", "Rows", "Calls", "Took"].map((column) => (
                      <th
                        key={column}
                        scope="col"
                        className="label-xs border-b border-[var(--color-rule)] py-2 pr-3 text-left text-[var(--color-ink-3)]"
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.runs.map((run) => (
                    <tr key={run.run_id} className="border-b border-[var(--color-rule)] last:border-0">
                      <td className="tnum py-2.5 pr-3">
                        #{run.run_id}
                        <span className="label-xs ml-1.5 text-[var(--color-ink-3)]">
                          {run.trigger}
                        </span>
                      </td>
                      <td className="tnum py-2.5 pr-3 text-[var(--color-ink-2)]">
                        {formatDateTime(run.started_at)}
                      </td>
                      <td className="py-2.5 pr-3">
                        <StatusChip state={RUN_STATE[run.status] ?? "unknown"} compact />
                        <span className="label-xs ml-1.5 text-[var(--color-ink-2)]">{run.status}</span>
                      </td>
                      <td className="tnum py-2.5 pr-3">
                        {run.series_ok}/{run.series_total}
                        {run.series_failed > 0 && (
                          <span className="ml-1 text-[var(--color-neg)]">
                            ({run.series_failed} failed)
                          </span>
                        )}
                      </td>
                      <td className="tnum py-2.5 pr-3">{run.rows_upserted.toLocaleString()}</td>
                      <td className="tnum py-2.5 pr-3 text-[var(--color-ink-2)]">{run.api_calls}</td>
                      <td className="tnum py-2.5 text-[var(--color-ink-2)]">
                        {formatDuration(run.duration_ms)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          title="Analytics runs"
          subtitle="Transform: rebuilds every derived table in analytics.* inside one transaction"
        >
          {data.analytics_runs.length === 0 ? (
            <EmptyNote>No analytics runs recorded yet.</EmptyNote>
          ) : (
            <ul className="flex flex-col">
              {data.analytics_runs.map((run) => (
                <li
                  key={run.run_id}
                  className="border-b border-[var(--color-rule)] py-3 last:border-0"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <StatusChip state={RUN_STATE[run.status] ?? "unknown"} compact />
                      <span className="tnum text-[13px] font-medium">#{run.run_id}</span>
                      <span className="label-xs text-[var(--color-ink-3)]">
                        {formatDateTime(run.started_at)}
                      </span>
                    </span>
                    <span className="label-xs text-[var(--color-ink-3)]">
                      {formatDuration(run.duration_ms)}
                    </span>
                  </div>
                  {run.stages && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {Object.entries(run.stages).map(([stage, counts]) => (
                        <span
                          key={stage}
                          className="label-xs border border-[var(--color-rule)] px-2 py-1 text-[var(--color-ink-2)]"
                          title={Object.entries(counts)
                            .map(([k, v]) => `${k}: ${v.toLocaleString()}`)
                            .join(", ")}
                        >
                          {stage}{" "}
                          <span className="tnum text-[var(--color-ink-3)]">
                            {/* Total rows the stage wrote. Showing whichever key
                                happened to serialise first was meaningless. */}
                            {Object.values(counts)
                              .reduce((sum, n) => sum + n, 0)
                              .toLocaleString()}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                  {run.error && (
                    <p className="mt-2 text-[12px] text-[var(--color-neg)]">{run.error}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <section>
        <SectionLabel>Per-series freshness</SectionLabel>
        <Panel
          title="Data freshness"
          subtitle="Measured against when FRED last published each series, not against the age of the newest reference period — a monthly series reporting July data in September is current, not stale."
          actions={
            <div className="flex flex-wrap gap-1.5">
              {(["all", "stale", "fresh"] as const).map((option) => (
                <Chip key={option} active={filter === option} onClick={() => setFilter(option)}>
                  {option}
                </Chip>
              ))}
            </div>
          }
        >
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead className="sticky top-0 bg-[var(--color-panel)]">
                <tr>
                  {["Series", "Freq", "Published", "Latest period", "Obs", "State"].map((column) => (
                    <th
                      key={column}
                      scope="col"
                      className="label-xs border-b border-[var(--color-rule)] py-2 pr-3 text-left text-[var(--color-ink-3)]"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {freshness.map((row) => (
                  <tr
                    key={row.series_id}
                    className="border-b border-[var(--color-rule)] last:border-0"
                  >
                    <td className="py-2.5 pr-3">
                      <span className="font-medium">{row.display_name}</span>{" "}
                      <span className="label-xs text-[var(--color-ink-3)]">{row.series_id}</span>
                    </td>
                    <td className="label-xs py-2.5 pr-3 text-[var(--color-ink-2)]">
                      {row.frequency_short ?? "—"}
                    </td>
                    <td className="tnum py-2.5 pr-3 text-[var(--color-ink-2)]">
                      {row.published_days_ago === null ? "—" : `${row.published_days_ago}d ago`}
                    </td>
                    <td className="tnum py-2.5 pr-3 text-[var(--color-ink-2)]">
                      {formatDate(row.latest_date)}
                    </td>
                    <td className="tnum py-2.5 pr-3 text-[var(--color-ink-2)]">
                      {row.obs_count?.toLocaleString() ?? "—"}
                    </td>
                    <td className="py-2.5">
                      <StatusChip
                        state={row.freshness === "fresh" ? "normal" : row.freshness === "stale" ? "warning" : "unknown"}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>

      {lastAnalytics?.stages && (
        <section className="border-t border-[var(--color-rule)] pt-6">
          <p className="label-xs text-[var(--color-ink-3)]">
            Last analytics pass rebuilt{" "}
            {Object.entries(lastAnalytics.stages)
              .map(
                ([stage, counts]) =>
                  `${stage} (${Object.values(counts)
                    .reduce((sum, n) => sum + n, 0)
                    .toLocaleString()} rows)`,
              )
              .join(" · ")}
          </p>
        </section>
      )}
    </div>
  );
}
