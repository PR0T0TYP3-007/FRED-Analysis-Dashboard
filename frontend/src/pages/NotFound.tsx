import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <div className="py-20">
      <p className="label-sm text-[var(--color-ink-3)]">404</p>
      <h1 className="display mt-3 text-[clamp(2.5rem,7vw,5rem)]">Nothing here.</h1>
      <p className="mt-4 max-w-md text-[14px] text-[var(--color-ink-2)]">
        That route is not part of the dashboard.
      </p>
      <Link
        to="/"
        className="label-xs mt-6 inline-block bg-[var(--color-ink)] px-4 py-3 text-[var(--color-ground)]"
      >
        Back to overview
      </Link>
    </div>
  );
}
