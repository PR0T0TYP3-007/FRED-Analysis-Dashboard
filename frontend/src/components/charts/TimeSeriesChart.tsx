import { useCallback, useMemo, useState } from "react";
import { extent, bisector } from "d3-array";
import { scaleLinear, scaleTime } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";

import {
  AxisBottom,
  AxisLeft,
  ChartTooltip,
  DEFAULT_MARGIN,
  EndLabel,
  Legend,
  RecessionBands,
  ReferenceLine,
  useKeyboardCursor,
  useMeasure,
  usePointer,
} from "./primitives";
import { parseDate } from "../../lib/format";

export interface SeriesInput {
  id: string;
  label: string;
  color: string;
  points: { date: string; value: number | null }[];
  /** Drawn as a dashed line -- used for moving averages and projections. */
  dashed?: boolean;
}

interface Props {
  series: SeriesInput[];
  height?: number;
  formatValue: (value: number) => string;
  formatTooltip?: (value: number) => string;
  recessions?: { start_date: string; end_date: string | null }[];
  /** Draw a filled area under a single series. Suppressed for comparisons. */
  fill?: boolean;
  zeroLine?: boolean;
  threshold?: { value: number; label: string; color?: string };
  /** Pin the domain to include zero even when the data never reaches it. */
  includeZero?: boolean;
  ariaLabel?: string;
}

const bisectDate = bisector<{ t: Date; v: number | null }, Date>((d) => d.t).left;

export default function TimeSeriesChart({
  series,
  height = 320,
  formatValue,
  formatTooltip,
  recessions = [],
  fill = false,
  zeroLine = false,
  threshold,
  includeZero = false,
  ariaLabel,
}: Props) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const margin = DEFAULT_MARGIN;
  const innerWidth = Math.max(0, width - margin.left - margin.right);
  const innerHeight = Math.max(0, height - margin.top - margin.bottom);

  const prepared = useMemo(
    () =>
      series.map((s) => ({
        ...s,
        data: s.points
          .filter((p) => p.value !== null && Number.isFinite(p.value))
          .map((p) => ({ t: parseDate(p.date.slice(0, 10)), v: p.value })),
      })),
    [series],
  );

  const allPoints = useMemo(() => prepared.flatMap((s) => s.data), [prepared]);

  const { xScale, yScale, yTicks, xTicks } = useMemo(() => {
    const [minDate, maxDate] = extent(allPoints, (d) => d.t) as [Date, Date];
    const values = allPoints.map((d) => d.v as number);
    let [minValue, maxValue] = extent(values) as [number, number];

    if (minValue === undefined || maxValue === undefined) {
      minValue = 0;
      maxValue = 1;
    }
    if (includeZero || zeroLine) {
      minValue = Math.min(minValue, 0);
      maxValue = Math.max(maxValue, 0);
    }
    if (threshold) {
      minValue = Math.min(minValue, threshold.value);
      maxValue = Math.max(maxValue, threshold.value);
    }
    const pad = (maxValue - minValue || Math.abs(maxValue) || 1) * 0.08;

    const x = scaleTime()
      .domain([minDate ?? new Date(), maxDate ?? new Date()])
      .range([0, innerWidth]);
    const y = scaleLinear()
      .domain([minValue - pad, maxValue + pad])
      .nice(5)
      .range([innerHeight, 0]);

    return {
      xScale: x,
      yScale: y,
      yTicks: y.ticks(5),
      xTicks: x.ticks(Math.max(2, Math.min(7, Math.floor(innerWidth / 110)))).map((tick) => ({
        x: x(tick),
        label:
          x.domain()[1].getTime() - x.domain()[0].getTime() < 1000 * 60 * 60 * 24 * 900
            ? tick.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
            : String(tick.getFullYear()),
      })),
    };
  }, [allPoints, innerWidth, innerHeight, includeZero, zeroLine, threshold]);

  const pointer = usePointer(innerWidth, margin);
  const [keyIndex, setKeyIndex] = useState<number | null>(null);
  const primary = prepared[0];
  const cursor = useKeyboardCursor(primary?.data.length ?? 0, setKeyIndex);

  const activeX = useMemo(() => {
    if (keyIndex !== null && primary?.data[keyIndex]) {
      return xScale(primary.data[keyIndex].t);
    }
    return pointer.x;
  }, [keyIndex, pointer.x, primary, xScale]);

  const readout = useMemo(() => {
    if (activeX === null || !allPoints.length) return null;
    const target = xScale.invert(activeX);
    const rows = prepared
      .map((s) => {
        if (!s.data.length) return null;
        const index = Math.min(bisectDate(s.data, target), s.data.length - 1);
        const candidates = [s.data[index - 1], s.data[index]].filter(Boolean);
        const nearest = candidates.reduce((best, current) =>
          Math.abs(current.t.getTime() - target.getTime()) <
          Math.abs(best.t.getTime() - target.getTime())
            ? current
            : best,
        );
        return { series: s, point: nearest };
      })
      .filter((row): row is { series: (typeof prepared)[number]; point: { t: Date; v: number | null } } =>
        Boolean(row),
      );
    if (!rows.length) return null;
    return { date: rows[0].point.t, rows };
  }, [activeX, allPoints.length, prepared, xScale]);

  const bands = useMemo(() => {
    if (!recessions.length || !innerWidth) return [];
    const [domainStart, domainEnd] = xScale.domain();
    return recessions
      .map((r) => {
        const start = parseDate(r.start_date.slice(0, 10));
        const end = r.end_date ? parseDate(r.end_date.slice(0, 10)) : domainEnd;
        if (end < domainStart || start > domainEnd) return null;
        const x0 = xScale(start < domainStart ? domainStart : start);
        const x1 = xScale(end > domainEnd ? domainEnd : end);
        return { x: x0, width: x1 - x0 };
      })
      .filter((b): b is { x: number; width: number } => b !== null);
  }, [recessions, xScale, innerWidth]);

  const lineGen = useMemo(
    () =>
      line<{ t: Date; v: number | null }>()
        .x((d) => xScale(d.t))
        .y((d) => yScale(d.v as number))
        .defined((d) => d.v !== null)
        .curve(curveMonotoneX),
    [xScale, yScale],
  );

  const areaGen = useMemo(
    () =>
      area<{ t: Date; v: number | null }>()
        .x((d) => xScale(d.t))
        .y0(() => yScale(yScale.domain()[0]))
        .y1((d) => yScale(d.v as number))
        .defined((d) => d.v !== null)
        .curve(curveMonotoneX),
    [xScale, yScale],
  );

  const handleLeave = useCallback(() => {
    pointer.clear();
    cursor.setIndex(null);
  }, [pointer, cursor]);

  const showFill = fill && prepared.length === 1;

  return (
    <div ref={ref} className="relative w-full">
      {width > 0 && allPoints.length > 0 && (
        <>
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={ariaLabel ?? `Time series chart of ${series.map((s) => s.label).join(", ")}`}
            onPointerMove={pointer.onMove}
            onPointerLeave={handleLeave}
            onKeyDown={cursor.onKeyDown}
            tabIndex={0}
            className="touch-none focus-visible:outline-2 focus-visible:outline-[var(--color-ink)]"
          >
            <defs>
              {prepared.map((s) => (
                <linearGradient key={s.id} id={`fill-${s.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>

            <g transform={`translate(${margin.left}, ${margin.top})`}>
              <RecessionBands bands={bands} height={innerHeight} />
              <AxisLeft
                ticks={yTicks.map((tick) => ({ y: yScale(tick), label: formatValue(tick) }))}
                width={innerWidth}
              />
              <AxisBottom ticks={xTicks} height={innerHeight} />

              {zeroLine && yScale.domain()[0] <= 0 && yScale.domain()[1] >= 0 && (
                <ReferenceLine y={yScale(0)} width={innerWidth} />
              )}
              {threshold && (
                <ReferenceLine
                  y={yScale(threshold.value)}
                  width={innerWidth}
                  label={threshold.label}
                  dashed
                  color={threshold.color ?? "var(--color-serious)"}
                />
              )}

              {showFill &&
                prepared.map((s) => (
                  <path key={`area-${s.id}`} d={areaGen(s.data) ?? ""} fill={`url(#fill-${s.id})`} />
                ))}

              {prepared.map((s) => (
                <path
                  key={`line-${s.id}`}
                  d={lineGen(s.data) ?? ""}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={s.dashed ? "5 4" : undefined}
                />
              ))}

              {/* Direct end-of-line labels: identity without relying on colour. */}
              {prepared.length > 1 &&
                prepared.map((s) => {
                  const last = s.data[s.data.length - 1];
                  if (!last) return null;
                  return (
                    <EndLabel
                      key={`end-${s.id}`}
                      x={xScale(last.t)}
                      y={yScale(last.v as number)}
                      text={s.id}
                      color={s.color}
                    />
                  );
                })}

              {activeX !== null && readout && (
                <g>
                  <line
                    x1={activeX}
                    x2={activeX}
                    y1={0}
                    y2={innerHeight}
                    stroke="var(--color-ink)"
                    strokeWidth={1}
                    opacity={0.45}
                    shapeRendering="crispEdges"
                  />
                  {readout.rows.map((row) =>
                    row.point.v === null ? null : (
                      <circle
                        key={row.series.id}
                        cx={xScale(row.point.t)}
                        cy={yScale(row.point.v)}
                        r={4.5}
                        fill={row.series.color}
                        stroke="var(--color-panel)"
                        strokeWidth={2}
                      />
                    ),
                  )}
                </g>
              )}
            </g>
          </svg>

          {activeX !== null && readout && (
            <ChartTooltip
              x={activeX + margin.left}
              containerWidth={width}
              title={readout.date.toLocaleDateString("en-US", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
              rows={readout.rows.map((row) => ({
                label: row.series.label,
                color: prepared.length > 1 ? row.series.color : undefined,
                value:
                  row.point.v === null
                    ? "—"
                    : (formatTooltip ?? formatValue)(row.point.v),
              }))}
            />
          )}
        </>
      )}

      {prepared.length > 1 && (
        <Legend
          className="mt-3"
          items={prepared.map((s) => ({ label: `${s.id} · ${s.label}`, color: s.color }))}
        />
      )}
      {bands.length > 0 && (
        <p className="label-xs mt-2 flex items-center gap-2 text-[var(--color-ink-3)]">
          <span
            aria-hidden
            className="inline-block h-3 w-4 bg-[var(--color-ink)] opacity-[0.07]"
          />
          NBER recessions
        </p>
      )}
    </div>
  );
}
