import type { components } from "./generated";

type Schemas = components["schemas"];
export type Document = Schemas["Document"];
export type Church = Document & Schemas["ChurchInput"];
export type Group = Document & Schemas["GroupInput"];
export type CustomField = Document & Schemas["CustomFieldInput"];
export type MemberInput = Schemas["MemberInput"];
export type Member = Document & MemberInput;
export type EventInput = Schemas["EventInput"];
export type ChurchEvent = Document & EventInput;
export type Occurrence = Document &
  Schemas["OccurrenceOverride"] & { eventId: string; overridden: boolean };
export type OccurrenceCheckInCount = Schemas["OccurrenceCheckInCount"];
export type AttendanceSummaryRow = Schemas["AttendanceSummaryRow"];
export type Attendance = Document & {
  eventId: string;
  occurrenceId: string;
  memberId: string;
  checkedInAt: string;
  groupIds: string[];
  inclusiveGroupIds: string[];
};
export type Page<T> = { items: T[]; continuationToken: string | null };
export type Filters = Record<string, string | number | boolean | undefined>;
export type ScanResult = {
  member: Schemas["ScanMember"];
  receipt: Attendance;
  already: boolean;
};
export type ScanStatus = {
  member: Schemas["ScanMember"];
  checkedIn: boolean;
  receipt: Attendance | null;
};
export type MemberImportRow = Schemas["MemberImportRow"];
export type MemberImportRowResult = Schemas["MemberImportRowResult"];
export type MemberImportResult = Schemas["MemberImportResult"];
export type GroupImportRow = Schemas["GroupImportRow"];
export type GroupImportRowResult = Schemas["GroupImportRowResult"];
export type GroupImportResult = Schemas["GroupImportResult"];

// User-management types are hand-authored to mirror the backend User document
// (UserInput schema); kept vitest-importable (no react-native imports here).
export type AppRole = "global-admin" | "church-admin" | "user";
export type UserStatus = "invited" | "active";
export type UserInput = {
  email: string;
  role: AppRole;
  churchIds: string[];
  displayName?: string | null;
  invitedBy?: string;
};
export type User = Document &
  UserInput & { status: UserStatus; claimedOn?: string | null };
