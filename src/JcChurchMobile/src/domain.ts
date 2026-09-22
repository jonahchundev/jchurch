import { DateTime } from "luxon";
import { z } from "zod";
import type { CustomField, MemberInput } from "./api/types";

export const nameSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
});
export const eventSchema = nameSchema
  .extend({
    localStart: z
      .string()
      .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
        "Choose a local date and time.",
      ),
    timeZone: z.string().min(1, "Timezone is required.").max(100),
    durationMinutes: z
      .string()
      .refine(
        (value) =>
          /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 10080,
        "Duration must be 1 to 10080 minutes.",
      ),
    recurrenceRule: z.string().max(500),
  })
  .superRefine((values, context) => {
    try {
      localToUtc(values.localStart, values.timeZone);
    } catch {
      context.addIssue({
        code: "custom",
        path: ["localStart"],
        message: "Choose a valid, unambiguous date/time and timezone.",
      });
    }
    const year = Number(values.localStart.slice(0, 4));
    if (year < 2000 || year > 2100)
      context.addIssue({
        code: "custom",
        path: ["localStart"],
        message: "Year must be between 2000 and 2100.",
      });
  });
export type EventFormValues = z.infer<typeof eventSchema>;
export const usTimeZones = [
  { value: "America/New_York", label: "Eastern Time (America/New_York)" },
  { value: "America/Chicago", label: "Central Time (America/Chicago)" },
  { value: "America/Denver", label: "Mountain Time (America/Denver)" },
  { value: "America/Phoenix", label: "Arizona Time (America/Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific Time (America/Los_Angeles)" },
  { value: "America/Anchorage", label: "Alaska Time (America/Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii Time (Pacific/Honolulu)" },
  { value: "UTC", label: "UTC" },
];
export function timeZoneLabel(timeZone: string) {
  return usTimeZones.find((option) => option.value === timeZone)?.label.replace(
    / \([^)]*\)$/,
    "",
  ) ?? timeZone;
}
export function describeRecurrence(rule: string | null | undefined) {
  if (!rule) return "One-time";
  const frequency = /(?:^|;)FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(?:;|$)/.exec(rule)?.[1];
  const interval = Number(/(?:^|;)INTERVAL=(\d+)(?:;|$)/.exec(rule)?.[1] ?? "1");
  if (!frequency || !Number.isInteger(interval) || interval < 1) return "Recurring";
  const unit = {
    DAILY: "day",
    WEEKLY: "week",
    MONTHLY: "month",
    YEARLY: "year",
  }[frequency];
  return interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
}
const optionalText = (max: number) => z.string().max(max);
export function normalizeScanCode(value: string): string {
  const code = value.trim();
  if (value.length > 128 || !/^[A-Za-z0-9-]{8,64}$/.test(code))
    throw new Error("Use 8-64 letters, digits, or hyphens for the scan code.");
  return code.toUpperCase();
}
export const memberSchema = z.object({
  scanCode: z.string().max(128).refine(value => {
    if (!value.trim()) return true;
    try { normalizeScanCode(value); return true; } catch { return false; }
  }, "Use 8-64 letters, digits, or hyphens for the scan code.").optional(),
  scanCodeFormat: z.enum(["qr", "code128"]).optional(),
  firstName: z.string().trim().min(1, "First name is required.").max(200),
  lastName: z.string().trim().min(1, "Last name is required.").max(200),
  middleName: optionalText(200),
  school: optionalText(200),
  phone: optionalText(50),
  email: z.union([z.literal(""), z.string().email().max(254)]),
  birthDate: z
    .string()
    .refine(
      (value) =>
        !value ||
        (DateTime.fromISO(value).isValid &&
          /^\d{4}-\d{2}-\d{2}$/.test(value) &&
          value <= DateTime.utc().toISODate()!),
      "Choose a valid birth date that is not in the future.",
    ),
  groupIds: z.array(z.string()).max(50),
  customFields: z.record(z.string(), z.unknown()),
});
export type MemberFormValues = z.infer<typeof memberSchema>;

export function memberInput(
  values: MemberFormValues,
  definitions: CustomField[],
): MemberInput {
  const customFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values.customFields)) {
    if (value === "" || value === null || value === undefined) continue;
    const field = definitions.find((item) => item.id === key);
    if (!field)
      throw new Error(
        "Custom field definitions changed. Reload and review the member.",
      );
    if (field.fieldType === "number") {
      if (!Number.isFinite(Number(value)))
        throw new Error(`${field.name} must be a number.`);
      customFields[key] = Number(value);
    } else if (field.fieldType === "boolean") {
      if (typeof value !== "boolean")
        throw new Error(`${field.name} must be yes or no.`);
      customFields[key] = value;
    } else if (field.fieldType === "date") {
      if (
        typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !DateTime.fromISO(value).isValid
      )
        throw new Error(`${field.name} must be a valid date.`);
      customFields[key] = value;
    } else {
      if (typeof value !== "string" || value.length > 1000)
        throw new Error(
          `${field.name} must be text of at most 1000 characters.`,
        );
      customFields[key] = value;
    }
  }
  return {
    ...values,
    ...(values.scanCode !== undefined ? {
      scanCode: values.scanCode.trim() ? normalizeScanCode(values.scanCode) : null,
      scanCodeFormat: values.scanCode.trim() ? values.scanCodeFormat ?? "qr" : null,
    } : {}),
    middleName: values.middleName || null,
    school: values.school || null,
    phone: values.phone || null,
    email: values.email || null,
    birthDate: values.birthDate || null,
    customFields,
  };
}

export function localToUtc(local: string, zone: string): string {
  const parsed = DateTime.fromISO(local, { zone });
  if (
    !parsed.isValid ||
    parsed.toFormat("yyyy-MM-dd'T'HH:mm") !== local.slice(0, 16) ||
    parsed.getPossibleOffsets().length !== 1
  ) {
    throw new Error(
      "Choose an existing, unambiguous time in the selected timezone.",
    );
  }
  return parsed.toUTC().toISO()!;
}

export function sessionTime(value: string, zone: string) {
  return DateTime.fromISO(value)
    .setZone(zone)
    .toFormat("ccc, LLL d, yyyy · h:mm a");
}

export function memberAge(birthDate: string | null | undefined) {
  if (!birthDate) return null;
  const birth = DateTime.fromISO(birthDate);
  if (!birth.isValid) return null;
  const years = Math.floor(DateTime.now().diff(birth, "years").years);
  return years >= 0 ? years : null;
}

export function attendanceRange(day: string) {
  const date = DateTime.fromISO(day, { zone: "utc" }).startOf("day");
  if (!date.isValid || !/^\d{4}-\d{2}-\d{2}$/.test(day))
    throw new Error("Choose a valid attendance date.");
  return { from: date.toISO()!, to: date.plus({ days: 1 }).toISO()! };
}
