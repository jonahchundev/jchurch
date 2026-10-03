import { expect, test, type Page } from "@playwright/test";
import { DateTime } from "luxon";
import path from "node:path";
import fs from "node:fs";

// Captures real app screenshots for the user guide (user-guide/images), using
// Arumdaun Presbyterian Church with the JHAFAM and AFAM groups and members from
// the real export (members CSV). Runs against the Expo web dev server on :8081
// with the API mocked, at an iPhone Pro Max viewport (see playwright.tablet.config.ts).

const IMG = path.resolve(process.cwd(), "../../user-guide/images");
fs.mkdirSync(IMG, { recursive: true });

const metadata = (id: string, churchId = id) => ({
  id,
  churchId,
  _etag: '"first"',
  active: true,
  kind: "Document",
  searchText: "",
});
const pageBody = (items: unknown[], continuationToken: string | null = null) => ({
  items,
  continuationToken,
});

const alpha = {
  ...metadata("church_arumdaun"),
  name: "Arumdaun Presbyterian Church",
  scanCodesEnabled: true,
  scanCodeFormat: "qr",
  newMemberDays: 30,
};
const beta = {
  ...metadata("church_beta"),
  name: "Beta Community",
  scanCodesEnabled: true,
  scanCodeFormat: "qr",
  newMemberDays: 30,
};
// Same church with QR/barcode scanning turned off — used for the member-detail
// screenshots so the guide shows no scan-code section or member cards.
const alphaNoScan = { ...alpha, scanCodesEnabled: false };

const groups = [
  { ...metadata("group_jhafam", alpha.id), name: "JHAFAM", parentGroupId: null },
  { ...metadata("group_afam", alpha.id), name: "AFAM", parentGroupId: null },
];

const customFields = [
  {
    ...metadata("field_volunteer", alpha.id),
    name: "Volunteer role",
    fieldType: "text",
  },
];

const zone = "America/New_York";
const todayZone = DateTime.now().setZone(zone).startOf("day");
const sessionStart = (weeksAgo: number) =>
  todayZone.minus({ weeks: weeksAgo }).set({ hour: 9, minute: 30 });

// Members taken from the real export (members CSV), JHAFAM unless noted.
const emma = {
  ...metadata("member_emma_choi", alpha.id),
  memberType: "child",
  firstName: "Emma",
  lastName: "Choi",
  gender: "Female",
  birthDate: "2014-11-05",
  school: "Syosset - HBT MS",
  phone: "516-712-9404",
  email: "emmammchoi@gmail.com",
  groupIds: ["group_jhafam"],
  guardian1: {
    firstName: "Inna",
    lastName: "Choi",
    relationship: "Mother",
    phone: "516-551-2994",
    email: "innaryu@gmail.com",
  },
  customFields: {},
  scanCode: "JHAFAM-EMMA-01",
  imageVersion: "1",
  createdOn: DateTime.now().minus({ days: 5 }).toISO(),
};
const chelsea = {
  ...metadata("member_chelsea_chun", alpha.id),
  memberType: "child",
  firstName: "Chelsea",
  lastName: "Chun",
  gender: "Female",
  birthDate: "2013-11-09",
  school: "Jericho Middle School",
  phone: "516-552-8873",
  email: "chelseayowaimo@gmail.com",
  groupIds: ["group_jhafam"],
  guardian1: {
    firstName: "Esther",
    lastName: "Chun",
    relationship: "Mother",
    phone: "646-287-2125",
    email: "estherkim01@gmail.com",
  },
  guardian2: {
    firstName: "Jonah",
    lastName: "Chun",
    relationship: "Father",
    phone: "646-331-0819",
    email: "jonahchun@gmail.com",
  },
  customFields: {},
  createdOn: DateTime.now().minus({ days: 120 }).toISO(),
};
const adam = {
  ...metadata("member_adam_kim", alpha.id),
  memberType: "child",
  firstName: "Adam",
  lastName: "Kim",
  gender: "Male",
  birthDate: "2013-06-24",
  school: "JFK Middle School",
  phone: "917-294-9929",
  email: "adamkimbap@gmail.com",
  allergyDetail: "Peanuts, Tree nuts",
  groupIds: ["group_jhafam"],
  guardian1: {
    firstName: "Esther",
    lastName: "Kim",
    relationship: "Mother",
    phone: "917-750-7353",
    email: "estherlee84@gmail.com",
  },
  customFields: {},
  createdOn: DateTime.now().minus({ days: 300 }).toISO(),
};
const joanne = {
  ...metadata("member_joanne_chae", alpha.id),
  memberType: "child",
  firstName: "Joanne",
  lastName: "Chae",
  gender: "Female",
  birthDate: "2014-03-28",
  school: "West Hollow",
  groupIds: ["group_jhafam"],
  guardian1: {
    firstName: "Jihee",
    lastName: "Chae",
    relationship: "Mother",
    phone: "718-517-0813",
    email: "jiheekim79@gmail.com",
  },
  guardian2: {
    firstName: "John",
    lastName: "Chae",
    relationship: "Father",
    phone: "917-584-0898",
    email: "emailchae@gmail.com",
  },
  customFields: {},
  createdOn: DateTime.now().minus({ days: 200 }).toISO(),
};
const paul = {
  ...metadata("member_paul_choi", alpha.id),
  memberType: "adult",
  firstName: "Paul",
  lastName: "Choi",
  gender: "Male",
  birthDate: "1978-03-09",
  groupIds: ["group_jhafam"],
  customFields: {},
  createdOn: DateTime.now().minus({ days: 500 }).toISO(),
};
const jayden = {
  ...metadata("member_jayden_han", alpha.id),
  memberType: "child",
  firstName: "Jayden",
  lastName: "Han",
  gender: "Male",
  birthDate: "2012-05-08",
  school: "POB JFK High School",
  groupIds: ["group_afam"],
  guardian1: {
    firstName: "Jungwon",
    lastName: "Han",
    relationship: "Mother",
    phone: "917-617-9589",
    email: "treejw124@gmail.com",
  },
  guardian2: {
    firstName: "Alex",
    lastName: "Han",
    relationship: "Father",
    phone: "718-427-0717",
    email: "treejwms@gmail.com",
  },
  customFields: {},
  createdOn: DateTime.now().minus({ days: 90 }).toISO(),
};
const members = [emma, chelsea, adam, joanne, paul, jayden];

const jhafamClass = {
  ...metadata("event_jhafam", alpha.id),
  name: "JHAFAM Class",
  localStart: sessionStart(8).toFormat("yyyy-LL-dd'T'HH:mm:ss"),
  timeZone: zone,
  durationMinutes: 60,
  recurrenceRule: "FREQ=WEEKLY",
  groupIds: ["group_jhafam"],
};
const sundayService = {
  ...metadata("event_sunday", alpha.id),
  name: "Sunday Service",
  localStart: sessionStart(8).set({ hour: 10 }).toFormat("yyyy-LL-dd'T'HH:mm:ss"),
  timeZone: zone,
  durationMinutes: 90,
  recurrenceRule: "FREQ=WEEKLY",
  groupIds: [],
};
const events = [jhafamClass, sundayService];

const occurrence = (eventId: string, id: string, start: DateTime) => ({
  ...metadata(id, alpha.id),
  eventId,
  startsAt: start.toUTC().toISO(),
  endsAt: start.plus({ minutes: 60 }).toUTC().toISO(),
  cancelled: false,
  archived: false,
  overridden: false,
});
const jhafamOccurrences = [
  occurrence(jhafamClass.id, "occ_jhafam_w4", sessionStart(4)),
  occurrence(jhafamClass.id, "occ_jhafam_w3", sessionStart(3)),
  occurrence(jhafamClass.id, "occ_jhafam_w2", sessionStart(2)),
  occurrence(jhafamClass.id, "occ_jhafam_w1", sessionStart(1)),
  occurrence(jhafamClass.id, "occ_jhafam_today", sessionStart(0)),
];
const sundayOccurrences = [
  occurrence(sundayService.id, "occ_sun_w1", sessionStart(1).set({ hour: 10 })),
  occurrence(sundayService.id, "occ_sun_today", sessionStart(0).set({ hour: 10 })),
];
const allOccurrences = [...jhafamOccurrences, ...sundayOccurrences];

let receiptSeq = 0;
// Member fixtures vary in shape; the receipt factory only reads id + groupIds.
type ReceiptMember = { id: string; groupIds?: string[] };
const receipt = (occId: string, eventId: string, member: ReceiptMember, start: DateTime) => {
  receiptSeq += 1;
  const groupIds = member.groupIds ?? [];
  return {
    ...metadata(`receipt_${receiptSeq}`, alpha.id),
    eventId,
    occurrenceId: occId,
    memberId: member.id,
    checkedInAt: start.plus({ minutes: 8 + receiptSeq }).toUTC().toISO(),
    groupIds,
    inclusiveGroupIds: groupIds,
  };
};
const receipts = [
  receipt("occ_jhafam_w4", jhafamClass.id, emma, sessionStart(4)),
  receipt("occ_jhafam_w4", jhafamClass.id, chelsea, sessionStart(4)),
  receipt("occ_jhafam_w3", jhafamClass.id, emma, sessionStart(3)),
  receipt("occ_jhafam_w3", jhafamClass.id, adam, sessionStart(3)),
  receipt("occ_jhafam_w3", jhafamClass.id, chelsea, sessionStart(3)),
  receipt("occ_jhafam_w2", jhafamClass.id, emma, sessionStart(2)),
  receipt("occ_jhafam_w2", jhafamClass.id, adam, sessionStart(2)),
  receipt("occ_jhafam_w2", jhafamClass.id, chelsea, sessionStart(2)),
  receipt("occ_jhafam_w2", jhafamClass.id, joanne, sessionStart(2)),
  receipt("occ_jhafam_w1", jhafamClass.id, emma, sessionStart(1)),
  receipt("occ_jhafam_w1", jhafamClass.id, chelsea, sessionStart(1)),
  receipt("occ_jhafam_today", jhafamClass.id, adam, sessionStart(0)),
  receipt("occ_sun_w1", sundayService.id, paul, sessionStart(1)),
  receipt("occ_sun_w1", sundayService.id, jayden, sessionStart(1)),
];
const counts = allOccurrences.map((occ) => ({
  occurrenceId: occ.id,
  checkedInCount: receipts.filter((r) => r.occurrenceId === occ.id).length,
}));

const pngPixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function mockApi(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    const fulfill = (body: unknown) => route.fulfill({ json: body });
    const notFound = () =>
      route.fulfill({ status: 404, json: { detail: "Resource not found in this church." } });

    if (path === "/churches") return fulfill(pageBody([alpha, beta]));
    if (path === `/churches/${alpha.id}`) return fulfill(alpha);
    if (path === `/churches/${beta.id}`) return fulfill(beta);

    const churchPrefix = `/churches/${alpha.id}/`;
    if (!path.startsWith(churchPrefix)) return notFound();
    const rest = path.slice(churchPrefix.length);

    if (/^members\/[^/]+\/image$/.test(rest))
      return route.fulfill({ body: pngPixel, contentType: "image/png" });
    if (/^members\/[^/]+$/.test(rest)) {
      const member = members.find((m) => rest === `members/${m.id}`);
      return member ? fulfill(member) : notFound();
    }
    if (rest === "members") return fulfill(pageBody(members));
    if (rest === "groups") return fulfill(pageBody(groups));
    if (rest === "custom-fields") return fulfill(pageBody(customFields));
    if (rest === "events") return fulfill(pageBody(events));
    if (/^events\/[^/]+$/.test(rest)) {
      const event = events.find((e) => rest === `events/${e.id}`);
      return event ? fulfill(event) : notFound();
    }
    if (/^events\/[^/]+\/occurrences$/.test(rest)) {
      const eventId = rest.split("/")[1];
      return fulfill(pageBody(allOccurrences.filter((o) => o.eventId === eventId)));
    }
    if (/^events\/[^/]+\/occurrence-check-in-counts$/.test(rest)) {
      const eventId = rest.split("/")[1];
      const ids = new Set(allOccurrences.filter((o) => o.eventId === eventId).map((o) => o.id));
      return fulfill(pageBody(counts.filter((c) => ids.has(c.occurrenceId))));
    }
    if (/^occurrences\/[^/]+$/.test(rest)) {
      const occ = allOccurrences.find((o) => rest === `occurrences/${o.id}`);
      return occ ? fulfill(occ) : notFound();
    }
    if (rest === "occurrences") return fulfill(pageBody(allOccurrences));
    if (rest === "attendance") {
      let rows = receipts;
      const occId = url.searchParams.get("occurrenceId");
      const memberId = url.searchParams.get("memberId");
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (occId) rows = rows.filter((r) => r.occurrenceId === occId);
      if (memberId) rows = rows.filter((r) => r.memberId === memberId);
      if (from) rows = rows.filter((r) => (r.checkedInAt ?? "").slice(0, 10) >= from);
      if (to) rows = rows.filter((r) => (r.checkedInAt ?? "").slice(0, 10) <= to);
      return fulfill(pageBody(rows));
    }
    if (rest === "attendance/summary") {
      const groupBy = url.searchParams.get("groupBy") ?? "event";
      let rows = receipts;
      const occId = url.searchParams.get("occurrenceId");
      const memberId = url.searchParams.get("memberId");
      const groupId = url.searchParams.get("groupId");
      const eventId = url.searchParams.get("eventId");
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (occId) rows = rows.filter((r) => r.occurrenceId === occId);
      if (memberId) rows = rows.filter((r) => r.memberId === memberId);
      if (eventId) rows = rows.filter((r) => r.eventId === eventId);
      if (groupId) rows = rows.filter((r) => r.inclusiveGroupIds.includes(groupId));
      if (from) rows = rows.filter((r) => (r.checkedInAt ?? "").slice(0, 10) >= from);
      if (to) rows = rows.filter((r) => (r.checkedInAt ?? "").slice(0, 10) <= to);
      const keyOf = (r: (typeof receipts)[number]) =>
        groupBy === "event" ? r.eventId
        : groupBy === "occurrence" ? r.occurrenceId
        : groupBy === "member" ? r.memberId
        : groupBy === "group" ? r.inclusiveGroupIds[0] ?? ""
        : (r.checkedInAt ?? "").slice(0, 10);
      const grouped = new Map<string, { count: number; members: Set<string> }>();
      for (const r of rows) {
        const key = keyOf(r);
        const entry = grouped.get(key) ?? { count: 0, members: new Set<string>() };
        entry.count += 1;
        entry.members.add(r.memberId);
        grouped.set(key, entry);
      }
      return fulfill({
        items: [...grouped.entries()].map(([key, entry]) => ({
          key,
          checkedInCount: entry.count,
          uniqueMemberCount: entry.members.size,
        })),
      });
    }
    return notFound();
  });
}

async function seedAdmin(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "jchurch:auth-session:v1",
      JSON.stringify({ provider: "admin" }),
    );
  });
}

async function shot(page: Page, name: string, height?: number) {
  await page.waitForTimeout(600);
  const viewport = page.viewportSize();
  await page.screenshot({
    path: path.join(IMG, `${name}.png`),
    ...(height && viewport ? { clip: { x: 0, y: 0, width: viewport.width, height } } : {}),
  });
}

const sessionLabel = (start: DateTime) =>
  start.setZone(zone).toFormat("ccc, LLL d, yyyy · h:mm a");

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("guide screenshot: home overview", async ({ page }) => {
  await seedAdmin(page);
  await page.goto(`/church/${alpha.id}`);
  await expect(page.getByRole("heading", { name: "Your church, together." })).toBeVisible();
  await shot(page, "home");
});

test("guide screenshots: sign-in and church picker", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" }).last()).toBeVisible();
  await shot(page, "01-login", 600);

  await seedAdmin(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Choose your church" })).toBeVisible();
  await shot(page, "01-choose-church", 500);
});

test("guide screenshots: members list, sort/filter, import-export", async ({ page }) => {
  await seedAdmin(page);
  await page.goto(`/church/${alpha.id}/members`);
  await expect(page.getByText("Emma Choi")).toBeVisible();
  await shot(page, "02-members-list");

  await page.getByRole("button", { name: "Sort and filter members" }).click();
  await expect(page.getByText("Member sort and filter")).toBeVisible();
  await shot(page, "02-sort-filter");
  await page.getByRole("button", { name: "Close" }).first().click({ force: true });

  await page.getByRole("button", { name: "Import or export CSV" }).click();
  await expect(page.getByText("Import / export members")).toBeVisible();
  await shot(page, "02-import-export");
  await page.getByRole("button", { name: "Close" }).first().click({ force: true });
});

test("guide screenshots: duplicate members", async ({ page }, testInfo) => {
  const duplicateEmma = {
    ...emma,
    id: "member_emma_choi_duplicate",
    phone: "516-555-0199",
    createdOn: DateTime.now().minus({ days: 1 }).toISO(),
  };
  await page.route(`**/api/v1/churches/${alpha.id}/members**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/v1/churches/${alpha.id}/members`)
      await route.fulfill({ json: pageBody([emma, duplicateEmma]) });
    else await route.fallback();
  });
  await page.route(
    `**/api/v1/churches/${alpha.id}/members/${emma.id}/merge**`,
    (route) => route.fulfill({ json: { keeperCheckIns: 3, loserCheckIns: 2, movable: 2, skipped: 0 } }),
  );
  await seedAdmin(page);
  await page.goto(`/church/${alpha.id}/duplicates`);
  await expect(page.getByText("1 of 1 possible duplicate pair")).toBeVisible();
  if (testInfo.project.name !== "ipad") await shot(page, "04-duplicates");
  await page.getByRole("button", { name: "Review possible duplicate Emma Choi" }).click();
  await expect(page.getByRole("heading", { name: "Resolve duplicate" })).toBeVisible();
  await expect(page.getByText(/2 check-ins will move/)).toBeVisible();
  await shot(page, testInfo.project.name === "ipad" ? "04-duplicate-review-ipad" : "04-duplicate-review");
});

test("guide screenshots: member detail, edit, groups, update link, registration code", async ({ page }) => {
  // Point the church record at the scan-free variant so the member sheet has
  // no Scan code section and no printable member card.
  await page.route(`**/api/v1/churches/${alpha.id}`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/v1/churches/${alpha.id}`)
      await route.fulfill({ json: alphaNoScan });
    else await route.fallback();
  });
  await seedAdmin(page);
  await page.goto(`/church/${alpha.id}/members`);
  await expect(page.getByText("Emma Choi")).toBeVisible();

  // Registration QR for new members (captured with scanning enabled elsewhere)
  await page.getByRole("button", { name: "New registration" }).click();
  await expect(page.getByText("Member registration")).toBeVisible();
  await shot(page, "05-registration-code");
  await page.getByRole("button", { name: "Close" }).first().click({ force: true });

  // Member detail (view mode)
  await page.getByText("Emma Choi").click();
  await expect(page.getByRole("button", { name: "Edit member" })).toBeVisible();
  await shot(page, "03-member-view");

  // Update-link QR for this member
  await page.getByRole("button", { name: "Update link" }).click();
  await expect(page.getByText("Registration code")).toBeVisible();
  await shot(page, "05-update-link");
  await page.getByRole("button", { name: "Close" }).first().click({ force: true });

  // Edit mode
  await page.getByRole("button", { name: "Edit member" }).click();
  await expect(page.getByText("Personal details")).toBeVisible();
  await shot(page, "03-member-edit");

  // Scroll down to the Groups section
  await page.getByText("Groups", { exact: true }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot(page, "03-member-groups");
});

test("guide screenshots: events and sessions", async ({ page }) => {
  await seedAdmin(page);
  await page.goto(`/church/${alpha.id}/events`);
  await expect(page.getByText("JHAFAM Class")).toBeVisible();
  await shot(page, "06-events-list");

  await page.getByRole("button", { name: "Add event" }).click();
  await expect(page.getByText("Add event")).toBeVisible();
  await shot(page, "06-add-event");
  await page.getByRole("button", { name: "Close" }).first().click({ force: true });

  await page.getByText("JHAFAM Class").click();
  await expect(page.getByRole("heading", { name: "Event & sessions" })).toBeVisible();
  await expect(page.getByText(sessionLabel(sessionStart(0)))).toBeVisible();
  await shot(page, "06-event-sessions");

  await page.getByText(sessionLabel(sessionStart(0))).first().click();
  await expect(page.getByText("Session details")).toBeVisible();
  await shot(page, "06-session-details");
});

test("guide screenshots: check-in flow and undo", async ({ page }) => {
  await seedAdmin(page);
  await page.goto(`/church/${alpha.id}/check-in`);
  await expect(page.getByText("Choose an event")).toBeVisible();
  await shot(page, "07-choose-event");

  await page.getByText("JHAFAM Class").click();
  await expect(page.getByText(sessionLabel(sessionStart(0)))).toBeVisible();
  await shot(page, "07-choose-session");

  await page.getByText(sessionLabel(sessionStart(0))).first().click();
  await expect(page.getByText("Ready for check-in")).toBeVisible();
  await shot(page, "07-confirm");

  await page.getByRole("button", { name: "Begin check-in" }).click();
  await expect(page.getByText("Emma Choi")).toBeVisible();
  await shot(page, "07-checkin");

  // Session registration QR from the banner
  await page.getByRole("button", { name: "New registration" }).click();
  await expect(page.getByText("Session registration")).toBeVisible();
  await shot(page, "05-session-registration");
  await page.getByRole("button", { name: "Close" }).first().click({ force: true });

  // Checked-in roster and undo confirmation
  await page.getByRole("tab", { name: "Checked in" }).click();
  await expect(page.getByText("Adam Kim")).toBeVisible();
  await shot(page, "07-checked-in");

  await page.getByRole("button", { name: "Undo" }).first().click();
  await expect(page.getByText(/Undo this check-in/)).toBeVisible();
  await shot(page, "07-undo-confirm");
});

test("guide screenshots: reports", async ({ page }) => {
  await seedAdmin(page);
  await page.goto(`/church/${alpha.id}/reports`);
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await shot(page, "08-reports-hub");

  // By Event
  await page.goto(`/church/${alpha.id}/report-event`);
  await page.getByLabel("Event").selectOption({ label: "JHAFAM Class" });
  await expect(page.getByRole("heading", { name: "Per session" })).toBeVisible();
  await shot(page, "08-report-event");

  // By Session
  await page.goto(`/church/${alpha.id}/report-session`);
  await page.getByLabel("Event").selectOption({ label: "JHAFAM Class" });
  await page.getByLabel("Session").selectOption({ label: sessionLabel(sessionStart(1)) });
  await expect(page.getByText("Emma Choi")).toBeVisible();
  await shot(page, "08-report-session");

  // By Member
  await page.goto(`/church/${alpha.id}/report-member`);
  await page.getByPlaceholder("Search members").fill("Emma");
  await expect(page.getByText("Emma Choi")).toBeVisible();
  await page.getByText("Emma Choi").click();
  await expect(page.getByText("Selected for this report")).toBeVisible();
  await shot(page, "08-report-member");

  // By Group
  await page.goto(`/church/${alpha.id}/report-group`);
  await page.getByLabel("Group").selectOption({ label: "JHAFAM" });
  await expect(page.getByText("Include subgroups")).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, "08-report-group");
});
