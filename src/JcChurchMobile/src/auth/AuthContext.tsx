import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  isValidTemporaryAdminCredentials,
  temporaryAdminSessionKey,
  temporaryAdminSessionValue,
} from "./temporary-auth";

type AuthContextValue = {
  ready: boolean;
  authenticated: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    void AsyncStorage.getItem(temporaryAdminSessionKey)
      .then((value) => setAuthenticated(value === temporaryAdminSessionValue))
      .catch(() => setAuthenticated(false))
      .finally(() => setReady(true));
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    ready,
    authenticated,
    login: async (username, password) => {
      if (!isValidTemporaryAdminCredentials(username, password)) return false;
      try {
        await AsyncStorage.setItem(temporaryAdminSessionKey, temporaryAdminSessionValue);
        setAuthenticated(true);
        return true;
      } catch {
        return false;
      }
    },
    logout: async () => {
      try {
        await AsyncStorage.removeItem(temporaryAdminSessionKey);
      } finally {
        setAuthenticated(false);
      }
    },
  }), [authenticated, ready]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}