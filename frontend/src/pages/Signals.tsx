import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useCurve, useRecessions, useSignalDetail, useSignals } from "../lib/api";
import { formatDate } from "../lib/format";
import {
  Chip,
  EmptyNote,
  ErrorNote,
  Eyebrow,
  Panel,
  SectionLabel,
  SignalCard,
  Skeleton,
  StatusChip,
} from "../components/ui";
import TimeSeriesChart from "../components/charts/TimeSeriesChart";
import YieldCurveChart from "../components/charts/YieldCurveChart";
import { DataTable, useViewToggle } from "../components/charts/primitives";

const HISTORY_RANGES = [
  { key: "1980-01-01", label: "Since 1980" },
  { key: "2000-01-01", label: "Since 2000" },
  { key: "2015-01-01", label: "Since 2015" },
] as const;

export default function SignalsPage() {
  const { signalKey } = useParams();
  const navigate = useNavigate();
  const signals = useSignals();
  const curve = useCurve();
  const recessions = useRecessions();

  const [start, setStart] = useState<string>("2000-01-01");
  const toggle = useViewToggle();

  const activeKey = signalKey ?? signals.data?.signals[0]?.signal_key;
  const detail = useSignalDetail(activeKey, start);

  const verdict = signals.data?.verdict ?? "clear";
  const headline = useMemo(() => {
    if (verdict === "elevated") return "Something is flashing.";
    if (verdict === "watch") return "Worth watching.";
    return "All clear, for now.";
  }, [verdict]);

  if (signals.isError) return <ErrorNote error={signals.error} />;

  return (
    <div className="flex flex-col gap-10">
      <header>
        <Eyebrow>Signals</Eyebrow>
        <h1 className="display mt-3 max-w-3xl text-[clamp(2.5rem,6.5vw,4.5rem)]">{headline}</h1>
        <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-[var(--color-ink-2)]">
          {signals.data?.signals.length ?? ""} recession and stress rules, each
          recomputed from the warehouse rather than downloaded ready-made — so the
          ingredients, the thresholds and the history behind every reading are all
          inspectable.
        </p>
      </header>

      <section>
        <SectionLabel accent="var(--color-terracotta)">Current readings</SectionLabel>
        {signals.isLoading ? (
          <Skeleton height={220} />
        ) : (
          <div className="tile-grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {signals.data?.signals.map((signal) => (
              <SignalCard
                key={signal.signal_key}
                signal={signal}
                to={`/signals/${signal.signal_key}`}
              />
            ))}

            {/* Five signals into a three-column grid leaves a gap; it carries
                the combined read rather than sitting empty. */}
            <article className="flex flex-col justify-between bg-[var(--color-ink)] p-5 text-[var(--color-ground)]">
              <div>
                <h3 className="text-[14px] font-semibold">Taken together</h3>
                <p className="mt-2.5 text-[12px] leading-relaxed text-[var(--color-ground)]/70">
                  No single rule calls a cycle. These five disagree often, and the
                  useful question is how many are leaning the same way at once.
                </p>
              </div>
              <p className="mt-6">
                <span className="figure-xl text-[2rem]">
                  {(signals.data?.state_counts.triggered ?? 0) +
                    (signals.data?.state_counts.warning ?? 0)}
                </span>
                <span className="label-xs ml-2 text-[var(--color-ground)]/60">
                  of {signals.data?.signals.length ?? 0} leaning negative
                </span>
              </p>
            </article>
          </div>
        )}
      </section>

      <section className="grid items-start gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Panel
          title={detail.data?.meta.label ?? "Signal history"}
          subtitle={detail.data?.meta.description}
          actions={
            <>
              <div className="flex border border-[var(--color-rule-strong)]" role="group" aria-label="Range">
                {HISTORY_RANGES.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setStart(option.key)}
                    aria-pressed={start === option.key}
                    className={`label-xs px-2.5 py-1.5 transition-colors ${
                      start === option.key
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
            detail.data
              ? `Alarm ${detail.data.meta.direction} ${detail.data.meta.threshold.toFixed(2)} ${
                  detail.data.meta.unit
                } · ${detail.data.points.length.toLocaleString()} observations plotted`
              : undefined
          }
        >
          <div className="mb-4 flex flex-wrap gap-1.5">
            {signals.data?.signals.map((signal) => (
              <Chip
                key={signal.signal_key}
                active={signal.signal_key === activeKey}
                onClick={() => navigate(`/signals/${signal.signal_key}`)}
              >
                {signal.label}
              </Chip>
            ))}
          </div>

          {detail.isLoading ? (
            <Skeleton height={340} />
          ) : !detail.data ? (
            <EmptyNote>Select a signal.</EmptyNote>
          ) : toggle.view === "chart" ? (
            <TimeSeriesChart
              height={360}
              recessions={recessions.data ?? []}
              zeroLine
              threshold={{
                value: detail.data.meta.threshold,
                label: "threshold",
              }}
              formatValue={(v) => v.toFixed(2)}
              formatTooltip={(v) => `${v.toFixed(3)} ${detail.data!.meta.unit}`}
              series={[
                {
                  id: detail.data.meta.signal_key,
                  label: detail.data.meta.label,
                  color: "var(--color-s1)",
                  points: detail.data.points.map((p) => ({
                    date: p.obs_date,
                    value: p.value,
                  })),
                },
              ]}
              ariaLabel={`${detail.data.meta.label} history`}
            />
          ) : (
            <DataTable
              maxHeight={360}
              columns={["Date", detail.data.meta.label, "State"]}
              rows={detail.data.points
                .slice(-250)
                .reverse()
                .map((p) => [
                  formatDate(p.obs_date),
                  p.value === null ? "—" : p.value.toFixed(3),
                  p.state,
                ])}
            />
          )}
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel
            title="Treasury curve"
            subtitle={
              curve.data
                ? `As of ${formatDate(curve.data.as_of)} · ${
                    curve.data.inverted ? "inverted" : "upward sloping"
                  }`
                : undefined
            }
          >
            {curve.isLoading ? (
              <Skeleton height={260} />
            ) : curve.data ? (
              <YieldCurveChart data={curve.data} />
            ) : (
              <EmptyNote>No curve data.</EmptyNote>
            )}
          </Panel>

          <Panel
            title="Episodes"
            subtitle="Contiguous stretches where this signal sat on the alarm side of its threshold."
          >
            {detail.data?.episodes.length ? (
              <ul className="flex flex-col">
                {[...detail.data.episodes].reverse().slice(0, 10).map((episode) => (
                  <li
                    key={episode.start_date}
                    className="flex items-baseline justify-between gap-3 border-b border-[var(--color-rule)] py-2.5 last:border-0"
                  >
                    <span className="tnum text-[13px]">
                      {formatDate(episode.start_date)}
                      <span className="text-[var(--color-ink-3)]"> → </span>
                      {episode.end_date ? formatDate(episode.end_date) : "ongoing"}
                    </span>
                    <span className="label-xs shrink-0 text-[var(--color-ink-3)]">
                      {episode.length_days ?? 0}d · peak {episode.peak_value?.toFixed(2) ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyNote>This signal has never crossed its threshold in the stored history.</EmptyNote>
            )}
          </Panel>
        </div>
      </section>

      <section>
        <SectionLabel>How to read these</SectionLabel>
        <div className="tile-grid grid-cols-1 md:grid-cols-3">
          {[
            {
              title: "A signal is a rule, not a forecast",
              body: "Each one encodes a historical regularity — an inverted curve, a rising unemployment trend, widening credit spreads. They have all fired before recessions; they have also fired without one.",
            },
            {
              title: "Thresholds are conventions",
              body: "0.50pp for the Sahm rule and zero for the curve are the conventional cut-offs, not laws. The meter on each card shows how far the current reading sits from its threshold rather than just which side it is on.",
            },
            {
              title: "Recomputed, not downloaded",
              body: "The Sahm rule here is rebuilt from the unemployment rate in the warehouse, so it can be charted alongside its own inputs and audited against FRED's official series.",
            },
          ].map((note) => (
            <article key={note.title} className="bg-[var(--color-panel)] p-5">
              <h3 className="text-[14px] font-semibold">{note.title}</h3>
              <p className="mt-2.5 text-[13px] leading-relaxed text-[var(--color-ink-2)]">
                {note.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      <div className="flex items-center gap-3 border-t border-[var(--color-rule)] pt-6">
        <StatusChip state={verdict === "elevated" ? "triggered" : verdict === "watch" ? "warning" : "normal"} />
        <p className="text-[13px] text-[var(--color-ink-2)]">
          {signals.data
            ? `${signals.data.state_counts.normal ?? 0} normal · ${
                signals.data.state_counts.warning ?? 0
              } watch · ${signals.data.state_counts.triggered ?? 0} triggered`
            : "—"}
        </p>
      </div>
    </div>
  );
}
