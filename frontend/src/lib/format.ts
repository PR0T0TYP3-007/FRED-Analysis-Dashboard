import type { SeriesCard, Transform, UnitKind } from "./types";

/* ---------------------------------------------------------------------------
   Number formatting.

   The rule that matters: a change in a series that is *already* a percentage
   is quoted in percentage points, not as a percentage of a percentage. The
   unemployment rate going 4.0 -> 4.4 is "+0.4pp"; calling it "+10%" is the
   classic macro-dashboard error, so `changeFor` picks the right field per unit.
   --------------------------------------------------------------------------- */

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatValue(
  value: number | null | undefined,
  unit: UnitKind,
  opts: { compact?: boolean; scale?: number } = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";

  // FRED stores GDP in billions and payrolls in thousands; `scale` lifts the
  // stored figure into base units so "24269.6" reads as "$24.3T", not "$24.3K".
  const scaled = value * (opts.scale ?? 1);

  switch (unit) {
    case "percent":
      return `${value.toFixed(2)}%`;
    case "usd":
      return Math.abs(scaled) >= 10_000 || opts.compact
        ? `$${compact.format(scaled)}`
        : `$${scaled.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
    case "count":
      return Math.abs(scaled) >= 10_000 || opts.compact
        ? compact.format(scaled)
        : scaled.toLocaleString("en-US", { maximumFractionDigits: 0 });
    case "ratio":
      return value.toFixed(2);
    case "index":
    default:
      return value.toLocaleString("en-US", {
        minimumFractionDigits: Math.abs(value) < 100 ? 2 : 1,
        maximumFractionDigits: Math.abs(value) < 100 ? 2 : 1,
      });
  }
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

export function formatPoints(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}pp`;
}

export interface ChangeView {
  text: string;
  value: number | null;
  /** Label describing the comparison basis, e.g. "vs year ago". */
  basis: string;
}

/** Year-over-year change, expressed correctly for the series' unit. */
export function changeFor(card: {
  unit_kind: UnitKind;
  pct_12m: number | null;
  diff_12m: number | null;
}): ChangeView {
  // A percentage moves in percentage points.
  if (card.unit_kind === "percent") {
    return { text: formatPoints(card.diff_12m), value: card.diff_12m, basis: "vs year ago" };
  }
  // A ratio is a plain quantity -- hours per week, a 0/1 flag. It moves in its
  // own units, so "pp" would be nonsense: weekly hours rising 0.7 is 0.7 hours,
  // not 0.7 percentage points.
  if (card.unit_kind === "ratio") {
    const value = card.diff_12m;
    return {
      text:
        value === null || Number.isNaN(value)
          ? "—"
          : `${value >= 0 ? "+" : ""}${value.toFixed(2)}`,
      value,
      basis: "vs year ago",
    };
  }
  return { text: formatPercent(card.pct_12m), value: card.pct_12m, basis: "vs year ago" };
}

/**
 * Does this move read as good or bad? Returns null where the series has no
 * inherent direction (the dollar, the fed funds rate), so the UI stays neutral
 * rather than inventing a judgement.
 */
export function moveSentiment(
  card: Pick<SeriesCard, "higher_is_better">,
  change: number | null,
): "good" | "bad" | "neutral" {
  if (card.higher_is_better === null || change === null || Math.abs(change) < 1e-9) {
    return "neutral";
  }
  return change > 0 === card.higher_is_better ? "good" : "bad";
}

/* --------------------------------------------------------------------------- */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Parse a `YYYY-MM-DD` string as a local calendar date, never shifted by TZ. */
export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = parseDate(iso.slice(0, 10));
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatMonth(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = parseDate(iso.slice(0, 10));
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const time = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${time}`;
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export const FREQUENCY_LABEL: Record<string, string> = {
  D: "Daily",
  W: "Weekly",
  BW: "Biweekly",
  M: "Monthly",
  Q: "Quarterly",
  SA: "Semiannual",
  A: "Annual",
};

export const TRANSFORM_LABEL: Record<Transform, string> = {
  level: "Level",
  yoy: "Year over year",
  mom: "Period change",
  index100: "Indexed to 100",
  zscore: "Z-score (5y)",
};

/** Axis/tooltip unit for a plotted transform, which differs from the raw unit. */
export function transformUnit(transform: Transform, unit: UnitKind): UnitKind {
  if (transform === "level") return unit;
  if (transform === "index100") return "index";
  if (transform === "zscore") return "ratio";
  return "percent";
}

export function formatPlotted(
  value: number | null,
  transform: Transform,
  unit: UnitKind,
  scale = 1,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (transform === "yoy" || transform === "mom") return formatPercent(value, 2);
  if (transform === "zscore") return `${value >= 0 ? "+" : ""}${value.toFixed(2)}σ`;
  if (transform === "index100") return value.toFixed(1);
  return formatValue(value, unit, { scale, compact: true });
}

/**
 * What a tile should lead with. A price index level (334.1) tells a reader
 * nothing; the year-over-year rate is the number that series exists to convey.
 * Series whose natural reading is a rate therefore headline the rate and carry
 * the level as supporting detail.
 */
export function headlineFor(card: {
  unit_kind: UnitKind;
  scale: number;
  default_transform: Transform;
  latest_value: number | null;
  pct_12m: number | null;
  diff_12m: number | null;
}): { value: string; caption: string | null } {
  const leadsWithRate = card.unit_kind === "index" && card.default_transform === "yoy";
  if (leadsWithRate) {
    return {
      value: formatPercent(card.pct_12m, 1),
      caption: `index ${formatValue(card.latest_value, "index")}`,
    };
  }
  return {
    value: formatValue(card.latest_value, card.unit_kind, {
      compact: true,
      scale: card.scale,
    }),
    caption: null,
  };
}
