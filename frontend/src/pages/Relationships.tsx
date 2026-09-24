import { useMemo, useState } from "react";

import { useCorrelations, useLeadLag } from "../lib/api";
import {
  Chip,
  EmptyNote,
  ErrorNote,
  Eyebrow,
  Panel,
  SectionLabel,
  Skeleton,
} from "../components/ui";
import CorrelationMatrix from "../components/charts/CorrelationMatrix";
import LeadLagChart from "../components/charts/LeadLagChart";
import { DataTable, SERIES_COLORS, useViewToggle } from "../components/charts/primitives";

const WINDOWS = [
  { key: "5y", label: "5 years" },
  { key: "10y", label: "10 years" },
  { key: "full", label: "Full history" },
] as const;

export default function RelationshipsPage() {
  const [window, setWindow] = useState<string>("10y");
  const [target, setTarget] = useState<string>("UNRATE");
  const [selectedIndicator, setSelectedIndicator] = useState<string | null>(null);

  const correlations = useCorrelations(window);
  const leadLag = useLeadLag(target);
  const matrixToggle = useViewToggle();

  const strongest = useMemo(() => {
    if (!correlations.data) return [];
    return correlations.data.cells
      .filter((cell) => cell.series_a < cell.series_b)
      .sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr))
      .slice(0, 10);
  }, [correlations.data]);

  const activeIndicator =
    selectedIndicator ?? leadLag.data?.best[0]?.series_id ?? null;
  const activeCurve = activeIndicator ? leadLag.data?.curves[activeIndicator] : undefined;
  const activeBest = leadLag.data?.best.find((b) => b.series_id === activeIndicator);

  return (
    <div className="flex flex-col gap-10">
      <header>
        <Eyebrow>Relationships</Eyebrow>
        <h1 className="display mt-3 max-w-3xl text-[clamp(2.5rem,6.5vw,4.5rem)]">
          What moves together.
        </h1>
        <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-[var(--color-ink-2)]">
          Everything on this page is computed on year-over-year changes rather than
          levels. Correlating two trending series would mostly measure the trend
          they share; differencing first is what makes these coefficients mean
          something.
        </p>
      </header>

      <section>
        <SectionLabel accent="var(--color-s1)">Correlation matrix</SectionLabel>
        <Panel
          title="Pairwise correlation of year-over-year changes"
          subtitle={correlations.data?.note}
          actions={
            <>
              <div className="flex border border-[var(--color-rule-strong)]" role="group" aria-label="Window">
                {WINDOWS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setWindow(option.key)}
                    aria-pressed={window === option.key}
                    className={`label-xs px-2.5 py-1.5 transition-colors ${
                      window === option.key
                        ? "bg-[var(--color-ink)] text-[var(--color-ground)]"
                        : "text-[var(--color-ink-2)] hover:bg-[var(--color-raised)]"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {matrixToggle.control}
            </>
          }
        >
          {correlations.isLoading ? (
            <Skeleton height={420} />
          ) : correlations.isError ? (
            <ErrorNote error={correlations.error} />
          ) : correlations.data ? (
            matrixToggle.view === "chart" ? (
              <CorrelationMatrix data={correlations.data} />
            ) : (
              <DataTable
                maxHeight={420}
                columns={["Pair", "r", "Observations"]}
                rows={correlations.data.cells
                  .filter((cell) => cell.series_a < cell.series_b)
                  .sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr))
                  .slice(0, 200)
                  .map((cell) => [
                    `${cell.series_a} ↔ ${cell.series_b}`,
                    cell.corr.toFixed(3),
                    cell.n_obs,
                  ])}
              />
            )
          ) : (
            <EmptyNote>No correlations stored.</EmptyNote>
          )}
        </Panel>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Strongest relationships"
          subtitle={`Ranked by absolute correlation over the ${
            WINDOWS.find((w) => w.key === window)?.label.toLowerCase() ?? window
          } window.`}
        >
          {correlations.isLoading ? (
            <Skeleton height={300} />
          ) : (
            <ol className="flex flex-col">
              {strongest.map((pair, index) => {
                const labelA = correlations.data?.labels[pair.series_a]?.display_name ?? pair.series_a;
                const labelB = correlations.data?.labels[pair.series_b]?.display_name ?? pair.series_b;
                const positive = pair.corr >= 0;
                return (
                  <li
                    key={`${pair.series_a}-${pair.series_b}`}
                    className="flex items-center gap-4 border-b border-[var(--color-rule)] py-3 last:border-0"
                  >
                    <span className="label-xs w-5 shrink-0 text-[var(--color-ink-3)]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium">
                        {labelA} <span className="text-[var(--color-ink-3)]">↔</span> {labelB}
                      </span>
                      <span className="label-xs text-[var(--color-ink-3)]">
                        {pair.series_a} · {pair.series_b} · n={pair.n_obs}
                      </span>
                    </span>
                    {/* A bar plus the sign word: direction never rests on colour. */}
                    <span className="flex w-28 shrink-0 items-center gap-2">
                      <span className="relative h-2 flex-1 bg-[var(--color-rule)]">
                        <span
                          className="absolute inset-y-0"
                          style={{
                            width: `${Math.abs(pair.corr) * 100}%`,
                            right: positive ? undefined : 0,
                            left: positive ? 0 : undefined,
                            background: positive ? "var(--color-div-pos)" : "var(--color-div-neg)",
                          }}
                        />
                      </span>
                      <span className="tnum w-11 shrink-0 text-right text-[13px] font-semibold">
                        {pair.corr.toFixed(2)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>

        <Panel
          title="Lead / lag study"
          subtitle={leadLag.data?.note}
          actions={
            <div className="flex flex-wrap gap-1.5">
              {(leadLag.data?.available_targets ?? ["UNRATE", "CPIAUCSL", "INDPRO"]).map((option) => (
                <Chip key={option} active={target === option} onClick={() => { setTarget(option); setSelectedIndicator(null); }}>
                  {option}
                </Chip>
              ))}
            </div>
          }
          footnote={
            activeBest
              ? activeBest.best_lag < 0
                ? `${activeBest.display_name} turns about ${Math.abs(
                    activeBest.best_lag,
                  )} month(s) before ${leadLag.data?.target.display_name}.`
                : activeBest.best_lag > 0
                  ? `${activeBest.display_name} follows ${leadLag.data?.target.display_name} by about ${activeBest.best_lag} month(s).`
                  : `${activeBest.display_name} moves at the same time as ${leadLag.data?.target.display_name}.`
              : undefined
          }
        >
          {leadLag.isLoading ? (
            <Skeleton height={300} />
          ) : leadLag.isError ? (
            <ErrorNote error={leadLag.error} />
          ) : leadLag.data ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-1.5">
                {leadLag.data.best.slice(0, 6).map((entry) => (
                  <Chip
                    key={entry.series_id}
                    active={entry.series_id === activeIndicator}
                    onClick={() => setSelectedIndicator(entry.series_id)}
                  >
                    {entry.series_id}
                  </Chip>
                ))}
              </div>

              {activeCurve && activeBest ? (
                <LeadLagChart
                  curve={activeCurve}
                  bestLag={activeBest.best_lag}
                  label={activeBest.display_name}
                  color={SERIES_COLORS[0]}
                />
              ) : (
                <EmptyNote>Select an indicator.</EmptyNote>
              )}

              <table className="w-full border-collapse text-[12.5px]">
                <caption className="sr-only">
                  Best lag and correlation for each indicator against {target}
                </caption>
                <thead>
                  <tr>
                    {["Indicator", "Best lag", "r at best", "r at 0"].map((column) => (
                      <th
                        key={column}
                        scope="col"
                        className="label-xs border-b border-[var(--color-rule)] py-2 text-left text-[var(--color-ink-3)] last:text-right"
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leadLag.data.best.slice(0, 8).map((entry) => (
                    <tr
                      key={entry.series_id}
                      className="border-b border-[var(--color-rule)] last:border-0"
                    >
                      <td className="py-2">
                        <span className="font-medium">{entry.display_name}</span>{" "}
                        <span className="label-xs text-[var(--color-ink-3)]">{entry.series_id}</span>
                      </td>
                      <td className="tnum py-2">
                        {entry.best_lag > 0 ? `+${entry.best_lag}` : entry.best_lag}m
                        <span className="label-xs ml-1.5 text-[var(--color-ink-3)]">
                          {entry.best_lag < 0 ? "leads" : entry.best_lag > 0 ? "lags" : "same"}
                        </span>
                      </td>
                      <td className="tnum py-2 font-semibold">{entry.best_corr.toFixed(3)}</td>
                      <td className="tnum py-2 text-right text-[var(--color-ink-2)]">
                        {entry.contemp_corr === null ? "—" : entry.contemp_corr.toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyNote>No lead/lag study available.</EmptyNote>
          )}
        </Panel>
      </section>

      <section className="border-t border-[var(--color-rule)] pt-6">
        <p className="max-w-3xl text-[13px] leading-relaxed text-[var(--color-ink-3)]">
          <strong className="font-semibold text-[var(--color-ink-2)]">A caution.</strong>{" "}
          Correlation over a fixed window is a summary, not a mechanism. Two series can
          correlate because one drives the other, because both answer to a third thing,
          or because the window happens to contain one large shared shock — the 2020
          collapse dominates any window that includes it. The lead/lag peak is the more
          interesting number here, and even that is a description of the past.
        </p>
      </section>
    </div>
  );
}
