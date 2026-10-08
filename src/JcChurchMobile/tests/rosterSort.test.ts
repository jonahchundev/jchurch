import { describe, expect, it } from "vitest";
import { compareRosterMembers } from "../src/reports/rosterSort";
import type { Member } from "../src/api/types";

let sequence = 0;
function member(overrides: Partial<Member>): Member {
  sequence += 1;
  return {
    id: `member_${sequence}`,
    churchId: "church",
    kind: "Member",
    active: true,
    memberType: "adult",
    firstName: "John",
    lastName: "Smith",
    ...overrides,
  } as Member;
}

function sorted(members: (Member | undefined)[], nameSort = "asc", createdOnSort = "") {
  return [...members].sort((left, right) => compareRosterMembers(left, right, nameSort, createdOnSort));
}

describe("compareRosterMembers", () => {
  it("orders by last name then first name, case-insensitive", () => {
    const adam = member({ firstName: "Adam", lastName: "Zimmerman" });
    const beth = member({ firstName: "beth", lastName: "yates" });
    const carl = member({ firstName: "Carl", lastName: "Yates" });
    expect(sorted([adam, carl, beth])).toEqual([beth, carl, adam]);
  });

  it("reverses name order for desc", () => {
    const adam = member({ firstName: "Adam", lastName: "Adams" });
    const zoe = member({ firstName: "Zoe", lastName: "Zimmer" });
    expect(sorted([adam, zoe], "desc")).toEqual([zoe, adam]);
  });

  it("breaks full-name ties by id", () => {
    const second = member({ id: "member_b", firstName: "Sam", lastName: "Lee" });
    const first = member({ id: "member_a", firstName: "Sam", lastName: "Lee" });
    expect(sorted([second, first])).toEqual([first, second]);
  });

  it("sorts by creation date first when selected, with name tie-break", () => {
    const oldest = member({ firstName: "Zoe", lastName: "Zimmer", createdOn: "2026-01-01T00:00:00Z" });
    const newest = member({ firstName: "Adam", lastName: "Adams", createdOn: "2026-09-01T00:00:00Z" });
    const middle = member({ firstName: "Beth", lastName: "Young", createdOn: "2026-05-01T00:00:00Z" });
    expect(sorted([oldest, newest, middle], "asc", "newest")).toEqual([newest, middle, oldest]);
    expect(sorted([newest, oldest, middle], "asc", "oldest")).toEqual([oldest, middle, newest]);
  });

  it("keeps members without a creation date last in both date directions", () => {
    const dated = member({ firstName: "Adam", lastName: "Adams", createdOn: "2026-01-01T00:00:00Z" });
    const undated = member({ firstName: "Aaa", lastName: "Aaa", createdOn: null });
    expect(sorted([undated, dated], "asc", "newest")).toEqual([dated, undated]);
    expect(sorted([undated, dated], "asc", "oldest")).toEqual([dated, undated]);
  });

  it("sorts rows with unloaded members by empty name without crashing", () => {
    // Mirrors component usage: rows wrap the member, so undefined members reach the comparator
    // (Array.prototype.sort never passes raw undefined elements to comparators).
    const loaded = member({ firstName: "Zoe", lastName: "Zimmer" });
    const rows = [{ member: loaded }, { member: undefined }];
    const ascending = [...rows].sort((left, right) => compareRosterMembers(left.member, right.member, "asc", ""));
    expect(ascending.map((row) => row.member)).toEqual([undefined, loaded]);
    const descending = [...rows].sort((left, right) => compareRosterMembers(left.member, right.member, "desc", ""));
    expect(descending.map((row) => row.member)).toEqual([loaded, undefined]);
  });
});
