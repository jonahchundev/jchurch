import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/hooks";
import type { User } from "../api/types";
import { ApiError } from "../api/client";
import { isGlobalAdmin, resolveRole, type RoleInfo } from "./roles";
import { useAuth } from "./AuthContext";

type RoleContextValue = {
  roleReady: boolean;
  roleInfo: RoleInfo;
};

const RoleContext = createContext<RoleContextValue>({
  roleReady: false,
  roleInfo: { kind: "unprovisioned" },
});

export function useRole() {
  return useContext(RoleContext);
}

export function RoleProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, user } = useAuth();
  const client = useQueryClient();
  const email = user?.provider === "google" ? user.email?.trim().toLowerCase() : undefined;
  const needsRecord = ready && authenticated && !!email && !isGlobalAdmin(user);

  const query = useQuery<User | null>({
    queryKey: ["/users", email],
    enabled: needsRecord,
    queryFn: async ({ signal }) => {
      try {
        return await api.get<User>(`/users/${encodeURIComponent(email!)}`, signal);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });

  const record = query.data ?? null;
  const claim = useMutation({
    mutationFn: async () => (await api.request<User>(`/users/${encodeURIComponent(email!)}/claim`, { method: "POST" })).data,
    onSuccess: () => void client.invalidateQueries({ queryKey: ["/users", email] }),
  });

  // After sign-in, claim the invite the first time we see a still-invited record.
  if (needsRecord && record && record.status === "invited" && !claim.isPending && !claim.isSuccess) {
    claim.mutate();
  }

  const value = useMemo<RoleContextValue>(() => {
    if (!ready || !authenticated) return { roleReady: false, roleInfo: { kind: "unprovisioned" } };
    if (isGlobalAdmin(user)) {
      return { roleReady: true, roleInfo: { kind: "global-admin", role: "global-admin", churchIds: [] } };
    }
    if (needsRecord && query.isPending) return { roleReady: false, roleInfo: { kind: "unprovisioned" } };
    return { roleReady: true, roleInfo: resolveRole(user, record) };
  }, [ready, authenticated, user, needsRecord, query.isPending, record]);

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}
