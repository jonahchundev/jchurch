// Must stay in sync with the fixed CSV column schema in src/jchurchFunction/Services/MemberCsvService.cs
import type { GroupImportRow, MemberImportRow } from "./api/types";

export const MEMBER_CSV_FIXED_COLUMNS = [
  "Id",
  "MemberType",
  "FirstName",
  "MiddleName",
  "LastName",
  "BirthDate",
  "School",
  "Phone",
  "Email",
  "AllergyDetail",
  "Groups",
  "Guardian1FirstName",
  "Guardian1MiddleName",
  "Guardian1LastName",
  "Guardian1Relationship",
  "Guardian1OtherRelationship",
  "Guardian1Phone",
  "Guardian1Email",
  "Guardian2FirstName",
  "Guardian2MiddleName",
  "Guardian2LastName",
  "Guardian2Relationship",
  "Guardian2OtherRelationship",
  "Guardian2Phone",
  "Guardian2Email",
] as const;

const FIXED_COLUMN_SET = new Set<string>(MEMBER_CSV_FIXED_COLUMNS);

// Any CSV column not in the fixed set is treated as a custom field, keyed by its Name.
export function splitImportRow(row: Record<string, string>): MemberImportRow {
  const customFields: Record<string, string> = {};
  for (const [column, value] of Object.entries(row)) {
    if (!FIXED_COLUMN_SET.has(column) && value !== "") customFields[column] = value;
  }
  const memberType = row.MemberType === "child" || row.MemberType === "adult" ? row.MemberType : undefined;
  return {
    id: row.Id || undefined,
    memberType,
    firstName: row.FirstName || undefined,
    middleName: row.MiddleName || undefined,
    lastName: row.LastName || undefined,
    birthDate: row.BirthDate || undefined,
    school: row.School || undefined,
    phone: row.Phone || undefined,
    email: row.Email || undefined,
    allergyDetail: row.AllergyDetail || undefined,
    groups: row.Groups || undefined,
    guardian1FirstName: row.Guardian1FirstName || undefined,
    guardian1MiddleName: row.Guardian1MiddleName || undefined,
    guardian1LastName: row.Guardian1LastName || undefined,
    guardian1Relationship: row.Guardian1Relationship || undefined,
    guardian1OtherRelationship: row.Guardian1OtherRelationship || undefined,
    guardian1Phone: row.Guardian1Phone || undefined,
    guardian1Email: row.Guardian1Email || undefined,
    guardian2FirstName: row.Guardian2FirstName || undefined,
    guardian2MiddleName: row.Guardian2MiddleName || undefined,
    guardian2LastName: row.Guardian2LastName || undefined,
    guardian2Relationship: row.Guardian2Relationship || undefined,
    guardian2OtherRelationship: row.Guardian2OtherRelationship || undefined,
    guardian2Phone: row.Guardian2Phone || undefined,
    guardian2Email: row.Guardian2Email || undefined,
    customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
  };
}

// Must stay in sync with the fixed CSV column schema in src/jchurchFunction/Services/GroupCsvService.cs
export const GROUP_CSV_FIXED_COLUMNS = ["Id", "Name", "ParentName"] as const;

export function splitGroupImportRow(row: Record<string, string>): GroupImportRow {
  return {
    id: row.Id || undefined,
    name: row.Name || undefined,
    parentName: row.ParentName || undefined,
  };
}
