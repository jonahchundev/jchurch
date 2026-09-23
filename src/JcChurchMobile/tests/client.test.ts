import { describe, expect, it, vi } from "vitest";
import {
  getWebProxyTarget,
  proxyRequestPath,
  selectApiBaseUrl,
} from "../src/api/api-url";
import { ApiError, createApi, queryString } from "../src/api/client";
import { attendanceRange, describeRecurrence, localToUtc, memberSchema, normalizeScanCode, timeZoneLabel } from "../src/domain";

describe("API contracts", () => {
  it("selects arbitrary platform API bases and preserves web paths", () => {
    expect(selectApiBaseUrl("web", {})).toBe("/api/v1");
    expect(
      selectApiBaseUrl(
        "web",
        { web: "https://api.example.com/api/v2/" },
        false,
      ),
    ).toBe("https://api.example.com/api/v2");
    expect(
      selectApiBaseUrl("ios", { ios: "http://localhost:7072/api/v2/" }),
    ).toBe("http://localhost:7072/api/v2");
    expect(
      selectApiBaseUrl("android", {
        android: "http://10.0.2.2:7073/church-api/",
      }),
    ).toBe("http://10.0.2.2:7073/church-api");
    expect(
      proxyRequestPath(
        "/api/v1/churches?active=true",
        getWebProxyTarget("http://localhost:7072"),
      ),
    ).toBe("/churches?active=true");
    expect(
      proxyRequestPath(
        "/api/v1/churches?active=true",
        getWebProxyTarget("http://localhost:7072/api/v2/"),
      ),
    ).toBe("/api/v2/churches?active=true");
  });
  it("rejects unsupported API base URLs", () => {
    expect(() => getWebProxyTarget("ftp://localhost:7071")).toThrow(
      "must use http or https",
    );
  });
  it("submits scan codes only in request bodies and never retries automatically", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"detail":"Unknown"}', { status: 404 }));
    await expect(createApi("", fetcher).scanCheckIn("church", "session", "0000-CODE")).rejects.toMatchObject({ status: 404 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("/churches/church/occurrences/session/scan-check-ins");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: '{"scanCode":"0000-CODE"}' });
  });
  it("uses a read-only body-based scan status operation for recovery", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"checkedIn":true,"receipt":{"id":"receipt"}}'));
    expect((await createApi("", fetcher).scanStatus("church", "session", "0000-CODE")).checkedIn).toBe(true);
    expect(fetcher.mock.calls[0]?.[0]).toBe("/churches/church/occurrences/session/scan-check-ins/status");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: '{"scanCode":"0000-CODE"}' });
  });
  it("uses an occurrence-scoped delete for an auditable check-in undo", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"receipt":{"id":"receipt"},"undone":true}'));
    expect((await createApi("", fetcher).undoCheckIn("church", "session", "member")).undone).toBe(true);
    expect(fetcher.mock.calls[0]?.[0]).toBe("/churches/church/occurrences/session/check-ins/member");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
  });
  it("encodes opaque cursors and keeps false filters", () => {
    expect(
      queryString({ continuationToken: "a+b/==", includeArchived: false }),
    ).toBe("continuationToken=a%2Bb%2F%3D%3D&includeArchived=false");
  });
  it("sends exact ETags and writable fields on replacement", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"name":"New"}'));
    await createApi("http://localhost", fetcher).save(
      "/churches/one",
      { name: "New" },
      '"etag"',
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: "PUT",
      headers: { "If-Match": '"etag"' },
      body: '{"name":"New"}',
    });
  });
  it("continues after an empty page with a cursor", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"items":[],"continuationToken":"next"}'),
      )
      .mockResolvedValueOnce(
        new Response('{"items":[{"id":"one"}],"continuationToken":null}'),
      );
    expect(await createApi("", fetcher).all("/churches")).toEqual([
      { id: "one" },
    ]);
  });
  it("recovers persisted check-in after an uncertain response", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(
        new Response('{"checkedIn":true,"receipt":{"id":"receipt"}}'),
      );
    const result = await createApi("", fetcher).checkIn(
      "church",
      "session",
      "member",
    );
    expect(result).toEqual({ receipt: { id: "receipt" }, already: true });
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "/churches/church/occurrences/session/check-ins/member",
    );
  });
  it("does not turn an unconfirmed write into success", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error())
      .mockResolvedValueOnce(
        new Response('{"checkedIn":false,"receipt":null}'),
      );
    await expect(
      createApi("", fetcher).checkIn("church", "session", "member"),
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not retry creation or throttled check-in automatically", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response('{"detail":"Busy"}', {
          status: 429,
          headers: { "Retry-After": "3" },
        }),
      );
    await expect(
      createApi("", fetcher).checkIn("church", "session", "member"),
    ).rejects.toMatchObject({ retryAfter: 3 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects stale edits without retry", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 412 }));
    await expect(
      createApi("", fetcher).save("/churches/one", { name: "New" }, "old"),
    ).rejects.toMatchObject({ status: 412 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("dates and validation", () => {
  it("canonicalizes codes without losing leading zeroes or accepting partial values", () => {
    expect(normalizeScanCode(" 0000-abcd\r\n")).toBe("0000-ABCD");
    for (const code of ["short", "https://example.com", "embedded space", "ABC\nDEFGH", "0000-\u017fcan", "0000-\u00dfcan", "A".repeat(65)])
      expect(() => normalizeScanCode(code)).toThrow();
  });
  it("rejects missing names", () => {
    expect(memberSchema.safeParse({}).success).toBe(false);
  });
  it("converts an event wall time in its timezone", () => {
    expect(localToUtc("2026-09-20T09:00", "America/New_York")).toBe(
      "2026-09-20T13:00:00.000Z",
    );
  });
  it("rejects DST gaps and ambiguous times", () => {
    expect(() => localToUtc("2026-03-08T02:30", "America/New_York")).toThrow();
    expect(() => localToUtc("2026-11-01T01:30", "America/New_York")).toThrow();
  });
  it("uses explicit check-in-time UTC ranges, including future dates", () => {
    expect(attendanceRange("2027-01-10")).toEqual({
      from: "2027-01-10T00:00:00.000Z",
      to: "2027-01-11T00:00:00.000Z",
    });
  });
  it("describes supported recurrence rules without exposing RRULE syntax", () => {
    expect(describeRecurrence(null)).toBe("One-time");
    expect(describeRecurrence("FREQ=WEEKLY")).toBe("Every week");
    expect(describeRecurrence("FREQ=MONTHLY;INTERVAL=2")).toBe("Every 2 months");
  });
  it("displays friendly labels for configured timezones", () => {
    expect(timeZoneLabel("America/New_York")).toBe("Eastern Time");
    expect(timeZoneLabel("America/Chicago")).toBe("Central Time");
    expect(timeZoneLabel("UTC")).toBe("UTC");
    expect(timeZoneLabel("Europe/London")).toBe("Europe/London");
  });
});
