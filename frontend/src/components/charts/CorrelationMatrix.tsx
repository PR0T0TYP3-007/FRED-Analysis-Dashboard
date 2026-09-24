import { useMemo, useState } from "react";

import type { CorrelationResponse } from "../../lib/types";

/** Diverging ramp: blue (negative) -> neutral warm grey (nothing) -> terracotta
 *  (positive). A single hue would claim that -1 and +1 are the same thing at
 *  different strengths; they are opposites, so the encoding has two poles and a
 *  neutral midpoint that genuinely reads as "no relationship". */
function cellColor(value: number): string {
  const magnitude = Math.min(Math.abs(value), 1);
  const alpha = magnitude ** 0.85;
  const pole = value >= 0 ? "var(--color-div-pos)" : "var(--color-div-neg)";
  return `color-mix(in oklab, ${pole} ${(alpha * 100).toFixed(1)}%, var(--color-div-mid))`;
}

/** Ink that stays legible as the cell darkens. */
function inkFor(value: number): string {
  return Math.abs(value) > 0.55 ? "var(--color-raised)" : "var(--color-ink-2)";
}

export default function CorrelationMatrix({
  data,
  onSelectPair,
}: {
  data: CorrelationResponse;
  onSelectPair?: (a: string, b: string) => void;
}) {
  const [hover, setHover] = useState<{ a: string; b: string; corr: number } | null>(null);

  const lookup = useMemo(() => {
    const map = new Map<string, number>();
    for (const cell of data.cells) {
      map.set(`${cell.series_a}|${cell.series_b}`, cell.corr);
    }
    return map;
  }, [data.cells]);

  const order = data.order;

  return (
    <div className="w-full">
      <div className="overflow-x-auto">
        <table
          className="border-separate text-[11px]"
          style={{ borderSpacing: "2px" }}
          onMouseLeave={() => setHover(null)}
        >
          <caption className="sr-only">
            Correlation matrix of year-over-year changes across {order.length} series
          </caption>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[var(--color-panel)]" />
              {order.map((id) => (
                <th key={id} scope="col" className="label-xs p-0 align-bottom">
                  {/* The rotated label is taken out of flow: left in the layout
                      it would set the column width to the length of the longest
                      series id and stretch every cell into a stripe. */}
                  <div className="relative h-24 w-7">
                    <span className="absolute bottom-1 left-1/2 origin-bottom-left -rotate-90 whitespace-nowrap text-[var(--color-ink-3)]">
                      {id}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.map((rowId) => (
              <tr key={rowId}>
                <th
                  scope="row"
                  className="label-xs sticky left-0 z-10 bg-[var(--color-panel)] pr-2 text-right whitespace-nowrap text-[var(--color-ink-3)]"
                >
                  {rowId}
                </th>
                {order.map((colId) => {
                  const value = lookup.get(`${rowId}|${colId}`);
                  const isDiagonal = rowId === colId;
                  if (value === undefined) {
                    return <td key={colId} className="h-7 w-7 bg-[var(--color-ground)]" />;
                  }
                  const active = hover?.a === rowId && hover?.b === colId;
                  return (
                    <td key={colId} className="p-0">
                      <button
                        type="button"
                        onMouseEnter={() => setHover({ a: rowId, b: colId, corr: value })}
                        onFocus={() => setHover({ a: rowId, b: colId, corr: value })}
                        onClick={() => !isDiagonal && onSelectPair?.(rowId, colId)}
                        aria-label={`${rowId} versus ${colId}: correlation ${value.toFixed(2)}`}
                        className="tnum flex h-7 w-7 items-center justify-center transition-[outline] outline-offset-0"
                        style={{
                          background: isDiagonal ? "var(--color-rule)" : cellColor(value),
                          color: isDiagonal ? "var(--color-ink-3)" : inkFor(value),
                          outline: active ? "2px solid var(--color-ink)" : "none",
                        }}
                      >
                        {isDiagonal ? "" : Math.abs(value) >= 0.5 ? value.toFixed(1).replace("0.", ".") : ""}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="label-xs text-[var(--color-ink-3)]">−1</span>
          <div className="flex" aria-hidden>
            {[-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1].map((step) => (
              <span
                key={step}
                className="h-3.5 w-6"
                style={{ background: cellColor(step) }}
              />
            ))}
          </div>
          <span className="label-xs text-[var(--color-ink-3)]">+1</span>
          <span className="label-xs ml-2 text-[var(--color-ink-3)]">
            inverse · none · together
          </span>
        </div>

        <div
          className="tnum min-h-[20px] text-[12px] text-[var(--color-ink-2)]"
          role="status"
          aria-live="polite"
        >
          {hover && hover.a !== hover.b ? (
            <>
              <span className="font-semibold text-[var(--color-ink)]">
                {data.labels[hover.a]?.display_name ?? hover.a}
              </span>{" "}
              vs{" "}
              <span className="font-semibold text-[var(--color-ink)]">
                {data.labels[hover.b]?.display_name ?? hover.b}
              </span>{" "}
              · r = {hover.corr.toFixed(3)}
            </>
          ) : (
            <span className="text-[var(--color-ink-3)]">
              Hover a cell for the pair and its coefficient
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
