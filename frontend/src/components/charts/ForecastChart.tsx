import { useMemo, useState } from "react";
import { extent } from "d3-array";
import { scaleLinear, scaleTime } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";

import { AxisBottom, AxisLeft, ChartTooltip, DEFAULT_MARGIN, Legend, useMeasure, usePointer } from "./primitives";
import { parseDate } from "../../lib/format";
import type { ForecastResponse } from "../../lib/types";

/** History and projection on one continuous axis, with the uncertainty band
 *  drawn first so the point forecast never reads as a promise. The band is the
 *  80% interval; the dashed stroke marks where measurement stops and the model
 *  starts. */
export default function ForecastChart({
  data,
  formatValue,
  height = 320,
}: {
  data: ForecastResponse;
  formatValue: (value: number) => string;
  height?: number;
}) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const margin = DEFAULT_MARGIN;
  const innerWidth = Math.max(0, width - margin.left - margin.right);
  const innerHeight = Math.max(0, height - margin.top - margin.bottom);
  const pointer = usePointer(innerWidth, margin);

  const [showBand, setShowBand] = useState(true);

  const model = useMemo(() => {
    const actuals = data.actuals.map((p) => ({ t: parseDate(p.obs_date.slice(0, 10)), v: p.value }));
    const forecast = data.forecast.map((p) => ({
      t: parseDate(p.obs_date.slice(0, 10)),
      v: p.yhat,
      lo: p.lower,
      hi: p.upper,
    }));
    // Join the projection to the last actual so the line has no visual break.
    const bridge = actuals.length
      ? [{ ...actuals[actuals.length - 1], lo: actuals[actuals.length - 1].v, hi: actuals[actuals.length - 1].v }]
      : [];
    return { actuals, forecast, joined: [...bridge, ...forecast] };
  }, [data]);

  const scales = useMemo(() => {
    const times = [...model.actuals, ...model.forecast].map((d) => d.t);
    const values = [
      ...model.actuals.map((d) => d.v),
      ...model.forecast.flatMap((d) => [d.lo, d.hi]),
    ];
    const [t0, t1] = extent(times) as [Date, Date];
    const [v0, v1] = extent(values) as [number, number];
    const pad = (v1 - v0 || Math.abs(v1) || 1) * 0.1;

    const x = scaleTime().domain([t0 ?? new Date(), t1 ?? new Date()]).range([0, innerWidth]);
    const y = scaleLinear().domain([v0 - pad, v1 + pad]).nice(5).range([innerHeight, 0]);
    return { x, y };
  }, [model, innerWidth, innerHeight]);

  const shapes = useMemo(() => {
    const lineGen = line<{ t: Date; v: number }>()
      .x((d) => scales.x(d.t))
      .y((d) => scales.y(d.v))
      .curve(curveMonotoneX);
    const bandGen = area<{ t: Date; lo: number; hi: number }>()
      .x((d) => scales.x(d.t))
      .y0((d) => scales.y(d.lo))
      .y1((d) => scales.y(d.hi))
      .curve(curveMonotoneX);

    return {
      actual: lineGen(model.actuals) ?? "",
      projected: lineGen(model.joined) ?? "",
      band: bandGen(model.joined) ?? "",
    };
  }, [model, scales]);

  const readout = useMemo(() => {
    if (pointer.x === null) return null;
    const target = scales.x.invert(pointer.x);
    const all = [
      ...model.actuals.map((d) => ({ ...d, kind: "actual" as const })),
      ...model.forecast.map((d) => ({ ...d, kind: "forecast" as const })),
    ];
    if (!all.length) return null;
    const nearest = all.reduce((best, current) =>
      Math.abs(current.t.getTime() - target.getTime()) < Math.abs(best.t.getTime() - target.getTime())
        ? current
        : best,
    );
    return nearest;
  }, [pointer.x, scales, model]);

  const cutoff = model.actuals.length ? scales.x(model.actuals[model.actuals.length - 1].t) : 0;

  return (
    <div ref={ref} className="relative w-full">
      {width > 0 && model.actuals.length > 0 && (
        <>
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`Forecast for ${data.series_id} with an 80 percent interval`}
            onPointerMove={pointer.onMove}
            onPointerLeave={pointer.onLeave}
            className="touch-none"
          >
            <g transform={`translate(${margin.left}, ${margin.top})`}>
              <AxisLeft
                ticks={scales.y.ticks(5).map((t) => ({ y: scales.y(t), label: formatValue(t) }))}
                width={innerWidth}
              />
              <AxisBottom
                ticks={scales.x.ticks(6).map((t) => ({
                  x: scales.x(t),
                  label: t.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
                }))}
                height={innerHeight}
              />

              {/* Everything right of this line is model output, not data. */}
              <rect
                x={cutoff}
                y={0}
                width={Math.max(0, innerWidth - cutoff)}
                height={innerHeight}
                fill="var(--color-ink)"
                opacity={0.035}
              />
              <line
                x1={cutoff}
                x2={cutoff}
                y1={0}
                y2={innerHeight}
                stroke="var(--color-ink-3)"
                strokeWidth={1.5}
                strokeDasharray="3 3"
              />

              {showBand && <path d={shapes.band} fill="var(--color-s2)" opacity={0.16} />}
              <path
                d={shapes.projected}
                fill="none"
                stroke="var(--color-s2)"
                strokeWidth={2}
                strokeDasharray="5 4"
                strokeLinecap="round"
              />
              <path
                d={shapes.actual}
                fill="none"
                stroke="var(--color-s1)"
                strokeWidth={2}
                strokeLinecap="round"
              />

              {pointer.x !== null && readout && (
                <>
                  <line
                    x1={scales.x(readout.t)}
                    x2={scales.x(readout.t)}
                    y1={0}
                    y2={innerHeight}
                    stroke="var(--color-ink)"
                    opacity={0.45}
                    shapeRendering="crispEdges"
                  />
                  <circle
                    cx={scales.x(readout.t)}
                    cy={scales.y(readout.v)}
                    r={4.5}
                    fill={readout.kind === "actual" ? "var(--color-s1)" : "var(--color-s2)"}
                    stroke="var(--color-panel)"
                    strokeWidth={2}
                  />
                </>
              )}
            </g>
          </svg>

          {pointer.x !== null && readout && (
            <ChartTooltip
              x={scales.x(readout.t) + margin.left}
              containerWidth={width}
              title={readout.t.toLocaleDateString("en-US", { month: "short", year: "numeric" })}
              rows={
                readout.kind === "actual"
                  ? [{ label: "Observed", value: formatValue(readout.v), color: "var(--color-s1)" }]
                  : [
                      { label: "Projected", value: formatValue(readout.v), color: "var(--color-s2)" },
                      {
                        label: "80% range",
                        value: `${formatValue((readout as { lo: number }).lo)} – ${formatValue(
                          (readout as { hi: number }).hi,
                        )}`,
                      },
                    ]
              }
              footer={readout.kind === "forecast" ? "Model output, not observed data" : undefined}
            />
          )}
        </>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <Legend
          items={[
            { label: "Observed", color: "var(--color-s1)" },
            { label: "Projected", color: "var(--color-s2)", note: "80% interval" },
          ]}
        />
        <button
          type="button"
          onClick={() => setShowBand((v) => !v)}
          aria-pressed={showBand}
          className="label-xs border border-[var(--color-rule-strong)] px-2.5 py-1.5 text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-raised)]"
        >
          {showBand ? "Hide" : "Show"} interval
        </button>
      </div>
    </div>
  );
}
