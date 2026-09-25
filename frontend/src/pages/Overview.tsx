import { useMemo } from "react";
import { Link } from "react-router-dom";

import { useOverview, useRecessions, useObservations } from "../lib/api";
import { changeFor, formatDate, headlineFor, moveSentiment } from "../lib/format";
import {
  EmptyNote,
  ErrorNote,
  Panel,
  SectionLabel,
  SeriesTile,
  Skeleton,
  StatusChip,
} from "../components/ui";
import TimeSeriesChart from "../components/charts/TimeSeriesChart";
import Sparkline from "../components/charts/Sparkline";
import type { TileTone } from "../components/ui";
import type { SeriesCard } from "../lib/types";

/** The accent tiles are earned, not decorative: the series with the most
 *  unusual reading versus its own five-year history takes the terracotta tile,
 *  the best-behaved takes forest. Everything else stays on paper. */
function assignTones(cards: SeriesCard[]): TileTone[] {
  const scored = cards.map((card, index) => {
    const change = changeFor(card);
    const sentiment = moveSentiment(card, change.value);
    const stretch = Math.abs(card.zscore_5y ?? 0);
    return { index, sentiment, stretch };
  });

  const worst = scored
    .filter((s) => s.sentiment === "bad")
    .sort((a, b) => b.stretch - a.stretch)[0];
  const best = scored
    .filter((s) => s.sentiment === "good" && s.index !== worst?.index)
    .sort((a, b) => b.stretch - a.stretch)[0];

  return cards.map((_, index) => {
    if (index === worst?.index) return "terracotta";
    if (index === best?.index) return "forest";
    return index === 0 ? "ink" : "paper";
  });
}

export default function OverviewPage() {
  const overview = useOverview();
  const recessions = useRecessions();
  const unemployment = useObservations("UNRATE", "level", "1990-01-01");

  const tones = useMemo(
    () => (overview.data ? assignTones(overview.data.headline) : []),
    [overview.data],
  );

  if (overview.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton height={120} label="Loading overview" />
        <Skeleton height={260} />
      </div>
    );
  }

  if (overview.isError) {
    return (
      <ErrorNote
        error={overview.error}
        hint="Is the API running? Start it with `python -m app.cli serve` from the backend directory."
      />
    );
  }

  const data = overview.data!;
  const triggered = data.signals.filter((s) => s.latest_state === "triggered");
  const watching = data.signals.filter((s) => s.latest_state === "warning");

  return (
    <div className="flex flex-col gap-12">
      {/* ---- hero -------------------------------------------------------- */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <h1 className="label-sm text-[var(--color-ink-3)]">Overview</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="label-xs text-[var(--color-ink-3)]">Current read</span>
            <div className="flex flex-wrap items-center gap-2">
              {triggered.length > 0 ? (
                <>
                  <StatusChip state="triggered" />
                  <span className="text-[14px] font-medium">
                    {triggered.length} signal{triggered.length > 1 ? "s" : ""} tripped
                  </span>
                </>
              ) : watching.length > 0 ? (
                <>
                  <StatusChip state="warning" />
                  <span className="text-[14px] font-medium">
                    {watching.length} signal{watching.length > 1 ? "s" : ""} worth watching
                  </span>
                </>
              ) : (
                <>
                  <StatusChip state="normal" />
                  <span className="text-[14px] font-medium">No recession signal tripped</span>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ---- headline tiles ---------------------------------------------- */}
      <section>
        <SectionLabel accent="var(--color-forest)">The four numbers</SectionLabel>
        <div className="tile-grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          {data.headline.map((card, index) => (
            <SeriesTile key={card.series_id} card={card} tone={tones[index]} />
          ))}
        </div>
      </section>

      {/* ---- pulse row ---------------------------------------------------- */}
      <section>
        <SectionLabel accent="var(--color-terracotta)">Pulse</SectionLabel>
        <div className="tile-grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {data.pulse.map((card) => {
            const change = changeFor(card);
            const sentiment = moveSentiment(card, change.value);
            const headline = headlineFor(card);
            return (
              <Link
                key={card.series_id}
                to={`/explorer/${card.series_id}`}
                className="group flex items-center justify-between gap-4 bg-[var(--color-panel)] p-5 transition-colors hover:bg-[var(--color-raised)]"
              >
                <div className="min-w-0">
                  <p className="label-xs text-[var(--color-ink-3)]">{card.series_id}</p>
                  <p className="mt-1.5 truncate text-[14px] font-semibold">{card.display_name}</p>
                  <p className="figure-xl mt-2.5 text-[1.75rem]">{headline.value}</p>
                  <p
                    className="tnum mt-1 text-[12.5px] font-semibold"
                    style={{
                      color:
                        sentiment === "good"
                          ? "var(--color-pos)"
                          : sentiment === "bad"
                            ? "var(--color-neg)"
                            : "var(--color-ink-2)",
                    }}
                  >
                    {headline.caption ? (
                      <span className="font-normal text-[var(--color-ink-3)]">
                        {headline.caption}
                      </span>
                    ) : (
                      <>
                        {change.text}{" "}
                        <span className="font-normal text-[var(--color-ink-3)]">
                          {change.basis}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <div className="shrink-0 text-[var(--color-ink-3)] transition-colors group-hover:text-[var(--color-ink)]">
                  <Sparkline points={card.spark} width={104} height={44} color="currentColor" />
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ---- signals + chart --------------------------------------------- */}
      <section className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Panel
          title="Unemployment rate since 1990"
          subtitle="Shaded bands are NBER-dated contractions, joined from the warehouse."
          actions={
            <Link
              to="/explorer/UNRATE"
              className="label-xs border border-[var(--color-rule-strong)] px-2.5 py-1.5 text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-raised)]"
            >
              Open in explorer
            </Link>
          }
        >
          {unemployment.isLoading ? (
            <Skeleton height={300} />
          ) : unemployment.data ? (
            <TimeSeriesChart
              height={320}
              fill
              formatValue={(v) => `${v.toFixed(1)}%`}
              formatTooltip={(v) => `${v.toFixed(2)}%`}
              recessions={recessions.data ?? []}
              series={[
                {
                  id: "UNRATE",
                  label: "Unemployment rate",
                  color: "var(--color-s1)",
                  points: unemployment.data.points.map((p) => ({
                    date: p.obs_date,
                    value: p.plotted,
                  })),
                },
              ]}
            />
          ) : (
            <EmptyNote>No observations loaded yet.</EmptyNote>
          )}
        </Panel>

        <Panel
          title="Recession signals"
          subtitle="Each recomputed from the warehouse, not downloaded pre-baked."
          actions={
            <Link
              to="/signals"
              className="label-xs border border-[var(--color-rule-strong)] px-2.5 py-1.5 text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-raised)]"
            >
              All signals
            </Link>
          }
        >
          <ul className="flex flex-col">
            {data.signals.map((signal, index) => (
              <li
                key={signal.signal_key}
                className={index > 0 ? "border-t border-[var(--color-rule)] pt-3.5 mt-3.5" : ""}
              >
                <Link to={`/signals/${signal.signal_key}`} className="group block">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13.5px] font-semibold group-hover:underline">
                      {signal.label}
                    </span>
                    <span className="tnum text-[15px] font-bold">
                      {signal.latest_value === null ? "—" : signal.latest_value.toFixed(2)}
                      <span className="label-xs ml-1 font-normal text-[var(--color-ink-3)]">
                        {signal.unit}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-3">
                    <StatusChip state={signal.latest_state} />
                    <span className="label-xs text-[var(--color-ink-3)]">
                      {formatDate(signal.latest_date)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </section>

      {/* ---- category index ---------------------------------------------- */}
      <section>
        <SectionLabel>Coverage</SectionLabel>
        <div className="tile-grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {data.categories.map((category) => (
            <Link
              key={category.category}
              to={`/explorer?category=${category.category}`}
              className="group flex flex-col justify-between bg-[var(--color-panel)] p-5 transition-colors hover:bg-[var(--color-raised)]"
            >
              <div>
                <p className="label-xs text-[var(--color-ink-3)]">{category.label}</p>
                <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-ink-2)]">
                  {category.blurb}
                </p>
              </div>
              <p className="mt-6 flex items-baseline gap-2">
                <span className="figure-xl text-[1.75rem]">{category.series_count}</span>
                <span className="label-xs text-[var(--color-ink-3)]">
                  series · through {formatDate(category.latest_date)}
                </span>
              </p>
            </Link>
          ))}

          {/* The category count does not divide evenly into the grid, so the
              remaining cell carries the totals rather than sitting empty. */}
          <div className="flex flex-col justify-between bg-[var(--color-ink)] p-5 text-[var(--color-ground)]">
            <div>
              <p className="label-xs text-[var(--color-ground)]/60">Whole warehouse</p>
              <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-ground)]/75">
                Every series is re-pulled on a weekday schedule, then the derived
                tables are rebuilt in one transaction.
              </p>
            </div>
            <p className="mt-6 flex items-baseline gap-2">
              <span className="figure-xl text-[1.75rem]">
                {data.coverage.observations.toLocaleString()}
              </span>
              <span className="label-xs text-[var(--color-ground)]/60">observations</span>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
