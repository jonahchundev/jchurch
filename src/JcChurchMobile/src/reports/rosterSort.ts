import type { Member } from "../api/types";

// Ordering for the checked-in roster, mirroring the Members list sort: when a created-date
// sort is selected the member's creation date decides first (members without one always sort
// last, matching the API's two-phase member query), then last name, first name, and id break
// ties in the requested name direction. Members that failed to load (undefined) sort by empty
// names, so they land at the top in ascending order rather than disappearing.
export function compareRosterMembers(
  left: Member | undefined,
  right: Member | undefined,
  nameSort: string,
  createdOnSort: string,
): number {
  if (createdOnSort) {
    const leftOn = left?.createdOn ?? "";
    const rightOn = right?.createdOn ?? "";
    if (leftOn !== rightOn) {
      if (!leftOn) return 1;
      if (!rightOn) return -1;
      return createdOnSort === "newest"
        ? rightOn.localeCompare(leftOn)
        : leftOn.localeCompare(rightOn);
    }
  }
  const direction = nameSort === "desc" ? -1 : 1;
  const name =
    (left?.lastName ?? "").localeCompare(right?.lastName ?? "", undefined, { sensitivity: "base" }) ||
    (left?.firstName ?? "").localeCompare(right?.firstName ?? "", undefined, { sensitivity: "base" }) ||
    (left?.id ?? "").localeCompare(right?.id ?? "");
  return direction * name;
}
