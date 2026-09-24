import { useQuery } from "@tanstack/react-query";
import type {
  CatalogResponse,
  CorrelationResponse,
  CurveResponse,
  ForecastResponse,
  LeadLagResponse,
  ObservationsResponse,
  Overview,
  PipelineResponse,
  RecessionWindow,
  SeriesDetail,
  SignalDetail,
  SignalMeta,
  Transform,
} from "./types";

const BASE = "";

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`,
    );
  }
  return (await response.json()) as T;
}

/* The warehouse refreshes once a day, so cached results stay valid for a long
   time; there is nothing to gain from refetching on every window focus. */
const DAY_STALE = { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false };

export const useOverview = () =>
  useQuery({ queryKey: ["overview"], queryFn: () => get<Overview>("/api/overview"), ...DAY_STALE });

export const useRecessions = () =>
  useQuery({
    queryKey: ["recessions"],
    queryFn: () => get<RecessionWindow[]>("/api/overview/recessions"),
    staleTime: Infinity,
  });

export const useCatalog = (category?: string, search?: string) =>
  useQuery({
    queryKey: ["catalog", category ?? "all", search ?? ""],
    queryFn: () => {
      const params = new URLSearchParams();
      if (category && category !== "all") params.set("category", category);
      if (search) params.set("search", search);
      const qs = params.toString();
      return get<CatalogResponse>(`/api/series${qs ? `?${qs}` : ""}`);
    },
    ...DAY_STALE,
  });

export const useSeriesDetail = (seriesId: string | undefined) =>
  useQuery({
    queryKey: ["series", seriesId],
    queryFn: () => get<SeriesDetail>(`/api/series/${seriesId}`),
    enabled: Boolean(seriesId),
    ...DAY_STALE,
  });

export const useObservations = (
  seriesId: string | undefined,
  transform: Transform,
  start?: string,
) =>
  useQuery({
    queryKey: ["observations", seriesId, transform, start ?? ""],
    queryFn: () => {
      const params = new URLSearchParams({ transform });
      if (start) params.set("start", start);
      return get<ObservationsResponse>(
        `/api/series/${seriesId}/observations?${params.toString()}`,
      );
    },
    enabled: Boolean(seriesId),
    ...DAY_STALE,
  });

export const useSignals = () =>
  useQuery({
    queryKey: ["signals"],
    queryFn: () =>
      get<{ signals: SignalMeta[]; state_counts: Record<string, number>; verdict: string }>(
        "/api/signals",
      ),
    ...DAY_STALE,
  });

export const useSignalDetail = (key: string | undefined, start?: string) =>
  useQuery({
    queryKey: ["signal", key, start ?? ""],
    queryFn: () =>
      get<SignalDetail>(`/api/signals/${key}${start ? `?start=${start}` : ""}`),
    enabled: Boolean(key),
    ...DAY_STALE,
  });

export const useCurve = () =>
  useQuery({ queryKey: ["curve"], queryFn: () => get<CurveResponse>("/api/signals/curve"), ...DAY_STALE });

export const useCorrelations = (window: string) =>
  useQuery({
    queryKey: ["correlations", window],
    queryFn: () => get<CorrelationResponse>(`/api/correlations?window=${window}`),
    ...DAY_STALE,
  });

export const useLeadLag = (target: string) =>
  useQuery({
    queryKey: ["leadlag", target],
    queryFn: () => get<LeadLagResponse>(`/api/correlations/leadlag/${target}`),
    ...DAY_STALE,
  });

export const useForecast = (seriesId: string | undefined) =>
  useQuery({
    queryKey: ["forecast", seriesId],
    queryFn: () => get<ForecastResponse>(`/api/series/${seriesId}/forecast?history=120`),
    enabled: Boolean(seriesId),
    retry: false,
    ...DAY_STALE,
  });

export const usePipeline = () =>
  useQuery({
    queryKey: ["pipeline"],
    queryFn: () => get<PipelineResponse>("/api/pipeline"),
    staleTime: 60 * 1000,
  });
