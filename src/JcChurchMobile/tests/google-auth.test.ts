import { describe, expect, it } from "vitest";
import {
  decodeGoogleIdToken,
  googleClientIdForPlatform,
} from "../src/auth/google-auth-core";

function fakeIdToken(payload: Record<string, unknown>): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

describe("google-auth", () => {
  it("selects the client ID for the current platform", () => {
    const ids = { web: "web-id", ios: "ios-id", android: "android-id" };
    expect(googleClientIdForPlatform("web", ids)).toBe("web-id");
    expect(googleClientIdForPlatform("ios", ids)).toBe("ios-id");
    expect(googleClientIdForPlatform("android", ids)).toBe("android-id");
  });

  it("fails closed when the platform client ID is missing or blank", () => {
    expect(googleClientIdForPlatform("ios", { web: "web-id" })).toBeUndefined();
    expect(googleClientIdForPlatform("web", { web: "  " })).toBeUndefined();
    expect(googleClientIdForPlatform("android", {})).toBeUndefined();
  });

  it("trims whitespace around configured client IDs", () => {
    expect(googleClientIdForPlatform("web", { web: "  web-id  " })).toBe("web-id");
  });

  it("reports availability per platform", () => {
    const ids = { web: "web-id", ios: undefined, android: undefined };
    expect(!!googleClientIdForPlatform("web", ids)).toBe(true);
    expect(!!googleClientIdForPlatform("ios", ids)).toBe(false);
  });

  it("decodes a Google ID token payload", () => {
    const token = fakeIdToken({
      email: "user@example.com",
      name: "Test User",
      picture: "https://example.com/photo.jpg",
    });
    expect(decodeGoogleIdToken(token)).toEqual({
      email: "user@example.com",
      name: "Test User",
      picture: "https://example.com/photo.jpg",
    });
  });

  it("handles missing profile fields in the ID token", () => {
    const token = fakeIdToken({ sub: "123" });
    expect(decodeGoogleIdToken(token)).toEqual({
      email: undefined,
      name: undefined,
      picture: undefined,
    });
  });

  it("rejects malformed ID tokens", () => {
    expect(decodeGoogleIdToken(undefined)).toBeNull();
    expect(decodeGoogleIdToken("not-a-jwt")).toBeNull();
    expect(decodeGoogleIdToken("a.b")).toBeNull();
    expect(decodeGoogleIdToken("a.!!!.c")).toBeNull();
  });
});
