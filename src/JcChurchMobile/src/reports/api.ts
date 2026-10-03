import { useQuery } from "@tanstack/react-query";
import { api, churchPath } from "../api/hooks";
import { queryString } from "../api/client";
import type {
  AttendanceSummaryRow,
  ChurchEvent,
  Filters,
  Group,
  Occurrence,
  OccurrenceCheckInCount,
} from "../api/types";

export type GroupBy = "event" | "occurrence" | "member" | "group" | "day";

// Reference-data and summary hooks shared by the four report screens. These are
// single-shot queries (no infinite pagination) and stay disabled until a required
// filter (event, occurrence, group) has been chosen.

export function useEvents(churchId: string) {
  const path = churchPath(churchId, "events");
  return useQuery({
    queryKey: [path, "all"],
    queryFn: ({ signal }) => api.all<ChurchEvent>(path, signal),
  });
}

export function useGroups(churchId: string) {
  const path = churchPath(churchId, "groups");
  const filters: Filters = { includeArchived: true };
  return useQuery({
    queryKey: [path, "all", filters],
    queryFn: ({ signal }) => api.all<Group>(path, signal, filters),
  });
}

export function useEventOccurrences(churchId: string, eventId: string) {
  const path = churchPath(churchId, `events/${eventId}/occurrences`);
  return useQuery({
    queryKey: [path, "all"],
    queryFn: ({ signal }) => api.all<Occurrence>(path, signal),
    enabled: !!eventId,
  });
}

export function useOccurrenceCounts(churchId: string, eventId: string) {
  const path = churchPath(churchId, `events/${eventId}/occurrence-check-in-counts`);
  return useQuery({
    queryKey: [path, "all"],
    queryFn: ({ signal }) => api.all<OccurrenceCheckInCount>(path, signal),
    enabled: !!eventId,
  });
}

// Aggregated attendance totals from GET /attendance/summary. The response is a
// single non-paginated { items } payload, so a plain get is enough.
export function useSummary(
  churchId: string,
  groupBy: GroupBy,
  filters: Filters,
  enabled = true,
) {
  const path = churchPath(churchId, "attendance/summary");
  const params: Filters = { groupBy, ...filters };
  return useQuery({
    queryKey: [path, params],
    queryFn: ({ signal }) =>
      api
        .get<{ items: AttendanceSummaryRow[] }>(
          `${path}?${queryString(params)}`,
          signal,
        )
        .then((response) => response.items),
    enabled,
  });
}
