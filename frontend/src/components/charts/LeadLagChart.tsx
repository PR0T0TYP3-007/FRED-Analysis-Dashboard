import { useMemo, useState } from "react";
import { scaleLinear } from "d3-scale";
import { curveMonotoneX, line } from "d3-shape";

import { AxisBottom, AxisLeft, DEFAULT_MARGIN, useMeasure } from "./primitives";

/** Cross-correlation profile: how the relationship changes as one series is
 *  shifted in time against the other. The peak's position is the answer --
 *  left of zero means the indicator moves first. */
export default function LeadLagChart({
  curve,
  bestLag,
  label,
  color,
  height = 220,
}: {
  curve: { lag: number; corr: number }[];
  bestLag: number;
  label: string;
  color: string;
  height?: number;
}) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const margin = { ...DEFAULT_MARGIN, right: 24, bottom: 42 };
  const innerWidth = Math.max(0, width - margin.left - margin.right);
  const innerHeight = Math.max(0, height - margin.top - margin.bottom);
  const [hover, setHover] = useState<number | null>(null);

  const { xScale, yScale, path, yTicks, xTicks, peak } = useMemo(() => {
    const sorted = [...curve].sort((a, b) => a.lag - b.lag);
    const lags = sorted.map((d) => d.lag);
    const x = scaleLinear()
      .domain([Math.min(...lags, -1), Math.max(...lags, 1)])
      .range([0, innerWidth]);
    const y = scaleLinear().domain([-1, 1]).range([innerHeight, 0]);

    const gen = line<{ lag: number; corr: number }>()
      .x((d) => x(d.lag))
      .y((d) => y(d.corr))
      .curve(curveMonotoneX);

    return {
      xScale: x,
      yScale: y,
      path: gen(sorted) ?? "",
      yTicks: [-1, -0.5, 0, 0.5, 1].map((t) => ({ y: y(t), label: t.toFixed(1) })),
      xTicks: x.ticks(7).filter(Number.isInteger).map((t) => ({ x: x(t), label: String(t) })),
      peak: sorted.find((d) => d.lag === bestLag) ?? null,
    };
  }, [curve, innerWidth, innerHeight, bestLag]);

  const hovered = hover !== null ? curve.find((d) => d.lag === hover) : null;

  return (
    <div ref={ref} className="relative w-full">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Cross-correlation of ${label} against the target across lags`}>
          <g transform={`translate(${margin.left}, ${margin.top})`}>
            <AxisLeft ticks={yTicks} width={innerWidth} />
            <AxisBottom ticks={xTicks} height={innerHeight} />

            {/* Zero-lag divider: left of it the indicator leads. */}
            <line
              x1={xScale(0)}
              x2={xScale(0)}
              y1={0}
              y2={innerHeight}
              stroke="var(--color-ink-3)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
            <line
              x1={0}
              x2={innerWidth}
              y1={yScale(0)}
              y2={yScale(0)}
              stroke="var(--color-rule-strong)"
              shapeRendering="crispEdges"
            />

            <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />

            {peak && (
              <g transform={`translate(${xScale(peak.lag)}, ${yScale(peak.corr)})`}>
                <circle r={5} fill={color} stroke="var(--color-panel)" strokeWidth={2} />
                {/* Place the label on whichever side has room: keying off the
                    sign alone drops it onto the axis when the peak is negative. */}
                <text
                  y={yScale(peak.corr) > innerHeight / 2 ? -14 : 22}
                  textAnchor="middle"
                  className="label-xs"
                  fill="var(--color-ink)"
                  stroke="var(--color-panel)"
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {peak.corr.toFixed(2)} @ {peak.lag > 0 ? `+${peak.lag}` : peak.lag}m
                </text>
              </g>
            )}

            {/* Invisible hit targets, wider than the marks themselves. */}
            {curve.map((d) => (
              <rect
                key={d.lag}
                x={xScale(d.lag) - Math.max(6, innerWidth / curve.length / 2)}
                y={0}
                width={Math.max(12, innerWidth / curve.length)}
                height={innerHeight}
                fill="transparent"
                onMouseEnter={() => setHover(d.lag)}
                onMouseLeave={() => setHover(null)}
              />
            ))}

            {hovered && (
              <circle
                cx={xScale(hovered.lag)}
                cy={yScale(hovered.corr)}
                r={4}
                fill="var(--color-ink)"
                stroke="var(--color-panel)"
                strokeWidth={2}
              />
            )}

            <text
              x={xScale(0) - 8}
              y={innerHeight + 34}
              textAnchor="end"
              className="label-xs"
              fill="var(--color-ink-3)"
            >
              ← leads
            </text>
            <text
              x={xScale(0) + 8}
              y={innerHeight + 34}
              className="label-xs"
              fill="var(--color-ink-3)"
            >
              lags →
            </text>
          </g>
        </svg>
      )}
      <p className="tnum mt-1 min-h-[18px] text-[12px] text-[var(--color-ink-2)]" role="status" aria-live="polite">
        {hovered
          ? `Shift ${hovered.lag}m · r = ${hovered.corr.toFixed(3)}`
          : `Strongest at ${bestLag > 0 ? `+${bestLag}` : bestLag} months`}
      </p>
    </div>
  );
}
