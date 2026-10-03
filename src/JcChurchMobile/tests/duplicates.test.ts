import { describe, expect, it } from "vitest";
import { contactPoints, findDuplicateCandidates, matchReasonText } from "../src/duplicates";
import type { Member } from "../src/api/types";

let sequence = 0;
function member(overrides: Partial<Member>): Member {
  sequence += 1;
  return {
    id: `member_${sequence}`,
    churchId: "church",
    kind: "Member",
    _etag: `"${sequence}"`,
    active: true,
    memberType: "adult",
    firstName: "John",
    lastName: "Smith",
    ...overrides,
  } as Member;
}

describe("contactPoints", () => {
  it("collects member and guardian emails and phones, normalized", () => {
    const points = contactPoints(
      member({
        email: "  JOHN@X.COM ",
        phone: "(425) 555-1234",
        guardian1: { firstName: "Jane", lastName: "Smith", relationship: "Mother", phone: "425.555.9999", email: "jane@x.com" },
      }),
    );
    expect(points.emails.has("john@x.com")).toBe(true);
    expect(points.emails.has("jane@x.com")).toBe(true);
    expect(points.phones.has("4255551234")).toBe(true);
    expect(points.phones.has("4255559999")).toBe(true);
  });

  it("omits blank contact info", () => {
    const points = contactPoints(member({ email: "  ", phone: "" }));
    expect(points.emails.size).toBe(0);
    expect(points.phones.size).toBe(0);
  });
});

describe("findDuplicateCandidates", () => {
  it("pairs members with the same name and a shared email", () => {
    const a = member({ email: "shared@x.com" });
    const b = member({ email: "shared@x.com" });
    const pairs = findDuplicateCandidates([a, b]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.reasons).toEqual(["email"]);
    expect(matchReasonText(pairs[0]!)).toBe("Same name · matching email");
  });

  it("matches via a shared guardian phone even when member contact info differs", () => {
    const a = member({ guardian1: { firstName: "Jane", lastName: "Smith", relationship: "Mother", phone: "425-555-1234", email: "" } });
    const b = member({ guardian1: { firstName: "J", lastName: "Smith", relationship: "Mother", phone: "(425) 555-1234", email: "" } });
    const pairs = findDuplicateCandidates([a, b]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.reasons).toEqual(["phone"]);
  });

  it("reports both reasons when email and phone match", () => {
    const a = member({ email: "s@x.com", phone: "4255551234" });
    const b = member({ email: "s@x.com", phone: "425 555 1234" });
    expect(findDuplicateCandidates([a, b])[0]!.reasons).toEqual(["email", "phone"]);
  });

  it("does not pair the same name with no shared contact point", () => {
    const a = member({ email: "a@x.com" });
    const b = member({ email: "b@x.com" });
    expect(findDuplicateCandidates([a, b])).toHaveLength(0);
  });

  it("does not pair members with no contact info at all", () => {
    const a = member({});
    const b = member({});
    expect(findDuplicateCandidates([a, b])).toHaveLength(0);
  });

  it("does not pair different names even with a shared email", () => {
    const a = member({ firstName: "John", lastName: "Smith", email: "shared@x.com" });
    const b = member({ firstName: "Jane", lastName: "Doe", email: "shared@x.com" });
    expect(findDuplicateCandidates([a, b])).toHaveLength(0);
  });

  it("ignores archived members", () => {
    const a = member({ email: "shared@x.com" });
    const b = member({ email: "shared@x.com", active: false });
    expect(findDuplicateCandidates([a, b])).toHaveLength(0);
  });

  it("sorts pairs with more match reasons first", () => {
    const both1 = member({ firstName: "Ann", lastName: "Lee", email: "ann@x.com", phone: "111" });
    const both2 = member({ firstName: "Ann", lastName: "Lee", email: "ann@x.com", phone: "111" });
    const one1 = member({ firstName: "Bob", lastName: "Ray", email: "bob@x.com" });
    const one2 = member({ firstName: "Bob", lastName: "Ray", email: "bob@x.com" });
    const pairs = findDuplicateCandidates([one1, one2, both1, both2]);
    expect(pairs[0]!.reasons).toEqual(["email", "phone"]);
    expect(pairs[1]!.reasons).toEqual(["email"]);
  });
});
