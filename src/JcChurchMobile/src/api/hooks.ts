import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Platform } from "react-native";
import { createApi } from "./client";
import type { Filters } from "./types";

export const api = createApi(
  process.env.EXPO_PUBLIC_API_URL ??
    (Platform.OS === "web"
      ? "/api/v1"
      : Platform.OS === "android"
        ? "http://10.0.2.2:7071/api/v1"
        : "http://127.0.0.1:7071/api/v1"),
);
export const churchPath = (churchId: string, resource = "") =>
  `/churches/${encodeURIComponent(churchId)}${resource ? `/${resource}` : ""}`;

export function useDebounce(value: string) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), 300);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}

export function useList<T>(path: string, filters: Filters = {}) {
  return useInfiniteQuery({
    queryKey: [path, filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.page<T>(path, { ...filters, continuationToken: pageParam }, signal),
    getNextPageParam: (page) => page.continuationToken ?? undefined,
  });
}

export function useAll<T>(path: string, filters: Filters = {}) {
  return useQuery({
    queryKey: [path, "all", filters],
    queryFn: ({ signal }) => api.all<T>(path, signal, filters),
  });
}
