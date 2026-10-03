import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import {
  isValidTemporaryAdminCredentials,
  temporaryAdminSessionKey,
  temporaryAdminSessionValue,
} from "./temporary-auth";
import {
  revokeGoogleToken,
  type GoogleTokens,
  type GoogleUserProfile,
} from "./google-auth";

export type AuthUser = {
  provider: "google" | "admin";
  email?: string;
  name?: string;
  picture?: string;
};

type StoredSession = {
  provider: "google" | "admin";
  user?: GoogleUserProfile;
  tokens?: GoogleTokens;
};

const sessionKey = "jchurch:auth-session:v1";

type AuthContextValue = {
  ready: boolean;
  authenticated: boolean;
  user: AuthUser | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  completeGoogleSignIn: (profile: GoogleUserProfile, tokens: GoogleTokens) => Promise<boolean>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// SecureStore is unavailable on web — fall back to AsyncStorage (XSS-exposed;
// acceptable for the current synthetic-data posture, revisit before real data).
const storage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === "web") return AsyncStorage.getItem(key);
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return AsyncStorage.getItem(key);
    }
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") return AsyncStorage.setItem(key, value);
    try {
      return await SecureStore.setItemAsync(key, value);
    } catch {
      return AsyncStorage.setItem(key, value);
    }
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === "web") return AsyncStorage.removeItem(key);
    try {
      return await SecureStore.deleteItemAsync(key);
    } catch {
      return AsyncStorage.removeItem(key);
    }
  },
};

function sessionToUser(session: StoredSession): AuthUser {
  return {
    provider: session.provider,
    email: session.user?.email,
    name: session.user?.name,
    picture: session.user?.picture,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<StoredSession | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const raw = await storage.get(sessionKey);
        if (raw) {
          setSession(JSON.parse(raw) as StoredSession);
          return;
        }
        // Migrate legacy temporary-admin marker to an admin session.
        const legacy = await AsyncStorage.getItem(temporaryAdminSessionKey);
        if (legacy === temporaryAdminSessionValue) {
          const migrated: StoredSession = { provider: "admin" };
          await storage.set(sessionKey, JSON.stringify(migrated));
          await AsyncStorage.removeItem(temporaryAdminSessionKey);
          setSession(migrated);
        }
      } catch {
        setSession(null);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    ready,
    authenticated: !!session,
    user: session ? sessionToUser(session) : null,
    login: async (username, password) => {
      if (!isValidTemporaryAdminCredentials(username, password)) return false;
      try {
        const next: StoredSession = { provider: "admin" };
        await storage.set(sessionKey, JSON.stringify(next));
        setSession(next);
        return true;
      } catch {
        return false;
      }
    },
    completeGoogleSignIn: async (profile, tokens) => {
      try {
        const next: StoredSession = { provider: "google", user: profile, tokens };
        await storage.set(sessionKey, JSON.stringify(next));
        setSession(next);
        return true;
      } catch {
        return false;
      }
    },
    logout: async () => {
      try {
        await revokeGoogleToken(session?.tokens?.accessToken);
      } finally {
        try {
          await storage.remove(sessionKey);
          await AsyncStorage.removeItem(temporaryAdminSessionKey);
        } finally {
          setSession(null);
        }
      }
    },
  }), [ready, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}