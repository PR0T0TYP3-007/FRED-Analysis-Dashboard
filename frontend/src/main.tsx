import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createBrowserRouter } from "react-router-dom";

import Shell from "./components/Shell";
import OverviewPage from "./pages/Overview";
import ExplorerPage from "./pages/Explorer";
import SignalsPage from "./pages/Signals";
import RelationshipsPage from "./pages/Relationships";
import ForecastsPage from "./pages/Forecasts";
import PipelinePage from "./pages/Pipeline";
// The two long-form pages are split out of the main bundle: they are text-heavy
// and most visits never leave the dashboard screens.
const GuidePage = lazy(() => import("./pages/Guide"));
const CaseStudyPage = lazy(() => import("./pages/CaseStudy"));

function Deferred({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="py-24 text-center">
          <span className="label-xs text-[var(--color-ink-3)]">Loading</span>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
import NotFoundPage from "./pages/NotFound";
import "./styles/index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

const router = createBrowserRouter([
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: "explorer", element: <ExplorerPage /> },
      { path: "explorer/:seriesId", element: <ExplorerPage /> },
      { path: "signals", element: <SignalsPage /> },
      { path: "signals/:signalKey", element: <SignalsPage /> },
      { path: "relationships", element: <RelationshipsPage /> },
      { path: "forecasts", element: <ForecastsPage /> },
      { path: "forecasts/:seriesId", element: <ForecastsPage /> },
      { path: "pipeline", element: <PipelinePage /> },
      {
        path: "guide",
        element: (
          <Deferred>
            <GuidePage />
          </Deferred>
        ),
      },
      {
        path: "case-study",
        element: (
          <Deferred>
            <CaseStudyPage />
          </Deferred>
        ),
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
