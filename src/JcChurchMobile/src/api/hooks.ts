import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Platform } from "react-native";
import { selectApiBaseUrl } from "./api-url";
import { createApi } from "./client";
import type { Filters } from "./types";

const baseUrl = selectApiBaseUrl(Platform.OS, {
  android: process.env.EXPO_PUBLIC_API_URL_ANDROID,
  ios: process.env.EXPO_PUBLIC_API_URL_IOS,
  web: process.env.EXPO_PUBLIC_API_URL_WEB,
}, process.env.NODE_ENV !== "production");
export const api = createApi(baseUrl);
export const churchPath = (churchId: string, resource = "") =>
  `/churches/${encodeURIComponent(churchId)}${resource ? `/${resource}` : ""}`;

// Photo URLs are built only when imageVersion is set; the ?v= token keeps caches fresh after replacement.
export function memberImageUrl(churchId: string, memberId: string, imageVersion?: string | null): string | null {
  if (!imageVersion) return null;
  return `${baseUrl.replace(/\/$/, "")}${churchPath(churchId, `members/${encodeURIComponent(memberId)}/image`)}?v=${encodeURIComponent(imageVersion)}`;
}

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
