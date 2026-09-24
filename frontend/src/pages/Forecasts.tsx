import { useNavigate, useParams } from "react-router-dom";

import { useCatalog, useForecast } from "../lib/api";
import { formatDate, formatValue } from "../lib/format";
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
import ForecastChart from "../components/charts/ForecastChart";
import { DataTable, useViewToggle } from "../components/charts/primitives";

const FORECAST_SERIES = ["UNRATE", "CPIAUCSL", "PAYEMS", "INDPRO", "HOUST", "RSAFS"];

function skillState(skill: number | null): "normal" | "warning" | "triggered" {
  if (skill === null) return "triggered";
  if (skill > 0.15) return "normal";
  if (skill > 0.02) return "warning";
  return "triggered";
}

function skillWording(skill: number | null): string {
  if (skill === null) return "No backtest could be computed.";
  if (skill > 0.15)
    return `Beats a random-walk baseline by ${(skill * 100).toFixed(0)}% on walk-forward error.`;
  if (skill > 0.02)
    return `Marginally better than a random walk (${(skill * 100).toFixed(0)}% error reduction).`;
  return "No better than assuming the last value holds. Shown for honesty, not for decisions.";
}

export default function ForecastsPage() {
  const { seriesId } = useParams();
  const navigate = useNavigate();
  const active = seriesId ?? "UNRATE";

  const forecast = useForecast(active);
  const catalog = useCatalog();
  const toggle = useViewToggle();

  const entry = catalog.data?.series.find((s) => s.series_id === active);
  const unit = entry?.unit_kind ?? "count";
  const scale = entry?.scale ?? 1;
  const meta = forecast.data?.meta;

  return (
    <div className="flex flex-col gap-10">
      <header>
        <Eyebrow>Forecasts</Eyebrow>
        <h1 className="display mt-3 max-w-3xl text-[clamp(2.5rem,6.5vw,4.5rem)]">
          Twelve months out.
        </h1>
        <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-[var(--color-ink-2)]">
          A damped-trend exponential smoothing model, fit on the warehoused history and
          projected a year forward. Every projection ships with the walk-forward backtest
          that earns it — including the ones where the model is no better than assuming
          nothing changes.
        </p>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {FORECAST_SERIES.map((id) => (
          <Chip key={id} active={id === active} onClick={() => navigate(`/forecasts/${id}`)}>
            {id}
          </Chip>
        ))}
      </div>

      {forecast.isLoading ? (
        <Skeleton height={420} label="Loading forecast" />
      ) : forecast.isError ? (
        <ErrorNote
          error={forecast.error}
          hint="Only a handful of series carry a published projection; pick another above."
        />
      ) : forecast.data && meta ? (
        <>
          <section className="tile-grid grid-cols-2 lg:grid-cols-4">
            <div className="bg-[var(--color-panel)] p-5">
              <p className="label-xs text-[var(--color-ink-3)]">Backtest MAPE</p>
              <p className="figure-xl mt-2 text-[1.9rem]">
                {meta.mape === null ? "—" : `${meta.mape.toFixed(2)}%`}
              </p>
              <p className="label-xs mt-1.5 text-[var(--color-ink-3)]">mean absolute % error</p>
            </div>
            <div className="bg-[var(--color-panel)] p-5">
              <p className="label-xs text-[var(--color-ink-3)]">Naive baseline</p>
              <p className="figure-xl mt-2 text-[1.9rem]">
                {meta.naive_mape === null ? "—" : `${meta.naive_mape.toFixed(2)}%`}
              </p>
              <p className="label-xs mt-1.5 text-[var(--color-ink-3)]">last value carried forward</p>
            </div>
            <div className="bg-[var(--color-panel)] p-5">
              <p className="label-xs text-[var(--color-ink-3)]">Skill</p>
              <p className="figure-xl mt-2 text-[1.9rem]">
                {meta.skill === null ? "—" : `${(meta.skill * 100).toFixed(0)}%`}
              </p>
              <p className="label-xs mt-1.5 text-[var(--color-ink-3)]">error reduction vs naive</p>
            </div>
            <div className="bg-[var(--color-panel)] p-5">
              <p className="label-xs text-[var(--color-ink-3)]">Trained on</p>
              <p className="figure-xl mt-2 text-[1.9rem]">
                {new Date(meta.train_start).getFullYear()}–
                {new Date(meta.train_end).getFullYear()}
              </p>
              <p className="label-xs mt-1.5 text-[var(--color-ink-3)]">
                horizon {meta.horizon} months
              </p>
            </div>
          </section>

          <Panel
            title={`${entry?.display_name ?? active} · observed and projected`}
            subtitle={meta.model}
            actions={toggle.control}
            footnote={`Interval is 80%, widened with the square root of the horizon. Model output is not a promise about the future.`}
          >
            {toggle.view === "chart" ? (
              <ForecastChart
                data={forecast.data}
                formatValue={(v) => formatValue(v, unit, { compact: true, scale })}
              />
            ) : (
              <DataTable
                maxHeight={380}
                columns={["Month", "Projected", "Low (80%)", "High (80%)"]}
                rows={forecast.data.forecast.map((point) => [
                  formatDate(point.obs_date),
                  formatValue(point.yhat, unit, { compact: true, scale }),
                  formatValue(point.lower, unit, { compact: true, scale }),
                  formatValue(point.upper, unit, { compact: true, scale }),
                ])}
              />
            )}
          </Panel>

          <section className="flex flex-wrap items-center gap-4 bg-[var(--color-panel)] p-5">
            <StatusChip state={skillState(meta.skill)} />
            <p className="max-w-2xl text-[13.5px] leading-relaxed text-[var(--color-ink-2)]">
              {skillWording(meta.skill)}{" "}
              {meta.skill !== null && meta.skill <= 0.02 && (
                <>
                  For a series this persistent that is the expected result — and a
                  dashboard that hid it would be selling the model rather than reporting
                  on it.
                </>
              )}
            </p>
          </section>
        </>
      ) : (
        <EmptyNote>No forecast published for this series.</EmptyNote>
      )}

      <section>
        <SectionLabel>Method</SectionLabel>
        <div className="tile-grid grid-cols-1 md:grid-cols-3">
          {[
            {
              title: "The model",
              body: "Holt's linear exponential smoothing with a damped trend. It suits smooth, already seasonally-adjusted monthly series and has few enough parameters to be honest about a short history.",
            },
            {
              title: "The backtest",
              body: "Expanding-window walk-forward: fit on data up to a cut-off, predict the next six months, step forward, repeat across eight folds. Errors are pooled, so the reported MAPE is out-of-sample throughout.",
            },
            {
              title: "The baseline",
              body: "Every model is scored against carrying the last observed value forward. Skill is the reduction in error against that baseline; a model that cannot beat it is reported as such rather than dressed up.",
            },
          ].map((card) => (
            <article key={card.title} className="bg-[var(--color-panel)] p-5">
              <h3 className="text-[14px] font-semibold">{card.title}</h3>
              <p className="mt-2.5 text-[13px] leading-relaxed text-[var(--color-ink-2)]">
                {card.body}
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
