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
