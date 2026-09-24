import { useState } from "react";
import { Link } from "react-router-dom";

import { useObservations, useOverview, useRecessions } from "../lib/api";
import { TRANSFORM_LABEL, formatPlotted } from "../lib/format";
import { Chip, Eyebrow, Panel, SectionLabel, Skeleton, StatusChip } from "../components/ui";
import TimeSeriesChart from "../components/charts/TimeSeriesChart";
import Sparkline from "../components/charts/Sparkline";
import type { Transform } from "../lib/types";

/* ===========================================================================
   A visitor's orientation: what this is, where to go, and how to read every
   chart on the site. The chart demo is live rather than illustrated -- it is
   the same component the Explorer uses, on real data.
   =========================================================================== */

const SCREENS = [
  {
    to: "/",
    name: "Overview",
    question: "What is the state of the economy right now?",
    detail:
      "Four headline numbers, a pulse row of six more, the recession signals and how much data sits behind it all. Start here.",
  },
  {
    to: "/explorer",
    name: "Explorer",
    question: "What does one series look like, and against what?",
    detail:
      "Every tracked series, five ways of transforming it, and up to three compared on a single axis. This is where you spend most of your time.",
  },
  {
    to: "/signals",
    name: "Signals",
    question: "Is anything flashing?",
    detail:
      "Five recession and stress rules, each with a meter showing how far the current reading sits from its threshold, plus every historical episode.",
  },
  {
    to: "/relationships",
    name: "Relationships",
    question: "What moves together, and what moves first?",
    detail:
      "A correlation matrix across twenty series, and a lead/lag study that asks which indicators turn before the one you care about.",
  },
  {
    to: "/forecasts",
    name: "Forecasts",
    question: "What does a simple model say, and should I believe it?",
    detail:
      "Twelve-month projections with an uncertainty band — and the backtest score that says whether the model beats doing nothing.",
  },
  {
    to: "/pipeline",
    name: "Pipeline",
    question: "Where did these numbers come from?",
    detail:
      "Every data load this warehouse has run, how long it took, and how fresh each series is. The screen that makes the other five trustworthy.",
  },
];

const TRANSFORM_NOTES: Record<Transform, { blurb: string; use: string }> = {
  level: {
    blurb: "The raw published value, exactly as FRED reports it.",
    use: "Right for anything already expressed as a rate — unemployment, Treasury yields, spreads.",
  },
  yoy: {
    blurb: "Percent change against the same period one year earlier.",
    use: "The standard way to read a price index. CPI's level of 334 means nothing; its 3.7% year-over-year change is the inflation rate everyone quotes.",
  },
  mom: {
    blurb: "Change against the immediately preceding period.",
    use: "Shows momentum and turning points earlier than year-over-year, at the cost of far more noise.",
  },
  index100: {
    blurb: "Every series rebased to 100 at the start of the visible window.",
    use: "The only honest way to compare series measured in different units. This is what the site switches to automatically when you compare mismatched series.",
  },
  zscore: {
    blurb: "How many standard deviations the value sits from its own five-year average.",
    use: "Answers 'is this unusual?' rather than 'is this high?' — a 4% unemployment rate is low historically but unremarkable lately.",
  },
};

const GLOSSARY = [
  {
    term: "Percentage point (pp)",
    body: "The difference between two percentages. Unemployment moving from 4.0% to 4.4% is a rise of 0.4pp. Calling it '+10%' is technically true of the ratio and badly misleading, so this site never does.",
  },
  {
    term: "Year over year (YoY)",
    body: "Compared with the same period twelve months earlier. It cancels out seasonal patterns, which is why it is the default reading for prices and activity.",
  },
  {
    term: "Seasonally adjusted (SA)",
    body: "Statistically stripped of predictable calendar effects — the Christmas retail spike, summer construction. Most series here are seasonally adjusted at source.",
  },
  {
    term: "Z-score",
    body: "Distance from the mean measured in standard deviations. Around 0 is typical, beyond ±2 is genuinely unusual. Used here against a rolling five-year window.",
  },
  {
    term: "Percentile rank",
    body: "Where today sits within the last ten years of its own history. 90 means higher than 90% of the past decade.",
    },
  {
    term: "Basis point",
    body: "One hundredth of a percentage point. A 25bp rate rise is 0.25pp. Used mostly when talking about rates and spreads.",
  },
  {
    term: "Yield curve / term spread",
    body: "The gap between a long-dated and a short-dated government bond yield. Normally positive; when it goes negative the curve is 'inverted', which has preceded every US recession since 1970.",
  },
  {
    term: "MAPE",
    body: "Mean absolute percentage error — the average size of a forecast's mistakes, as a percentage. Lower is better.",
  },
  {
    term: "Skill",
    body: "How much better a forecast is than a naive baseline that assumes nothing changes. Zero skill means the model adds nothing. This site reports it even when it is zero.",
  },
  {
    term: "Revision",
    body: "Statistical agencies update figures after first publication, sometimes for years. This warehouse re-requests a wide trailing window on every run so revisions land rather than being missed.",
  },
];

export default function GuidePage() {
  const [transform, setTransform] = useState<Transform>("level");
  const overview = useOverview();
  const recessions = useRecessions();
  const demo = useObservations("UNRATE", transform, "1995-01-01");

  const sparkDemo = overview.data?.pulse[0]?.spark ?? null;

  return (
    <div className="flex flex-col gap-14">
      {/* ---- hero -------------------------------------------------------- */}
      <header>
        <Eyebrow>Guide</Eyebrow>
        <h1 className="display mt-3 max-w-4xl text-[clamp(2.5rem,7vw,5rem)]">Start here.</h1>
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <p className="max-w-2xl text-[15px] leading-relaxed text-[var(--color-ink-2)]">
            Ledger is a working data warehouse for the US economy. Every weekday
            morning it pulls 45 indicators from the Federal Reserve&apos;s FRED
            database, stores them, recomputes a layer of analysis on top, and
            publishes the result here. Nothing on these pages is calculated when
            you load them — it was all worked out in advance, which is why it
            feels immediate.
          </p>
          <p className="max-w-2xl text-[15px] leading-relaxed text-[var(--color-ink-2)]">
            You do not need an economics background to use it. This page explains
            what each screen answers, how to read every chart type, and what the
            vocabulary means. If you would rather see how it was built, the{" "}
            <Link to="/case-study" className="underline underline-offset-4 hover:no-underline">
              case study
            </Link>{" "}
            covers the engineering.
          </p>
        </div>
      </header>

      {/* ---- what it is -------------------------------------------------- */}
      <section>
        <SectionLabel accent="var(--color-forest)">What you are looking at</SectionLabel>
        <div className="tile-grid grid-cols-1 md:grid-cols-3">
          {[
            {
              n: "01",
              t: "The data",
              b: "45 series hand-picked across growth, inflation, labour, rates, credit, markets and recession dating — roughly 158,000 observations reaching back to 1960. All of it from FRED, maintained by the Federal Reserve Bank of St. Louis.",
            },
            {
              n: "02",
              t: "The pipeline",
              b: "A scheduled job requests only what has changed, re-checks the last 400 days in case figures were revised, and records every run. A second pass rebuilds all the derived numbers — changes, z-scores, signals, correlations, forecasts — inside one transaction.",
            },
            {
              n: "03",
              t: "The dashboard",
              b: "Six screens over the finished tables. Every chart has a crosshair, a table view, and keyboard navigation; every number carries the date it refers to and how stale that makes it.",
            },
          ].map((card) => (
            <article key={card.n} className="bg-[var(--color-panel)] p-6">
              <p className="label-xs text-[var(--color-ink-3)]">{card.n}</p>
              <h3 className="mt-3 text-[17px] font-semibold tracking-[-0.015em]">{card.t}</h3>
              <p className="mt-2.5 text-[13.5px] leading-relaxed text-[var(--color-ink-2)]">
                {card.b}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* ---- navigation -------------------------------------------------- */}
      <section>
        <SectionLabel accent="var(--color-terracotta)">Where to go</SectionLabel>
        <ul className="border-t border-[var(--color-rule)]">
          {SCREENS.map((screen) => (
            <li key={screen.to} className="border-b border-[var(--color-rule)]">
              <Link
                to={screen.to}
                className="group grid gap-x-6 gap-y-2 px-1 py-5 transition-colors hover:bg-[var(--color-panel)] md:grid-cols-[180px_1fr_auto] md:items-baseline"
              >
                <span className="text-[17px] font-semibold tracking-[-0.015em]">
                  {screen.name}
                </span>
                <span>
                  <span className="block text-[14px] font-medium">{screen.question}</span>
                  <span className="mt-1 block max-w-2xl text-[13px] leading-relaxed text-[var(--color-ink-2)]">
                    {screen.detail}
                  </span>
                </span>
                <span
                  aria-hidden
                  className="label-xs text-[var(--color-ink-3)] transition-transform group-hover:translate-x-1"
                >
                  Open →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* ---- reading a chart --------------------------------------------- */}
      <section>
        <SectionLabel accent="var(--color-s1)">Reading a time-series chart</SectionLabel>
        <Panel
          title="The same data, five ways"
          subtitle="This is the real unemployment-rate series and the real Explorer chart. Switch the transform and watch what the question changes to."
          footnote="Hover anywhere for a crosshair reading. Click the chart and use ← → to step through it with the keyboard; Escape clears."
        >
          <div className="mb-4 flex flex-wrap gap-1.5">
            {(Object.keys(TRANSFORM_NOTES) as Transform[]).map((option) => (
              <Chip
                key={option}
                active={transform === option}
                onClick={() => setTransform(option)}
              >
                {TRANSFORM_LABEL[option]}
              </Chip>
            ))}
          </div>

          <div className="mb-5 border-l-4 border-[var(--color-s1)] bg-[var(--color-raised)] p-4">
            <p className="text-[14px] font-medium">{TRANSFORM_NOTES[transform].blurb}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-ink-2)]">
              {TRANSFORM_NOTES[transform].use}
            </p>
          </div>

          {demo.isLoading ? (
            <Skeleton height={320} />
          ) : demo.data ? (
            <TimeSeriesChart
              height={340}
              fill
              zeroLine={transform !== "level" && transform !== "index100"}
              recessions={recessions.data ?? []}
              formatValue={(v) => formatPlotted(v, transform, "percent").replace(/^\+/, "")}
              formatTooltip={(v) => formatPlotted(v, transform, "percent")}
              series={[
                {
                  id: "UNRATE",
                  label: "Unemployment rate",
                  color: "var(--color-s1)",
                  points: demo.data.points.map((p) => ({ date: p.obs_date, value: p.plotted })),
                },
              ]}
              ariaLabel="Demonstration chart of the unemployment rate"
            />
          ) : null}

          <dl className="mt-6 grid gap-x-8 gap-y-4 border-t border-[var(--color-rule)] pt-5 sm:grid-cols-2">
            {[
              [
                "Grey vertical bands",
                "Recessions as dated by the National Bureau of Economic Research — the official arbiter. They are context, not data, so they sit behind everything else.",
              ],
              [
                "The crosshair",
                "Follows your pointer and reads out the nearest actual observation, not an interpolated one. With several series plotted it reads all of them at once.",
              ],
              [
                "Dashed horizontal line",
                "A meaningful reference — zero on a change chart, or a signal's alarm threshold. Drawn heavier than the gridlines so it reads as significance rather than decoration.",
              ],
              [
                "Labels at the line ends",
                "When more than one series is plotted, each line is labelled where it ends as well as in the legend, so you never have to match a colour to tell them apart.",
              ],
            ].map(([term, body]) => (
              <div key={term}>
                <dt className="label-xs text-[var(--color-ink-3)]">{term}</dt>
                <dd className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-ink-2)]">
                  {body}
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      </section>

      {/* ---- the other chart types --------------------------------------- */}
      <section>
        <SectionLabel>The other charts</SectionLabel>
        <div className="tile-grid grid-cols-1 md:grid-cols-2">
          {/* sparkline */}
          <article className="bg-[var(--color-panel)] p-6">
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-[15px] font-semibold">Sparklines</h3>
              <span className="text-[var(--color-ink-2)]">
                <Sparkline points={sparkDemo} width={110} height={34} color="currentColor" />
              </span>
            </div>
            <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--color-ink-2)]">
              The small line beside a number on a tile. It has no axes on purpose —
              it answers &quot;which way has this been going&quot; while the number
              beside it answers &quot;where is it now&quot;. Roughly five years of
              recent history. Do not read levels off it.
            </p>
          </article>

          {/* diverging heatmap */}
          <article className="bg-[var(--color-panel)] p-6">
            <h3 className="text-[15px] font-semibold">The correlation matrix</h3>
            <div className="mt-3 flex items-center gap-2">
              <span className="label-xs text-[var(--color-ink-3)]">−1</span>
              <div className="flex" aria-hidden>
                {[-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1].map((step) => (
                  <span
                    key={step}
                    className="h-4 w-7"
                    style={{
                      background: `color-mix(in oklab, ${
                        step >= 0 ? "var(--color-div-pos)" : "var(--color-div-neg)"
                      } ${(Math.abs(step) ** 0.85 * 100).toFixed(0)}%, var(--color-div-mid))`,
                    }}
                  />
                ))}
              </div>
              <span className="label-xs text-[var(--color-ink-3)]">+1</span>
            </div>
            <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--color-ink-2)]">
              Two colours with a neutral middle, because −1 and +1 are opposites
              rather than two strengths of the same thing. Terracotta means the two
              series rise and fall together; blue means one rises as the other
              falls; the pale middle means no relationship. Everything is computed
              on year-over-year changes — comparing raw levels would mostly measure
              the fact that both series trend upward.
            </p>
          </article>

          {/* lead/lag */}
          <article className="bg-[var(--color-panel)] p-6">
            <h3 className="text-[15px] font-semibold">The lead / lag curve</h3>
            <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--color-ink-2)]">
              One indicator is slid backwards and forwards in time against a target
              series, and the correlation is measured at each shift. The peak tells
              you the timing. <strong className="font-semibold">Left of the
              dashed zero line means the indicator moves first</strong> — it is a
              leading indicator. Right of it means it follows. Jobless claims, for
              example, turn about a month before the unemployment rate.
            </p>
          </article>

          {/* forecast */}
          <article className="bg-[var(--color-panel)] p-6">
            <h3 className="text-[15px] font-semibold">The forecast fan</h3>
            <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--color-ink-2)]">
              Solid line is observed data. The dashed line past the vertical divider
              is model output, and the shaded band around it is an 80% interval that
              widens the further out it goes. Always check the{" "}
              <strong className="font-semibold">skill</strong> figure above the
              chart: it compares the model against simply assuming nothing changes.
              Where skill is near zero, the projection is decoration and the page
              says so.
            </p>
          </article>
        </div>
      </section>

      {/* ---- signals ----------------------------------------------------- */}
      <section>
        <SectionLabel>Reading the signal meters</SectionLabel>
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.2fr]">
          <Panel title="Status is never colour alone">
            <div className="flex flex-wrap items-center gap-3">
              <StatusChip state="normal" />
              <StatusChip state="warning" />
              <StatusChip state="triggered" />
            </div>
            <p className="mt-4 text-[13.5px] leading-relaxed text-[var(--color-ink-2)]">
              Each state carries a shape and a word as well as a colour, so the
              reading survives colour blindness, greyscale printing and forced-colour
              modes.
            </p>
            <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--color-ink-2)]">
              The bar underneath each signal is a meter, not a progress bar. The thin
              vertical tick is the alarm threshold; the filled dot is where the
              reading actually sits. The point is to show <em>how far</em> from the
              threshold something is, not merely which side of it.
            </p>
          </Panel>

          <Panel title="What the five signals mean">
            <dl className="flex flex-col divide-y divide-[var(--color-rule)]">
              {[
                ["10Y−2Y and 10Y−3M curve", "The gap between long and short government bond yields. Below zero the curve is inverted, which has preceded every US recession since 1970 — though sometimes by more than a year."],
                ["Sahm rule", "Fires when the three-month average unemployment rate rises half a point above its lowest reading in the previous year. Historically that has marked the start of a recession rather than predicting one."],
                ["Credit stress", "How harshly the corporate bond market is pricing risk, as a percentile of the past decade. High readings mean lenders have turned cautious."],
                ["Macro heat", "A composite of production, payrolls, retail sales, unemployment, claims, core prices, sentiment and the curve. Positive means the economy is running above its own long-run normal."],
              ].map(([term, body]) => (
                <div key={term} className="py-3 first:pt-0 last:pb-0">
                  <dt className="text-[13.5px] font-semibold">{term}</dt>
                  <dd className="mt-1 text-[13px] leading-relaxed text-[var(--color-ink-2)]">
                    {body}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      </section>

      {/* ---- glossary ---------------------------------------------------- */}
      <section>
        <SectionLabel>Vocabulary</SectionLabel>
        <dl className="grid gap-x-10 gap-y-6 border-t border-[var(--color-rule)] pt-6 md:grid-cols-2 xl:grid-cols-3">
          {GLOSSARY.map((entry) => (
            <div key={entry.term}>
              <dt className="text-[14px] font-semibold">{entry.term}</dt>
              <dd className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-ink-2)]">
                {entry.body}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ---- caveats ----------------------------------------------------- */}
      <section>
        <SectionLabel accent="var(--color-terracotta)">Before you draw conclusions</SectionLabel>
        <div className="tile-grid grid-cols-1 md:grid-cols-3">
          {[
            {
              t: "Correlation is not a mechanism",
              b: "Two series can move together because one drives the other, because both answer to a third thing, or because one enormous shared shock — 2020, say — dominates the window. The matrix describes the past; it does not explain it.",
            },
            {
              t: "Signals have fired without recessions",
              b: "Every rule here has a history of false positives. They are summaries of past regularities, not predictions, and the honest way to use them is to ask how many are leaning the same way at once.",
            },
            {
              t: "This is not investment advice",
              b: "It is a portfolio engineering project built on public data. Figures are revised after publication, and the Pipeline screen will always tell you how old the numbers in front of you are.",
            },
          ].map((card) => (
            <article key={card.t} className="bg-[var(--color-panel)] p-6">
              <h3 className="text-[15px] font-semibold">{card.t}</h3>
              <p className="mt-2.5 text-[13.5px] leading-relaxed text-[var(--color-ink-2)]">
                {card.b}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-rule)] pt-8">
        <p className="max-w-xl text-[14px] leading-relaxed text-[var(--color-ink-2)]">
          That is everything you need. The Overview is the natural place to start.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/"
            className="label-xs bg-[var(--color-ink)] px-4 py-3 text-[var(--color-ground)] transition-opacity hover:opacity-90"
          >
            Go to the dashboard →
          </Link>
          <Link
            to="/case-study"
            className="label-xs border border-[var(--color-rule-strong)] px-4 py-3 text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-panel)]"
          >
            How it was built
          </Link>
        </div>
      </section>
    </div>
  );
}
