import type { Attendance, Filters, GroupImportResult, GroupImportRow, MemberImportResult, MemberImportRow, Page, ScanResult, ScanStatus } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter = 0,
  ) {
    super(message);
  }
  get uncertain() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export function queryString(filters: Filters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return params.toString();
}

export function createApi(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 15000,
) {
  async function request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      etag?: string;
      signal?: AbortSignal;
    } = {},
  ): Promise<{ data: T; status: number }> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const timer = setTimeout(abort, timeoutMs);
    try {
      const response = await fetcher(`${baseUrl.replace(/\/$/, "")}${path}`, {
        method: options.method ?? "GET",
        headers: {
          Accept: "application/json",
          ...(options.body !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
          ...(options.etag ? { "If-Match": options.etag } : {}),
        },
        body:
          options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      if (!response.ok) {
        const problem = (await response.json().catch(() => ({}))) as {
          detail?: string;
        };
        throw new ApiError(
          response.status,
          problem.detail ?? `Request failed (${response.status}).`,
          Number(response.headers.get("Retry-After")) || 0,
        );
      }
      const data = response.status === 204 ? undefined : await response.json();
      return { data: data as T, status: response.status };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        0,
        "Connection interrupted. The operation could not be confirmed.",
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  }
  return {
    request,
    async get<T>(path: string, signal?: AbortSignal) {
      return (await request<T>(path, { signal })).data;
    },
    async page<T>(path: string, filters: Filters = {}, signal?: AbortSignal) {
      return (
        await request<Page<T>>(
          `${path}?${queryString({ pageSize: 50, ...filters })}`,
          { signal },
        )
      ).data;
    },
    async all<T>(path: string, signal?: AbortSignal, filters: Filters = {}) {
      const items: T[] = [];
      let token: string | null = null;
      do {
        const page: Page<T> = (
          await request<Page<T>>(
            `${path}?${queryString({ ...filters, pageSize: 200, continuationToken: token ?? undefined })}`,
            { signal },
          )
        ).data;
        items.push(...page.items);
        token = page.continuationToken;
      } while (token);
      return items;
    },
    async save<T>(path: string, body: unknown, etag?: string) {
      return (
        await request<T>(path, { method: etag ? "PUT" : "POST", body, etag })
      ).data;
    },
    async archive(path: string, etag: string) {
      await request(path, { method: "DELETE", etag });
    },
    async text(path: string, signal?: AbortSignal): Promise<string> {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      const timer = setTimeout(abort, timeoutMs);
      try {
        const response = await fetcher(`${baseUrl.replace(/\/$/, "")}${path}`, {
          method: "GET",
          headers: { Accept: "text/csv" },
          signal: controller.signal,
        });
        if (!response.ok) {
          const problem = (await response.json().catch(() => ({}))) as {
            detail?: string;
          };
          throw new ApiError(
            response.status,
            problem.detail ?? `Request failed (${response.status}).`,
            Number(response.headers.get("Retry-After")) || 0,
          );
        }
        return await response.text();
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          0,
          "Connection interrupted. The operation could not be confirmed.",
        );
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    },
    async importMembers(churchId: string, rows: MemberImportRow[]) {
      const path = `/churches/${encodeURIComponent(churchId)}/members/import`;
      return (
        await request<MemberImportResult>(path, {
          method: "POST",
          body: { rows },
        })
      ).data;
    },
    async importGroups(churchId: string, rows: GroupImportRow[]) {
      const path = `/churches/${encodeURIComponent(churchId)}/groups/import`;
      return (
        await request<GroupImportResult>(path, {
          method: "POST",
          body: { rows },
        })
      ).data;
    },
    async scanCheckIn(churchId: string, occurrenceId: string, scanCode: string, signal?: AbortSignal) {
      const path = `/churches/${encodeURIComponent(churchId)}/occurrences/${encodeURIComponent(occurrenceId)}/scan-check-ins`;
      return (await request<ScanResult>(path, { method: "POST", body: { scanCode }, signal })).data;
    },
    async scanStatus(churchId: string, occurrenceId: string, scanCode: string, signal?: AbortSignal) {
      const path = `/churches/${encodeURIComponent(churchId)}/occurrences/${encodeURIComponent(occurrenceId)}/scan-check-ins/status`;
      return (await request<ScanStatus>(path, { method: "POST", body: { scanCode }, signal })).data;
    },
    async checkIn(churchId: string, occurrenceId: string, memberId: string) {
      const path = `/churches/${encodeURIComponent(churchId)}/occurrences/${encodeURIComponent(occurrenceId)}/check-ins`;
      try {
        const result = await request<Attendance>(path, {
          method: "POST",
          body: { memberId },
        });
        return { receipt: result.data, already: result.status === 200 };
      } catch (error) {
        if (
          !(error instanceof ApiError) ||
          !error.uncertain ||
          error.status === 429
        )
          throw error;
        const recovered = await request<{
          checkedIn: boolean;
          receipt: Attendance | null;
        }>(`${path}/${encodeURIComponent(memberId)}`).catch(() => null);
        if (recovered?.data.checkedIn && recovered.data.receipt)
          return { receipt: recovered.data.receipt, already: true };
        throw error;
      }
    },
    async undoCheckIn(churchId: string, occurrenceId: string, memberId: string) {
      const path = `/churches/${encodeURIComponent(churchId)}/occurrences/${encodeURIComponent(occurrenceId)}/check-ins/${encodeURIComponent(memberId)}`;
      return (await request<{ receipt: Attendance; undone: boolean }>(path, { method: "DELETE" })).data;
    },
  };
}

export function message(error: unknown) {
  if (error instanceof ApiError && error.status === 412)
    return "This record changed elsewhere. Reload the latest version and review your edits.";
  if (error instanceof ApiError && error.status === 429)
    return `Service is busy. Retry after ${error.retryAfter || 1} seconds.`;
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
