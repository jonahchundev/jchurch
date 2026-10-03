// Pure, platform-agnostic Google auth helpers — no react-native / expo imports,
// so this module stays unit-testable under vitest (react-native's index.js uses
// Flow syntax the test runner can't parse).

export type GoogleUserProfile = {
  email?: string;
  name?: string;
  picture?: string;
  nonce?: string;
};

export type GoogleClientIds = {
  web?: string;
  ios?: string;
  android?: string;
};

// Fail closed: returns undefined when the platform's client ID is missing/blank,
// so the UI hides/disables the Google button (same posture as temporary-auth).
export function googleClientIdForPlatform(
  platform: string,
  ids: GoogleClientIds,
): string | undefined {
  const id =
    platform === "ios" ? ids.ios :
    platform === "android" ? ids.android :
    ids.web;
  return id && id.trim() ? id.trim() : undefined;
}

// Minimal ID-token payload decode (base64url JSON). Signature verification is
// intentionally deferred to the backend phase — this is a UI-level identity gate.
export function decodeGoogleIdToken(idToken: string | undefined): GoogleUserProfile | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const part = parts[1];
    if (!part) return null;
    const payload = part.replace(/-/g, "+").replace(/_/g, "/");
    const binary =
      typeof atob === "function"
        ? atob(payload)
        : Buffer.from(payload, "base64").toString("binary");
    const json = JSON.parse(
      decodeURIComponent(
        binary
          .split("")
          .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
          .join(""),
      ),
    );
    return {
      email: typeof json.email === "string" ? json.email : undefined,
      name: typeof json.name === "string" ? json.name : undefined,
      picture: typeof json.picture === "string" ? json.picture : undefined,
      nonce: typeof json.nonce === "string" ? json.nonce : undefined,
    };
  } catch {
    return null;
  }
}
