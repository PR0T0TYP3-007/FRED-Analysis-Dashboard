import { useMemo, useState } from "react";
import { scaleLinear, scalePoint } from "d3-scale";
import { curveMonotoneX, line } from "d3-shape";

import { AxisBottom, AxisLeft, DEFAULT_MARGIN, Legend, useMeasure } from "./primitives";
import type { CurveResponse } from "../../lib/types";

/** The Treasury curve today against the same curve a year ago. Two lines on one
 *  shared yield axis -- the same unit, so one axis is correct and a second
 *  scale would be a lie. */
export default function YieldCurveChart({
  data,
  height = 260,
}: {
  data: CurveResponse;
  height?: number;
}) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const margin = { ...DEFAULT_MARGIN, right: 28 };
  const innerWidth = Math.max(0, width - margin.left - margin.right);
  const innerHeight = Math.max(0, height - margin.top - margin.bottom);
  const [hover, setHover] = useState<string | null>(null);

  const series = useMemo(
    () => [
      { key: "current" as const, label: "Today", color: "var(--color-s1)", dashed: false },
      { key: "year_ago" as const, label: "One year ago", color: "var(--color-s2)", dashed: true },
    ],
    [],
  );

  const { xScale, yScale, paths, yTicks, xTicks } = useMemo(() => {
    const x = scalePoint<string>()
      .domain(data.points.map((p) => p.label))
      .range([0, innerWidth])
      .padding(0.5);

    const values = data.points.flatMap((p) =>
      [p.current, p.year_ago].filter((v): v is number => v !== null),
    );
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 1);
    const pad = (max - min || 1) * 0.15;
    const y = scaleLinear().domain([min - pad, max + pad]).nice(4).range([innerHeight, 0]);

    const gen = line<{ label: string; value: number }>()
      .x((d) => x(d.label) ?? 0)
      .y((d) => y(d.value))
      .curve(curveMonotoneX);

    const built = series.map((s) => ({
      ...s,
      d:
        gen(
          data.points
            .filter((p) => p[s.key] !== null)
            .map((p) => ({ label: p.label, value: p[s.key] as number })),
        ) ?? "",
    }));

    return {
      xScale: x,
      yScale: y,
      paths: built,
      yTicks: y.ticks(4).map((t) => ({ y: y(t), label: `${t.toFixed(1)}%` })),
      xTicks: data.points.map((p) => ({ x: x(p.label) ?? 0, label: p.label })),
    };
  }, [data.points, innerWidth, innerHeight, series]);

  const hovered = data.points.find((p) => p.label === hover);

  return (
    <div ref={ref} className="relative w-full">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="US Treasury yield curve, today versus one year ago">
          <g transform={`translate(${margin.left}, ${margin.top})`}>
            <AxisLeft ticks={yTicks} width={innerWidth} />
            <AxisBottom ticks={xTicks} height={innerHeight} />

            {paths.map((p) => (
              <path
                key={p.key}
                d={p.d}
                fill="none"
                stroke={p.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeDasharray={p.dashed ? "5 4" : undefined}
              />
            ))}

            {data.points.map((point) =>
              series.map((s) =>
                point[s.key] === null ? null : (
                  <circle
                    key={`${point.label}-${s.key}`}
                    cx={xScale(point.label) ?? 0}
                    cy={yScale(point[s.key] as number)}
                    r={hover === point.label ? 6 : 4.5}
                    fill={s.color}
                    stroke="var(--color-panel)"
                    strokeWidth={2}
                  />
                ),
              ),
            )}

            {data.points.map((point) => (
              <rect
                key={`hit-${point.label}`}
                x={(xScale(point.label) ?? 0) - innerWidth / (data.points.length * 2)}
                y={0}
                width={innerWidth / data.points.length}
                height={innerHeight}
                fill="transparent"
                onMouseEnter={() => setHover(point.label)}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </g>
        </svg>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
        <p className="tnum text-[12px] text-[var(--color-ink-2)]" role="status" aria-live="polite">
          {hovered ? (
            <>
              <span className="font-semibold text-[var(--color-ink)]">{hovered.label}</span> ·{" "}
              {hovered.current?.toFixed(2) ?? "—"}% today ·{" "}
              {hovered.year_ago?.toFixed(2) ?? "—"}% a year ago
            </>
          ) : (
            <span className="text-[var(--color-ink-3)]">Hover a tenor for both readings</span>
          )}
        </p>
      </div>
    </div>
  );
}
