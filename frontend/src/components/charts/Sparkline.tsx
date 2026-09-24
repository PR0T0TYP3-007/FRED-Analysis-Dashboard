import { useMemo } from "react";
import { extent } from "d3-array";
import { scaleLinear } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";

import type { SparkPoint } from "../../lib/types";

/** A trend glyph, not a chart: no axes, no hover, no gridlines. It answers
 *  "which way has this been going" beside a number that answers "where is it". */
export default function Sparkline({
  points,
  width = 120,
  height = 34,
  color = "currentColor",
  fill = true,
  strokeWidth = 1.75,
}: {
  points: SparkPoint[] | null | undefined;
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  strokeWidth?: number;
}) {
  const shape = useMemo(() => {
    const values = (points ?? []).filter(
      (p): p is { d: string; v: number } => p.v !== null && Number.isFinite(p.v),
    );
    if (values.length < 2) return null;

    const [min, max] = extent(values, (p) => p.v) as [number, number];
    const pad = (max - min || Math.abs(max) || 1) * 0.12;
    const x = scaleLinear().domain([0, values.length - 1]).range([1, width - 1]);
    const y = scaleLinear().domain([min - pad, max + pad]).range([height - 2, 2]);

    const lineGen = line<{ v: number }>()
      .x((_, i) => x(i))
      .y((p) => y(p.v))
      .curve(curveMonotoneX);
    const areaGen = area<{ v: number }>()
      .x((_, i) => x(i))
      .y0(height)
      .y1((p) => y(p.v))
      .curve(curveMonotoneX);

    const last = values[values.length - 1];
    return {
      line: lineGen(values) ?? "",
      area: areaGen(values) ?? "",
      lastX: x(values.length - 1),
      lastY: y(last.v),
    };
  }, [points, width, height]);

  if (!shape) {
    return <div style={{ width, height }} aria-hidden />;
  }

  return (
    <svg width={width} height={height} aria-hidden className="overflow-visible">
      {fill && <path d={shape.area} fill={color} opacity={0.12} />}
      <path
        d={shape.line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={shape.lastX} cy={shape.lastY} r={2.25} fill={color} />
    </svg>
  );
}
