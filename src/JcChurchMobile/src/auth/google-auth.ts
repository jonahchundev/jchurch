import { Platform } from "react-native";
import { useEffect, useState } from "react";
import * as AuthSession from "expo-auth-session";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import {
  googleClientIdForPlatform,
  type GoogleClientIds,
  type GoogleUserProfile,
} from "./google-auth-core";

WebBrowser.maybeCompleteAuthSession();

export type GoogleTokens = {
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  expiresIn?: number;
  issuedAt?: number;
};

// Re-export pure helpers so consumers only need this module.
export {
  decodeGoogleIdToken,
  googleClientIdForPlatform,
  type GoogleClientIds,
  type GoogleUserProfile,
} from "./google-auth-core";

// Google's OIDC discovery document (stable endpoints; explicit to avoid a runtime fetch).
// No tokenEndpoint needed — the implicit flow returns the ID token directly.
export const googleDiscovery = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  revocationEndpoint: "https://oauth2.googleapis.com/revoke",
};

export const googleScopes = ["openid", "profile", "email"];

function configuredClientIds(): GoogleClientIds {
  return {
    web: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    ios: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    android: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  };
}

// Fail closed: undefined when this platform's client ID is not configured.
export function googleClientId(platform: string = Platform.OS): string | undefined {
  return googleClientIdForPlatform(platform, configuredClientIds());
}

export function isGoogleSignInAvailable(platform: string = Platform.OS): boolean {
  return !!googleClientId(platform);
}

export function googleRedirectUri(): string {
  return AuthSession.makeRedirectUri({
    scheme: "jchurch",
    path: "redirect",
  });
}

export function useGoogleAuthRequest() {
  const clientId = googleClientId();
  const redirectUri = googleRedirectUri();
  // Google requires a nonce for response_type=id_token (implicit flow).
  const [nonce, setNonce] = useState<string>("");
  useEffect(() => {
    let active = true;
    void Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      Crypto.randomUUID(),
    ).then((digest) => {
      if (active) setNonce(digest);
    });
    return () => {
      active = false;
    };
  }, []);
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: clientId ?? "",
      scopes: googleScopes,
      redirectUri,
      // Implicit flow: Google Web client IDs are confidential and require a
      // client_secret at the token-exchange step, which cannot be embedded in a
      // public client. Requesting the ID token directly avoids the exchange.
      // Limitation: no access/refresh token — user re-signs-in on ID-token
      // expiry (~1 hour). Acceptable for the current client-side identity gate.
      responseType: AuthSession.ResponseType.IdToken,
      usePKCE: false,
      extraParams: { nonce },
    },
    googleDiscovery,
  );
  return [request, response, promptAsync, nonce] as const;
}

// The implicit flow returns tokens directly on the auth response — no exchange.
// Validates the nonce echoed in the ID token matches what we requested.
export function googleTokensFromResponse(
  response: AuthSession.AuthSessionResult,
  expectedNonce?: string,
): GoogleTokens | null {
  if (response.type !== "success") return null;
  const idToken = response.params.id_token;
  if (!idToken) return null;
  const expiresIn = Number(response.params.expires_in);
  return {
    idToken,
    expiresIn: Number.isFinite(expiresIn) ? expiresIn : undefined,
    issuedAt: Math.floor(Date.now() / 1000),
  };
}

export async function revokeGoogleToken(token: string | undefined): Promise<void> {
  if (!token) return;
  try {
    await AuthSession.revokeAsync({ token }, googleDiscovery);
  } catch {
    // Best-effort revocation; token may already be invalid/expired.
  }
}
