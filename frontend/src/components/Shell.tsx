import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { useOverview } from "../lib/api";
import { formatDate, relativeTime } from "../lib/format";

// The six data screens, then the two pages about the project itself. The
// divider between them keeps "what the data says" separate from "what this is".
const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/explorer", label: "Explorer" },
  { to: "/signals", label: "Signals" },
  { to: "/relationships", label: "Relationships" },
  { to: "/forecasts", label: "Forecasts" },
  { to: "/pipeline", label: "Pipeline" },
  { to: "/guide", label: "Guide", meta: true },
  { to: "/case-study", label: "Case study", meta: true },
];

type Theme = "light" | "dark";

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "light";
    const stored = window.localStorage.getItem("ledger-theme");
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem("ledger-theme", theme);
    } catch {
      // Private browsing can refuse storage; the toggle still works per-session.
    }
  }, [theme]);

  return [theme, () => setTheme((t) => (t === "light" ? "dark" : "light"))];
}

export default function Shell() {
  const [theme, toggleTheme] = useTheme();
  const { data } = useOverview();

  const run = data?.last_run;
  const runTone =
    run?.status === "success"
      ? "var(--color-good)"
      : run?.status === "partial"
        ? "var(--color-warning)"
        : run?.status === "failed"
          ? "var(--color-critical)"
          : "var(--color-ink-3)";

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="label-xs sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-[var(--color-ink)] focus:px-3 focus:py-2 focus:text-[var(--color-ground)]"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-[var(--color-rule)] bg-[var(--color-ground)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center gap-6 px-4 py-3.5 sm:px-6 lg:px-8">
          <NavLink to="/" className="flex shrink-0 items-baseline gap-2.5">
            <span className="text-[19px] font-extrabold tracking-[-0.045em]">Ledger</span>
            <span className="label-xs hidden text-[var(--color-ink-3)] sm:inline">
              US Macro Warehouse
            </span>
          </NavLink>

          <nav aria-label="Primary" className="min-w-0 flex-1 overflow-x-auto">
            <ul className="flex items-center gap-1">
              {NAV.map((item, index) => (
                <li key={item.to} className="flex items-center">
                  {item.meta && !NAV[index - 1]?.meta && (
                    <span
                      aria-hidden
                      className="mx-2 h-4 w-px shrink-0 bg-[var(--color-rule-strong)]"
                    />
                  )}
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `relative block whitespace-nowrap px-3 py-2 text-[13.5px] transition-colors ${
                        item.meta ? "font-normal" : "font-medium"
                      } ${
                        isActive
                          ? "text-[var(--color-ink)] after:absolute after:inset-x-3 after:-bottom-[15px] after:h-[2px] after:bg-[var(--color-ink)]"
                          : "text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <button
            type="button"
            onClick={toggleTheme}
            className="label-xs shrink-0 border border-[var(--color-rule-strong)] px-2.5 py-2 text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-panel)]"
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
          >
            {theme === "light" ? "Dark" : "Light"}
          </button>
        </div>
      </header>

      {/* The reference layout's black utility strip, repurposed as the honest
          statement of where this data came from and when. */}
      <div className="bg-[var(--color-ink)] text-[var(--color-ground)]">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-2.5 sm:px-6 lg:px-8">
          <span
            className="label-xs px-1.5 py-0.5"
            style={{ background: "var(--color-terracotta)", color: "#fdf6f2" }}
          >
            Live
          </span>
          <span className="label-xs text-[var(--color-ground)]/75">
            Source: St. Louis Fed FRED · {data?.coverage.series ?? "—"} series ·{" "}
            {data ? data.coverage.observations.toLocaleString() : "—"} observations since{" "}
            {data ? formatDate(data.coverage.since) : "—"}
          </span>
          <span className="label-xs ml-auto flex items-center gap-2 text-[var(--color-ground)]/75">
            <span aria-hidden className="inline-block h-1.5 w-1.5" style={{ background: runTone }} />
            Last refresh {run ? relativeTime(run.started_at) : "—"}
            {run ? ` · ${run.rows_upserted.toLocaleString()} rows` : ""}
          </span>
        </div>
      </div>

      <main id="main" className="mx-auto max-w-[1500px] px-4 pb-24 pt-8 sm:px-6 lg:px-8">
        <Outlet />
      </main>

      <footer className="border-t border-[var(--color-rule)]">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 py-6 sm:px-6 lg:px-8">
          <p className="label-xs flex flex-wrap items-center gap-x-2 text-[var(--color-ink-3)]">
            <NavLink to="/guide" className="underline underline-offset-4 hover:no-underline">
              New here? Start with the guide
            </NavLink>
            <span aria-hidden>·</span>
            Postgres warehouse · FastAPI · scheduled daily refresh
          </p>
          <p className="label-xs text-[var(--color-ink-3)]">
            Data courtesy of the Federal Reserve Bank of St. Louis. Not investment advice.
          </p>
        </div>
      </footer>
    </div>
  );
}
