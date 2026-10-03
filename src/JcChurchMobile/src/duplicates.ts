import type { Member } from "./api/types";

// Pure duplicate-candidate detection — kept import-free of react-native so vitest can run it.
// A pair is a candidate when two members share a normalized first+last name AND at least one
// contact point (email or phone) drawn from the member OR either of their guardians.

export type ContactPoints = { emails: Set<string>; phones: Set<string> };

export type CandidatePair = {
  a: Member;
  b: Member;
  // Which contact kinds matched, e.g. ["email", "phone"].
  reasons: ("email" | "phone")[];
};

function normalizeEmail(value?: string | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function normalizePhone(value?: string | null): string | null {
  const digits = value?.replace(/\D+/g, "");
  return digits ? digits : null;
}

/** Collect every contact point for a member and their guardians. */
export function contactPoints(member: Member): ContactPoints {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const add = (email?: string | null, phone?: string | null) => {
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizePhone(phone);
    if (normalizedEmail) emails.add(normalizedEmail);
    if (normalizedPhone) phones.add(normalizedPhone);
  };
  add(member.email, member.phone);
  add(member.guardian1?.email, member.guardian1?.phone);
  add(member.guardian2?.email, member.guardian2?.phone);
  return { emails, phones };
}

function nameKey(member: Member): string {
  return `${member.firstName?.trim().toLowerCase() ?? ""} ${member.lastName?.trim().toLowerCase()}`.trim();
}

function intersection<T>(left: Set<T>, right: Set<T>): boolean {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

/**
 * Find candidate duplicate pairs. Same normalized first+last name AND >=1 shared contact point
 * (member or guardian email/phone). Members with no contact info never pair. Results are sorted
 * by number of match reasons (desc), then by name.
 */
export function findDuplicateCandidates(members: Member[]): CandidatePair[] {
  const active = members.filter((member) => member.active !== false);
  const byName = new Map<string, Member[]>();
  for (const member of active) {
    const key = nameKey(member);
    if (!key) continue;
    const bucket = byName.get(key) ?? [];
    bucket.push(member);
    byName.set(key, bucket);
  }
  const pairs: CandidatePair[] = [];
  for (const bucket of byName.values()) {
    if (bucket.length < 2) continue;
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i]!;
        const b = bucket[j]!;
        const aPoints = contactPoints(a);
        const bPoints = contactPoints(b);
        const reasons: ("email" | "phone")[] = [];
        if (intersection(aPoints.emails, bPoints.emails)) reasons.push("email");
        if (intersection(aPoints.phones, bPoints.phones)) reasons.push("phone");
        if (reasons.length === 0) continue;
        pairs.push({ a, b, reasons });
      }
    }
  }
  pairs.sort((left, right) => {
    if (right.reasons.length !== left.reasons.length) return right.reasons.length - left.reasons.length;
    const leftName = nameKey(left.a);
    const rightName = nameKey(right.a);
    return leftName.localeCompare(rightName);
  });
  return pairs;
}

/** Human-readable match explanation, e.g. "Same name · matching guardian phone". */
export function matchReasonText(pair: CandidatePair): string {
  const parts = pair.reasons.map((reason) => (reason === "email" ? "matching email" : "matching phone"));
  return ["Same name", ...parts].join(" · ");
}
