import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** Fixed categorical order. Never cycled: a 4th comparison series is refused
 *  upstream rather than repainted, and colour follows the entity, not its rank. */
export const SERIES_COLORS = [
  "var(--color-s1)",
  "var(--color-s2)",
  "var(--color-s3)",
  "var(--color-s4)",
  "var(--color-s5)",
  "var(--color-s6)",
] as const;

/** Comparison is capped here because only the first three slots stay separable
 *  when every pair can appear together. See docs/design-system.md. */
export const MAX_COMPARE = 3;

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_MARGIN: Margin = { top: 16, right: 64, bottom: 28, left: 56 };

/** Width observer so charts fill their column without a layout library. */
export function useMeasure<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      setWidth((prev) => (Math.abs(prev - next) > 0.5 ? next : prev));
    });
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

/** Pointer position within the plot area, for crosshair + tooltip. */
export function usePointer(innerWidth: number, margin: Margin) {
  const [x, setX] = useState<number | null>(null);

  const onMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const local = event.clientX - rect.left - margin.left;
      setX(local < -8 || local > innerWidth + 8 ? null : Math.max(0, Math.min(innerWidth, local)));
    },
    [innerWidth, margin.left],
  );

  const onLeave = useCallback(() => setX(null), []);
  return { x, onMove, onLeave, clear: onLeave };
}

export function AxisLeft({
  ticks,
  width,
  showGrid = true,
}: {
  /** Tick position in pixels plus its already-formatted label. */
  ticks: { y: number; label: string }[];
  width: number;
  showGrid?: boolean;
}) {
  return (
    <g aria-hidden>
      {ticks.map((tick) => (
        <g key={`${tick.y}-${tick.label}`} transform={`translate(0, ${tick.y})`}>
          {showGrid && (
            <line
              x1={0}
              x2={width}
              stroke="var(--color-rule)"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
          )}
          <text
            x={-10}
            dy="0.32em"
            textAnchor="end"
            className="label-xs"
            fill="var(--color-ink-3)"
          >
            {tick.label}
          </text>
        </g>
      ))}
    </g>
  );
}

export function AxisBottom({
  ticks,
  height,
}: {
  ticks: { x: number; label: string }[];
  height: number;
}) {
  return (
    <g transform={`translate(0, ${height})`} aria-hidden>
      <line x1={0} x2="100%" stroke="var(--color-rule-strong)" shapeRendering="crispEdges" />
      {ticks.map((tick) => (
        <text
          key={`${tick.x}-${tick.label}`}
          x={tick.x}
          y={16}
          textAnchor="middle"
          className="label-xs"
          fill="var(--color-ink-3)"
        >
          {tick.label}
        </text>
      ))}
    </g>
  );
}

/** Zero (or threshold) reference, drawn heavier than the grid so it reads as
 *  meaning rather than as another gridline. */
export function ReferenceLine({
  y,
  width,
  label,
  dashed = false,
  color = "var(--color-ink-3)",
}: {
  y: number;
  width: number;
  label?: string;
  dashed?: boolean;
  color?: string;
}) {
  return (
    <g transform={`translate(0, ${y})`}>
      <line
        x1={0}
        x2={width}
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray={dashed ? "4 4" : undefined}
        shapeRendering={dashed ? undefined : "crispEdges"}
      />
      {label && (
        // Inside the plot, with a surface halo: anchoring past the right edge
        // clips the label whenever the margin is narrower than the text.
        <text
          x={width - 6}
          dy="-0.5em"
          textAnchor="end"
          className="label-xs"
          fill={color}
          stroke="var(--color-panel)"
          strokeWidth={3}
          paintOrder="stroke"
        >
          {label}
        </text>
      )}
    </g>
  );
}

/** NBER contraction shading. Recessive by design -- it is context, not data. */
export function RecessionBands({
  bands,
  height,
}: {
  bands: { x: number; width: number }[];
  height: number;
}) {
  if (!bands.length) return null;
  return (
    <g aria-hidden>
      {bands.map((band, index) => (
        <rect
          key={index}
          x={band.x}
          y={0}
          width={Math.max(band.width, 1)}
          height={height}
          fill="var(--color-ink)"
          opacity={0.07}
        />
      ))}
    </g>
  );
}

export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
}

export function ChartTooltip({
  x,
  containerWidth,
  title,
  rows,
  footer,
}: {
  x: number;
  containerWidth: number;
  title: string;
  rows: TooltipRow[];
  footer?: string;
}) {
  const WIDTH = 210;
  // Flip to the other side of the crosshair near the right edge.
  const left = x + WIDTH + 24 > containerWidth ? x - WIDTH - 14 : x + 14;
  return (
    <div
      className="pointer-events-none absolute top-3 z-20 border border-[var(--color-ink)] bg-[var(--color-raised)] px-3 py-2 shadow-[3px_3px_0_0_var(--color-ink)]"
      style={{ left: Math.max(4, left), width: WIDTH }}
      role="status"
    >
      <div className="label-xs mb-1.5 text-[var(--color-ink-3)]">{title}</div>
      <div className="flex flex-col gap-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-center gap-1.5">
              {row.color && (
                <span
                  aria-hidden
                  className="inline-block h-[3px] w-3 shrink-0"
                  style={{ background: row.color }}
                />
              )}
              <span className="truncate text-[11px] text-[var(--color-ink-2)]">{row.label}</span>
            </span>
            <span className="tnum shrink-0 text-[12px] font-semibold">{row.value}</span>
          </div>
        ))}
      </div>
      {footer && (
        <div className="label-xs mt-1.5 border-t border-[var(--color-rule)] pt-1.5 text-[var(--color-ink-3)]">
          {footer}
        </div>
      )}
    </div>
  );
}

/** Legend. Always present for two or more series -- identity is never colour
 *  alone, and these pair with the direct end-of-line labels on the chart. */
export function Legend({
  items,
  className = "",
}: {
  items: { label: string; color: string; note?: string }[];
  className?: string;
}) {
  if (items.length < 2) return null;
  return (
    <ul className={`flex flex-wrap items-center gap-x-5 gap-y-1.5 ${className}`}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-[3px] w-4"
            style={{ background: item.color }}
          />
          <span className="text-[12px] font-medium">{item.label}</span>
          {item.note && (
            <span className="label-xs text-[var(--color-ink-3)]">{item.note}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Direct label at the end of a line. Carries a surface ring so overlapping
 *  labels stay readable against each other. */
export function EndLabel({
  x,
  y,
  text,
  color,
}: {
  x: number;
  y: number;
  text: string;
  color: string;
}) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <circle r={3.5} fill={color} stroke="var(--color-panel)" strokeWidth={2} />
      <text
        x={8}
        dy="0.32em"
        className="label-xs"
        fill={color}
        stroke="var(--color-panel)"
        strokeWidth={3}
        paintOrder="stroke"
      >
        {text}
      </text>
    </g>
  );
}

export function ChartShell({
  title,
  subtitle,
  actions,
  children,
  footnote,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footnote?: ReactNode;
}) {
  return (
    <section className="bg-[var(--color-panel)]">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-rule)] px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h3>
          {subtitle && (
            <p className="mt-0.5 text-[12px] leading-snug text-[var(--color-ink-2)]">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </header>
      <div className="px-5 py-4">{children}</div>
      {footnote && (
        <footer className="label-xs border-t border-[var(--color-rule)] px-5 py-2.5 text-[var(--color-ink-3)]">
          {footnote}
        </footer>
      )}
    </section>
  );
}

/** Every chart ships a table view: the contrast-relief obligation for the two
 *  light-mode palette slots below 3:1, and the accessible fallback generally. */
export function DataTable({
  columns,
  rows,
  maxHeight = 320,
}: {
  columns: string[];
  rows: (string | number)[][];
  maxHeight?: number;
}) {
  return (
    <div className="overflow-auto border border-[var(--color-rule)]" style={{ maxHeight }}>
      <table className="w-full border-collapse text-[12px]">
        <thead className="sticky top-0 bg-[var(--color-raised)]">
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className="label-xs border-b border-[var(--color-rule)] px-3 py-2 text-left text-[var(--color-ink-3)]"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-[var(--color-rule)] last:border-0">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`px-3 py-1.5 ${cellIndex === 0 ? "text-[var(--color-ink-2)]" : "tnum"}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function useViewToggle(initial: "chart" | "table" = "chart") {
  const [view, setView] = useState(initial);
  const toggle = useMemo(
    () => ({
      view,
      setView,
      control: (
        <div className="flex border border-[var(--color-rule-strong)]" role="group" aria-label="View">
          {(["chart", "table"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              aria-pressed={view === option}
              className={`label-xs px-2.5 py-1.5 transition-colors ${
                view === option
                  ? "bg-[var(--color-ink)] text-[var(--color-ground)]"
                  : "text-[var(--color-ink-2)] hover:bg-[var(--color-raised)]"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      ),
    }),
    [view],
  );
  return toggle;
}

/** Keyboard support for charts: arrow keys walk the crosshair. */
export function useKeyboardCursor(
  length: number,
  onChange: (index: number | null) => void,
) {
  const [index, setIndex] = useState<number | null>(null);

  useEffect(() => {
    onChange(index);
  }, [index, onChange]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (length === 0) return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex((prev) => {
          const base = prev ?? length - 1;
          const next = base + (event.key === "ArrowRight" ? 1 : -1);
          return Math.max(0, Math.min(length - 1, next));
        });
      } else if (event.key === "Escape") {
        setIndex(null);
      }
    },
    [length],
  );

  return { index, setIndex, onKeyDown };
}
