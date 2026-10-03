import type { AppRole, Church, User } from "../api/types";

// Structural mirror of AuthContext's AuthUser, kept import-free so this module
// stays vitest-importable (AuthContext pulls in react-native / secure-store).
export type AuthIdentity = {
  provider: "google" | "admin";
  email?: string;
  name?: string;
  picture?: string;
};

export type RoleInfo =
  | { kind: "global-admin"; role: "global-admin"; churchIds: string[] }
  | { kind: "provisioned"; role: AppRole; churchIds: string[]; user: User }
  | { kind: "unprovisioned" };

// The temporary "admin" login is a built-in global admin with no backend record.
export function isGlobalAdmin(user: AuthIdentity | null): boolean {
  return user?.provider === "admin";
}

// Resolve the caller's role from their auth identity and (for Google users) the
// pre-provisioned user record. A 404 record means the email is not provisioned.
export function resolveRole(user: AuthIdentity | null, record: User | null | undefined): RoleInfo {
  if (isGlobalAdmin(user)) return { kind: "global-admin", role: "global-admin", churchIds: [] };
  if (!record || record.active === false) return { kind: "unprovisioned" };
  return { kind: "provisioned", role: record.role, churchIds: record.churchIds ?? [], user: record };
}

export function canManageUsers(info: RoleInfo): boolean {
  return info.kind === "global-admin" || (info.kind === "provisioned" && info.role === "church-admin");
}

// Churches a caller may see. Global admins see all; others see only assigned churches.
export function filterChurches(churches: Church[], info: RoleInfo): Church[] {
  if (info.kind === "global-admin") return churches;
  if (info.kind === "unprovisioned") return [];
  const allowed = new Set(info.churchIds);
  return churches.filter((church) => allowed.has(church.id));
}

// Churches an admin may assign when inviting. Global admins may assign any church;
// church admins may only assign their own churches.
export function assignableChurches(churches: Church[], info: RoleInfo): Church[] {
  return filterChurches(churches, info);
}

// Users visible in the management screen. Church admins see users whose churches
// intersect their own.
export function filterManagedUsers(users: User[], info: RoleInfo): User[] {
  if (info.kind === "global-admin") return users;
  if (info.kind !== "provisioned") return [];
  const own = new Set(info.churchIds);
  return users.filter((user) => (user.churchIds ?? []).some((id) => own.has(id)));
}
