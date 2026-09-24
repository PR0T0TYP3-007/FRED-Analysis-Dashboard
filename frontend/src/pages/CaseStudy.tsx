import { Link } from "react-router-dom";

import { useOverview, usePipeline } from "../lib/api";
import { formatDuration } from "../lib/format";
import { Eyebrow, SectionLabel } from "../components/ui";

/* ===========================================================================
   The case study, told on the site itself. The results figures are read live
   from the warehouse rather than typed in, so the page cannot drift out of
   date and quietly start lying about its own system.
   =========================================================================== */

function ArchitectureDiagram() {
  const layers = [
    {
      name: "FRED API",
      detail: "httpx · shared token-bucket limiter · exponential backoff",
      tone: "border",
    },
    {
      name: "core.*",
      detail: "series · observations · ingest_runs · ingest_series_log",
      note: "A faithful mirror of the source. Never written to by the analytics layer.",
      tone: "ink",
    },
    {
      name: "analytics.*",
      detail: "series_metrics · series_snapshot · signals · episodes · correlations · lead_lag · forecasts",
      note: "Everything opinionated. Dropped and rebuilt from scratch on every run, inside one transaction.",
      tone: "terracotta",
    },
    {
      name: "FastAPI",
      detail: "reads only — no computation on the request path",
      tone: "border",
    },
    {
      name: "React + Vite",
      detail: "TanStack Query · custom SVG charts on d3-scale",
      tone: "border",
    },
  ] as const;

  const toneClass: Record<string, string> = {
    border: "bg-[var(--color-panel)] text-[var(--color-ink)]",
    ink: "bg-[var(--color-ink)] text-[var(--color-ground)]",
    terracotta: "bg-[var(--color-terracotta)] text-[#fdf6f2]",
  };

  return (
    <div className="flex flex-col">
      {layers.map((layer, index) => (
        <div key={layer.name}>
          <div className={`p-5 ${toneClass[layer.tone]}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="font-mono text-[15px] font-semibold">{layer.name}</span>
              <span className="label-xs opacity-70">{layer.detail}</span>
            </div>
            {"note" in layer && layer.note && (
              <p className="mt-2.5 max-w-2xl text-[13px] leading-relaxed opacity-80">
                {layer.note}
              </p>
            )}
          </div>
          {index < layers.length - 1 && (
            <div className="flex justify-center py-1.5" aria-hidden>
              <span className="text-[var(--color-ink-3)]">↓</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const DECISIONS = [
  {
    n: "01",
    title: "Two schemas, and the raw one is untouchable",
    body: "core.* mirrors what FRED sent. analytics.* holds every transform, composite and model, and is rebuilt from scratch each run. A bug in a transform can produce a wrong chart, but it can never corrupt source data — recovery is a 25-second job, not a re-download of 158,000 observations.",
    tradeoff: "Costs a full recompute each run. Fine at this volume; the ingest log already records what changed, so incremental recomputation is the obvious next step.",
  },
  {
    n: "02",
    title: "The analytics pass writes tables, not views",
    body: "Every number on screen was computed ahead of time. A page load is a SELECT against a pre-aggregated row, which is why 152,000 derived metric rows feel instant and why the API layer contains no pandas at all.",
    tradeoff: "Data is as fresh as the last run rather than the last second — exactly right for a source that publishes daily at best.",
  },
  {
    n: "03",
    title: "45 curated series, not a search box over 800,000",
    body: "FRED has over 800,000 series. A search box across all of them is easy to build and says nothing. Each of the 45 carries display metadata — unit family, magnitude, natural transform, whether 'up' is good — so the frontend never hardcodes that CPI is read year-over-year. Adding a series is one line.",
    tradeoff: "An editorial position rather than a complete one. That is the point.",
  },
  {
    n: "04",
    title: "Raw SQL over an ORM",
    body: "The queries are the interesting part here — window functions, DISTINCT ON for latest values, COPY for bulk loads. An ORM would hide exactly that and map an application object graph which does not exist in a read-mostly warehouse.",
    tradeoff: "No free migrations. The schema is one idempotent DDL file, applied on init.",
  },
  {
    n: "05",
    title: "A chart kit instead of a chart library",
    body: "The design is Swiss editorial — flat full-bleed tiles, hairline rules, heavy display type. Bending a library into that shape costs more than building on d3-scale and d3-shape, and leaves a recognisable fingerprint on what is meant to be a designed product.",
    tradeoff: "More code to own. In exchange, crosshairs, recession shading, keyboard cursors and direct labels behave identically on all six screens.",
  },
  {
    n: "06",
    title: "A palette that was measured, not chosen",
    body: "Chart colours were run through a colour-vision-deficiency and contrast checker against the real surfaces in both themes. The first candidate failed three checks. The adopted palette passes all of them and keeps the theme's terracotta as a series colour.",
    tradeoff: "Only the first three slots stay separable when any pair can co-occur — so series comparison is capped at three. A product constraint derived from an accessibility measurement, which is the right direction for that to run.",
  },
];

const BUGS = [
  {
    symptom: "Real GDP displayed as “$24.3K”",
    cause:
      "FRED reports GDP in billions of dollars. The formatter treated the stored 24269.6 as literal dollars. I had modelled the unit family — usd, percent, index — but not the magnitude, and they are independent dimensions.",
    fix: "An explicit scale multiplier per series, threaded from the catalog through the schema, the ingest upsert, the API and the formatter. Now renders $24.3T; payrolls render 159.1M.",
  },
  {
    symptom: "CPI headlined its index level, “334.1”",
    cause:
      "Technically correct and completely useless. Nobody thinks about inflation as an index level; they think about the rate.",
    fix: "Series whose natural reading is a rate now lead with the year-over-year figure and carry the index as a caption. Driven by catalog metadata, not hardcoded per series.",
  },
  {
    symptom: "Seven series wrongly flagged as stale",
    cause:
      "The pipeline screen was measuring how old the newest reference period was. A monthly series reporting July data in late September is not stale — that is a publication lag.",
    fix: "Freshness now measures against FRED's own last_updated timestamp, with thresholds by frequency. The stale count correctly reads zero.",
  },
  {
    symptom: "The correlation matrix rendered as vertical stripes",
    cause:
      "Rotated column headers were contributing their unrotated width to layout, inflating every column past the cell size.",
    fix: "Took the labels out of flow with absolute positioning.",
  },
];

const ANALYSIS = [
  [
    "Percentage points, not percent",
    "Unemployment moving 4.0 → 4.4 is +0.4pp. Calling it +10% is true of the ratio and misleading to every reader, so rate-type series carry an absolute change and the interface picks the right one by unit family.",
  ],
  [
    "Year-over-year respects frequency",
    "A quarterly series looks back four observations for a year, a monthly one twelve, a daily one about 252. A fixed row offset would have silently produced wrong numbers for every non-monthly series.",
  ],
  [
    "Correlations run on changes, not levels",
    "Any two trending series correlate at 0.99 because both trend. Everything on the Relationships screen is computed on year-over-year changes, which is what makes the coefficients mean anything.",
  ],
  [
    "Signals are recomputed, not downloaded",
    "FRED publishes a ready-made Sahm rule. I rebuild it from the unemployment rate so the dashboard can show its ingredients and be audited against the official series. It correctly flags August 2024 at 0.53 and the 2008–2010 window.",
  ],
  [
    "Forecast skill is published even when it is bad",
    "Unemployment scores roughly zero skill against a random-walk baseline. The page says so. A dashboard that only showed flattering models would be selling the model rather than reporting on it.",
  ],
];

export default function CaseStudyPage() {
  const overview = useOverview();
  const pipeline = usePipeline();

  const totals = pipeline.data?.totals;
  const lastFull = pipeline.data?.runs.find((run) => run.mode === "full" || run.rows_upserted > 50_000);
  const lastAnalytics = pipeline.data?.analytics_runs[0];

  const stats = [
    {
      label: "Series tracked",
      value: totals ? String(totals.series) : "45",
      note: "across 7 categories",
    },
    {
      label: "Observations",
      value: totals ? totals.observations.toLocaleString() : "—",
      note: overview.data ? `since ${overview.data.coverage.since.slice(0, 4)}` : "",
    },
    {
      label: "Derived rows",
      value: totals ? totals.metric_rows.toLocaleString() : "—",
      note: "rebuilt every run",
    },
    {
      label: "Analytics rebuild",
      value: lastAnalytics ? formatDuration(lastAnalytics.duration_ms) : "—",
      note: "four stages, one transaction",
    },
  ];

  return (
    <div className="flex flex-col gap-14">
      {/* ---- hero -------------------------------------------------------- */}
      <header>
        <Eyebrow>Case study</Eyebrow>
        <h1 className="display mt-3 max-w-4xl text-[clamp(2.25rem,6.5vw,4.75rem)]">
          A warehouse, not a dashboard.
        </h1>
        <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-[var(--color-ink-2)]">
          Ledger pulls 45 US macro indicators from the Federal Reserve&apos;s FRED
          API on a schedule, warehouses them in PostgreSQL, derives a second layer
          of analysis on top, and serves it as an interactive dashboard. The
          interesting part is not the charts — it is that the whole thing is built
          like something that has to keep running.
        </p>

        <dl className="mt-8 flex flex-wrap gap-x-12 gap-y-4 border-t border-[var(--color-rule)] pt-6">
          {[
            ["Role", "Sole engineer — data modelling, pipeline, API, frontend, design"],
            ["Stack", "Python · PostgreSQL · FastAPI · React · TypeScript · d3"],
            ["Scope", "~8,000 lines · 56 tests · six screens"],
          ].map(([term, body]) => (
            <div key={term} className="max-w-xs">
              <dt className="label-xs text-[var(--color-ink-3)]">{term}</dt>
              <dd className="mt-1.5 text-[13.5px] leading-snug">{body}</dd>
            </div>
          ))}
        </dl>
      </header>

      {/* ---- live results ------------------------------------------------ */}
      <section>
        <SectionLabel accent="var(--color-forest)">
          Where it stands right now
        </SectionLabel>
        <div className="tile-grid grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, index) => (
            <div
              key={stat.label}
              className={`p-5 ${
                index === 0
                  ? "bg-[var(--color-ink)] text-[var(--color-ground)]"
                  : "bg-[var(--color-panel)]"
              }`}
            >
              <p
                className={`label-xs ${
                  index === 0 ? "text-[var(--color-ground)]/60" : "text-[var(--color-ink-3)]"
                }`}
              >
                {stat.label}
              </p>
              <p className="figure-xl mt-3 text-[clamp(1.5rem,3vw,2.1rem)]">{stat.value}</p>
              <p
                className={`label-xs mt-2 ${
                  index === 0 ? "text-[var(--color-ground)]/60" : "text-[var(--color-ink-3)]"
                }`}
              >
                {stat.note}
              </p>
            </div>
          ))}
        </div>
        <p className="label-xs mt-3 text-[var(--color-ink-3)]">
          These four figures are read live from the warehouse, not typed into this
          page{lastFull ? ` · last full load: ${lastFull.api_calls} API calls in ${formatDuration(lastFull.duration_ms)}` : ""}
        </p>
      </section>

      {/* ---- problem ----------------------------------------------------- */}
      <section className="grid gap-8 lg:grid-cols-[1fr_1fr]">
        <div>
          <SectionLabel>The problem</SectionLabel>
          <p className="text-[15px] leading-relaxed text-[var(--color-ink-2)]">
            Most public data dashboards fail in one of two ways. Either they are a
            notebook with a chart pasted at the end — no scheduling, no state,
            nothing that survives closing the laptop — or they are a thin proxy
            over someone else&apos;s API, where every page load is a network round
            trip and there is no analysis, only display.
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-[var(--color-ink-2)]">
            I wanted the third thing: a small but complete data platform, where the
            data is genuinely mine once it lands, the analysis happens in a pipeline
            rather than a request handler, and the interface is designed rather than
            assembled from a chart library&apos;s defaults.
          </p>
        </div>
        <div>
          <SectionLabel>Why FRED</SectionLabel>
          <p className="text-[15px] leading-relaxed text-[var(--color-ink-2)]">
            It is real, it is free, and it is messy in instructive ways — revisions
            that land months after publication, publication lags that look like
            staleness, mixed frequencies from daily to quarterly, and mixed
            magnitudes where one series is in billions and its neighbour is in
            thousands.
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-[var(--color-ink-2)]">
            Each of those is a trap that produces a plausible-looking wrong number
            rather than an error. Handling them is most of the actual work, and it
            is invisible in the finished product unless you know to look.
          </p>
        </div>
      </section>

      {/* ---- architecture ------------------------------------------------ */}
      <section>
        <SectionLabel accent="var(--color-s1)">Architecture</SectionLabel>
        <ArchitectureDiagram />
      </section>

      {/* ---- decisions --------------------------------------------------- */}
      <section>
        <SectionLabel>Decisions worth defending</SectionLabel>
        <div className="border-t border-[var(--color-rule)]">
          {DECISIONS.map((decision) => (
            <article
              key={decision.n}
              className="grid gap-x-8 gap-y-3 border-b border-[var(--color-rule)] py-6 md:grid-cols-[60px_1fr]"
            >
              <p className="label-xs pt-1 text-[var(--color-ink-3)]">{decision.n}</p>
              <div>
                <h3 className="text-[17px] font-semibold tracking-[-0.015em]">
                  {decision.title}
                </h3>
                <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-[var(--color-ink-2)]">
                  {decision.body}
                </p>
                <p className="mt-3 max-w-3xl border-l-2 border-[var(--color-rule-strong)] pl-4 text-[13px] leading-relaxed text-[var(--color-ink-3)]">
                  <span className="label-xs mr-2">Trade-off</span>
                  {decision.tradeoff}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ---- bugs -------------------------------------------------------- */}
      <section>
        <SectionLabel accent="var(--color-terracotta)">
          Four bugs I only found by looking
        </SectionLabel>
        <p className="mb-6 max-w-3xl text-[15px] leading-relaxed text-[var(--color-ink-2)]">
          Every one of these passed type-checking, passed the test suite, and
          rendered without a single console error. I found them by screenshotting
          the running application and reading the numbers the way a domain reader
          would.
        </p>
        <div className="tile-grid grid-cols-1 lg:grid-cols-2">
          {BUGS.map((bug) => (
            <article key={bug.symptom} className="flex flex-col gap-3 bg-[var(--color-panel)] p-6">
              <h3 className="text-[15px] font-semibold">{bug.symptom}</h3>
              <div>
                <p className="label-xs text-[var(--color-terracotta)]">Cause</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-ink-2)]">
                  {bug.cause}
                </p>
              </div>
              <div>
                <p className="label-xs text-[var(--color-forest)]">Fix</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-ink-2)]">
                  {bug.fix}
                </p>
              </div>
            </article>
          ))}
        </div>
        <div className="mt-6 border-l-4 border-[var(--color-ink)] bg-[var(--color-panel)] p-6">
          <p className="max-w-3xl text-[14.5px] leading-relaxed">
            <strong className="font-semibold">The lesson is not &quot;write more
            tests.&quot;</strong>{" "}
            <span className="text-[var(--color-ink-2)]">
              Three of these four were semantic errors — the code did exactly what it
              was told, and what it was told was wrong. Additional unit tests would
              have encoded the same misunderstanding. They needed someone to look at
              the rendered artefact and ask whether the number meant anything.
            </span>
          </p>
        </div>
      </section>

      {/* ---- analysis choices -------------------------------------------- */}
      <section>
        <SectionLabel>Analysis choices</SectionLabel>
        <p className="mb-6 max-w-3xl text-[15px] leading-relaxed text-[var(--color-ink-2)]">
          The numeric decisions were where domain knowledge mattered more than
          engineering. These are the difference between a dashboard that looks
          right and one that is right.
        </p>
        <dl className="grid gap-x-10 gap-y-7 md:grid-cols-2">
          {ANALYSIS.map(([term, body]) => (
            <div key={term}>
              <dt className="text-[14.5px] font-semibold">{term}</dt>
              <dd className="mt-2 text-[13.5px] leading-relaxed text-[var(--color-ink-2)]">
                {body}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ---- next -------------------------------------------------------- */}
      <section>
        <SectionLabel>What I would do next</SectionLabel>
        <div className="tile-grid grid-cols-1 md:grid-cols-3">
          {[
            {
              t: "Vintage data",
              b: "FRED exposes realtime_start and realtime_end, which I store but do not yet use. Full vintages would let the dashboard answer “what did we think GDP was in March?” — the question that separates a real macro tool from a chart viewer, and the only honest way to backtest a forecast.",
            },
            {
              t: "Incremental analytics",
              b: "Twenty-five seconds for a full rebuild is fine here and would not be at ten times the size. The ingest log already records which series actually changed, so keying recomputation off it is a contained change.",
            },
            {
              t: "A real job runner",
              b: "In-process APScheduler is right for a single-node portfolio deployment and wrong for anything with an SLA. The refresh job is already a pure function of the database, so moving it behind a queue is containment, not a rewrite.",
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
          The dashboard itself is the best argument. Everything described here is
          running behind it right now.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/"
            className="label-xs bg-[var(--color-ink)] px-4 py-3 text-[var(--color-ground)] transition-opacity hover:opacity-90"
          >
            See the dashboard →
          </Link>
          <Link
            to="/guide"
            className="label-xs border border-[var(--color-rule-strong)] px-4 py-3 text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-panel)]"
          >
            How to read it
          </Link>
        </div>
      </section>
    </div>
  );
}
