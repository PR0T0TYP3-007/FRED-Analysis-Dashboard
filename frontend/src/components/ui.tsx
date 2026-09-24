import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import Sparkline from "./charts/Sparkline";
import { changeFor, formatDate, headlineFor, moveSentiment } from "../lib/format";
import type { SeriesCard, SignalMeta } from "../lib/types";

/* ===========================================================================
   The reference layout's vocabulary: letterspaced eyebrow labels, oversized
   figures, flat full-bleed tiles, hairline rules, and a few inverted tiles
   carrying the accent colours.
   =========================================================================== */

export type TileTone = "paper" | "ink" | "terracotta" | "forest";

const TONE_CLASS: Record<TileTone, string> = {
  paper: "bg-[var(--color-panel)] text-[var(--color-ink)]",
  ink: "bg-[var(--color-ink)] text-[var(--color-ground)]",
  terracotta: "bg-[var(--color-terracotta)] text-[#fdf6f2]",
  forest: "bg-[var(--color-forest)] text-[#eef6f2]",
};

const TONE_MUTED: Record<TileTone, string> = {
  paper: "text-[var(--color-ink-3)]",
  ink: "text-[var(--color-ground)]/60",
  terracotta: "text-[#fdf6f2]/70",
  forest: "text-[#eef6f2]/70",
};

export function SectionLabel({
  children,
  accent,
}: {
  children: ReactNode;
  accent?: string;
}) {
  return (
    <h2 className="label-sm mb-3 flex items-center gap-2 text-[var(--color-ink-2)]">
      {accent && (
        <span aria-hidden className="inline-block h-2 w-2" style={{ background: accent }} />
      )}
      {children}
    </h2>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="label-sm text-[var(--color-ink-3)]">{children}</p>;
}

/** The hero tile: a very large figure, a tiny caption, and a footnote line. */
export function StatTile({
  label,
  value,
  footnote,
  tone = "paper",
  spark,
  to,
  delta,
}: {
  label: string;
  value: ReactNode;
  footnote?: ReactNode;
  tone?: TileTone;
  spark?: SeriesCard["spark"];
  to?: string;
  delta?: { text: string; sentiment: "good" | "bad" | "neutral" };
}) {
  const sparkColor =
    tone === "paper" ? "var(--color-ink-2)" : "currentColor";

  const body = (
    <div className={`flex h-full flex-col justify-between p-5 ${TONE_CLASS[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <span className={`label-xs ${TONE_MUTED[tone]}`}>{label}</span>
        {spark && spark.length > 1 && (
          <span className="shrink-0 opacity-70">
            <Sparkline points={spark} width={72} height={24} color={sparkColor} fill={false} />
          </span>
        )}
      </div>

      <div className="mt-6">
        <div className="figure-xl text-[clamp(2rem,4.2vw,3.25rem)]">{value}</div>
        {delta && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <span
              aria-hidden
              className="text-[13px] leading-none"
              style={{
                color:
                  tone !== "paper"
                    ? "currentColor"
                    : delta.sentiment === "good"
                      ? "var(--color-pos)"
                      : delta.sentiment === "bad"
                        ? "var(--color-neg)"
                        : "var(--color-ink-3)",
              }}
            >
              {delta.text.startsWith("-") || delta.text.startsWith("−") ? "▼" : "▲"}
            </span>
            <span
              className="tnum text-[13px] font-semibold"
              style={{
                color:
                  tone !== "paper"
                    ? "currentColor"
                    : delta.sentiment === "good"
                      ? "var(--color-pos)"
                      : delta.sentiment === "bad"
                        ? "var(--color-neg)"
                        : "var(--color-ink-2)",
              }}
            >
              {delta.text}
            </span>
          </div>
        )}
      </div>

      {footnote && (
        <div className={`mt-4 flex items-center gap-1.5 text-[12px] ${TONE_MUTED[tone]}`}>
          {footnote}
          {to && <span aria-hidden>→</span>}
        </div>
      )}
    </div>
  );

  if (!to) return body;
  return (
    <Link
      to={to}
      className="group block h-full transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
    >
      {body}
    </Link>
  );
}

/** Tile built directly from a series snapshot, so every screen presents a
 *  series the same way. */
export function SeriesTile({
  card,
  tone = "paper",
  to,
}: {
  card: SeriesCard;
  tone?: TileTone;
  to?: string;
}) {
  const change = changeFor(card);
  const sentiment = moveSentiment(card, change.value);
  const headline = headlineFor(card);
  return (
    <StatTile
      tone={tone}
      label={card.display_name}
      value={headline.value}
      spark={card.spark}
      // A series that leads with its rate already shows the change as the
      // headline, so repeating it underneath would say the same thing twice.
      delta={headline.caption ? undefined : { text: change.text, sentiment }}
      footnote={
        <span className="tnum">
          {headline.caption ? `${headline.caption} · ` : ""}
          {card.series_id} · {formatDate(card.latest_date)}
        </span>
      }
      to={to ?? `/explorer/${card.series_id}`}
    />
  );
}

/* --------------------------------------------------------------------------- */

const STATE_STYLE: Record<string, { bg: string; fg: string; icon: string; word: string }> = {
  triggered: { bg: "var(--color-critical)", fg: "#fff", icon: "●", word: "Triggered" },
  warning: { bg: "var(--color-warning)", fg: "#1a1405", icon: "▲", word: "Watch" },
  normal: { bg: "var(--color-good)", fg: "#fff", icon: "■", word: "Normal" },
  unknown: { bg: "var(--color-ink-3)", fg: "#fff", icon: "?", word: "Unknown" },
};

/** Status is never colour alone: each chip carries a glyph and a word. */
export function StatusChip({ state, compact = false }: { state: string; compact?: boolean }) {
  const style = STATE_STYLE[state] ?? STATE_STYLE.unknown;
  return (
    <span
      className="label-xs inline-flex items-center gap-1.5 px-2 py-1"
      style={{ background: style.bg, color: style.fg }}
    >
      <span aria-hidden className="text-[8px] leading-none">
        {style.icon}
      </span>
      {!compact && style.word}
    </span>
  );
}

export function Chip({
  children,
  active = false,
  onClick,
  as = "button",
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  as?: "button" | "span";
}) {
  const className = `label-xs px-2.5 py-1.5 border transition-colors ${
    active
      ? "bg-[var(--color-ink)] text-[var(--color-ground)] border-[var(--color-ink)]"
      : "border-[var(--color-rule-strong)] text-[var(--color-ink-2)] hover:bg-[var(--color-raised)]"
  }`;
  if (as === "span") return <span className={className}>{children}</span>;
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={className}>
      {children}
    </button>
  );
}

/** Signal card with a meter: where the reading sits relative to its threshold. */
export function SignalCard({ signal, to }: { signal: SignalMeta; to?: string }) {
  const value = signal.latest_value;
  const state = signal.latest_state;

  // Meter domain wraps the threshold symmetrically so the marker position is
  // meaningful rather than arbitrary.
  const span = Math.max(Math.abs(signal.threshold) * 2, 2);
  const min = signal.threshold - span / 2;
  const max = signal.threshold + span / 2;
  const clamp = (v: number) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  const markerPct = value === null ? null : clamp(value);
  const thresholdPct = clamp(signal.threshold);

  const body = (
    <article className="flex h-full flex-col justify-between bg-[var(--color-panel)] p-5">
      <div>
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[14px] font-semibold tracking-[-0.01em]">{signal.label}</h3>
          <StatusChip state={state} />
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-[var(--color-ink-2)]">
          {signal.description}
        </p>
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <span className="figure-xl text-[2rem]">
            {value === null ? "—" : value.toFixed(2)}
            <span className="label-xs ml-1.5 text-[var(--color-ink-3)]">{signal.unit}</span>
          </span>
          <span className="label-xs text-[var(--color-ink-3)]">
            {signal.direction === "below" ? "alarm below" : "alarm above"}{" "}
            {signal.threshold.toFixed(2)}
          </span>
        </div>

        <div className="relative mt-3 h-2 bg-[var(--color-rule)]" role="img"
          aria-label={`${signal.label} at ${value ?? "unknown"} ${signal.unit}, threshold ${signal.threshold}`}>
          {markerPct !== null && (
            <span
              className="absolute top-0 h-2"
              style={{
                left: signal.direction === "below" ? `${markerPct}%` : 0,
                width: signal.direction === "below" ? `${100 - markerPct}%` : `${markerPct}%`,
                background: STATE_STYLE[state]?.bg ?? "var(--color-ink-3)",
                opacity: 0.85,
              }}
            />
          )}
          <span
            aria-hidden
            className="absolute -top-1 h-4 w-0.5 bg-[var(--color-ink)]"
            style={{ left: `${thresholdPct}%` }}
          />
          {markerPct !== null && (
            <span
              aria-hidden
              className="absolute -top-[3px] h-[14px] w-[14px] -translate-x-1/2 rounded-full border-2"
              style={{
                left: `${markerPct}%`,
                background: STATE_STYLE[state]?.bg ?? "var(--color-ink-3)",
                borderColor: "var(--color-panel)",
              }}
            />
          )}
        </div>

        <div className="label-xs mt-2.5 flex justify-between text-[var(--color-ink-3)]">
          <span>{formatDate(signal.latest_date)}</span>
          {to && <span>Detail →</span>}
        </div>
      </div>
    </article>
  );

  if (!to) return body;
  return (
    <Link to={to} className="block h-full transition-opacity hover:opacity-90">
      {body}
    </Link>
  );
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  footnote,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footnote?: ReactNode;
}) {
  return (
    <section className="bg-[var(--color-panel)]">
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-rule)] px-5 py-4">
          <div className="min-w-0">
            {title && <h3 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h3>}
            {subtitle && (
              <p className="mt-0.5 text-[12px] leading-snug text-[var(--color-ink-2)]">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
      {footnote && (
        <footer className="label-xs border-t border-[var(--color-rule)] px-5 py-2.5 text-[var(--color-ink-3)]">
          {footnote}
        </footer>
      )}
    </section>
  );
}

export function Skeleton({ height = 240, label }: { height?: number; label?: string }) {
  return (
    <div
      className="flex animate-pulse items-center justify-center bg-[var(--color-panel)]"
      style={{ height }}
      role="status"
      aria-live="polite"
    >
      <span className="label-xs text-[var(--color-ink-3)]">{label ?? "Loading"}</span>
    </div>
  );
}

export function ErrorNote({ error, hint }: { error: unknown; hint?: string }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="border-l-4 border-[var(--color-terracotta)] bg-[var(--color-panel)] p-5">
      <p className="label-xs text-[var(--color-terracotta)]">Could not load</p>
      <p className="mt-2 text-[13px] text-[var(--color-ink-2)]">{message}</p>
      {hint && <p className="mt-2 text-[12px] text-[var(--color-ink-3)]">{hint}</p>}
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[120px] items-center justify-center bg-[var(--color-panel)] p-8">
      <p className="text-[13px] text-[var(--color-ink-3)]">{children}</p>
    </div>
  );
}
