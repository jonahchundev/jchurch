import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const churchId = "church_sequence";
const metadata = (id: string) => ({ id, churchId, active: true, _etag: '"first"' });
const church = { ...metadata(churchId), name: "Sequence Community" };
const group = { ...metadata("group_youth"), name: "Youth", parentGroupId: null };
const child = { ...metadata("group_students"), name: "Students", parentGroupId: group.id };
const event = { ...metadata("event_service"), name: "Sunday Service", timeZone: "UTC" };
const person = (id: string, firstName: string, groupId = group.id) => ({
  ...metadata(id), firstName, lastName: "Example", memberType: "adult", gender: "Female",
  createdOn: "2020-01-01T00:00:00Z", groupIds: [groupId], customFields: {},
});
const emma = person("emma", "Emma");
const ethan = person("ethan", "Ethan");
const mia = person("mia", "Mia", child.id);
const members = [emma, ethan, mia];
const sessions = Array.from({ length: 16 }, (_, index) => ({
  ...metadata(`session_${index}`), eventId: event.id, cancelled: false, archived: false,
  startsAt: new Date(Date.now() - (17 - index) * 86400000).toISOString(),
  endsAt: new Date(Date.now() - (17 - index) * 86400000 + 3600000).toISOString(),
}));

async function setup(page: Page, failReceipts = false) {
  const paths: string[] = [];
  await page.addInitScript(() => {
    window.localStorage.setItem("jchurch:auth-session:v1", JSON.stringify({ provider: "admin" }));
  });
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    paths.push(`${path}${url.search}`);
    let body: unknown = { items: [], continuationToken: null };
    if (path === `/churches/${churchId}`) body = church;
    else if (path === "/churches") body = { items: [church], continuationToken: null };
    else if (path.endsWith("/groups")) body = { items: [group, child], continuationToken: null };
    else if (path.endsWith("/members")) body = { items: members, continuationToken: null };
    else if (path.endsWith("/events")) body = { items: [event], continuationToken: null };
    else if (path.endsWith("/occurrences")) {
      body = url.searchParams.has("continuationToken")
        ? { items: sessions.slice(8), continuationToken: null }
        : { items: sessions.slice(0, 8), continuationToken: "second-page" };
    } else if (path.endsWith("/attendance")) {
      if (failReceipts) {
        await route.fulfill({ status: 400, json: { detail: "Session attendance unavailable" } });
        return;
      }
      const occurrenceId = url.searchParams.get("occurrenceId")!;
      const index = Number(occurrenceId.replace("session_", ""));
      const receiptMembers = index < 13 ? [emma, mia] : [mia];
      const receipts = receiptMembers.map(member => ({
        ...metadata(`${occurrenceId}_${member.id}`), memberId: member.id, eventId: event.id, occurrenceId,
        checkedInAt: sessions[index]!.startsAt, groupIds: [], inclusiveGroupIds: [],
      }));
      body = { items: receipts, continuationToken: null };
    }
    await route.fulfill({ json: body });
  });
  return paths;
}

async function openSequence(page: Page) {
  await page.goto(`/church/${churchId}/report-group?groupId=${group.id}`);
  await page.getByRole("button", { name: "Report view: Attendance sequence", exact: true }).click();
  await expect(page.getByText("Choose one event for the attendance sequence.")).toBeVisible();
  await page.getByLabel("Event", { exact: true }).selectOption(event.id);
}

test("group attendance sequence wraps only squares and includes zero-attendance members", async ({ page }, testInfo) => {
  const paths = await setup(page);
  await openSequence(page);
  const emmaRow = page.getByTestId("sequence-member-emma");
  await expect(emmaRow).toContainText("Latest streak: Absent 3 in a row");
  await expect(emmaRow).toContainText("13 attended · 3 absent");
  await expect(page.getByTestId("sequence-member-ethan")).toContainText("Latest streak: Absent 16 in a row");
  await expect(page.getByTestId("sequence-member-mia")).toContainText("Latest streak: Attended 16 in a row");
  await expect(emmaRow.getByRole("button")).toHaveCount(16);
  expect(paths.filter(path => path.includes("/attendance?")).every(path => !path.includes("groupId=") && !path.includes("from="))).toBe(true);
  expect(paths.some(path => path.includes("continuationToken=second-page"))).toBe(true);

  const firstRowCount = await page.getByTestId("sequence-row-emma-0").getByRole("button").count();
  const otherCount = await page.getByTestId("sequence-row-ethan-0").getByRole("button").count();
  expect(firstRowCount).toBe(otherCount);
  if (testInfo.project.name === "mobile") {
    expect(firstRowCount).toBeLessThan(16);
    await expect(page.getByTestId("sequence-row-emma-1")).toBeVisible();
  }
  await emmaRow.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("attendance-sequence.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await emmaRow.getByRole("button", { name: /Absent$/ }).last().click();
  await expect(page.getByRole("heading", { name: "Attendance details" })).toBeVisible();
  await expect(page.getByText("No active check-in recorded for this started session.")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "Sort and filter members" }).click();
  await page.getByLabel("Sequence order", { exact: true }).selectOption("absence");
  await page.getByRole("button", { name: "Apply filters and sort", exact: true }).click();
  await expect(page.getByTestId(/^sequence-member-/).first()).toContainText("Ethan Example");
  await page.getByRole("textbox", { name: "Search members" }).fill("emma");
  await expect(page.getByTestId(/^sequence-member-/)).toHaveCount(1);
  await page.getByRole("textbox", { name: "Search members" }).fill("");
  await page.getByLabel("Include subgroups", { exact: true }).uncheck();
  await expect(page.getByTestId("sequence-member-mia")).toHaveCount(0);

  const originalWidth = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: 850 });
  await expect.poll(() => page.getByTestId("sequence-row-emma-0").getByRole("button").count()).toBeLessThan(firstRowCount);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize(originalWidth);

  await page.getByRole("button", { name: "Export report", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV", exact: true }).click();
  const download = await downloadPromise;
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv).toContain("Latest streak");
  expect(csv).toContain("Absent 16 in a row");
  expect(csv).toContain("Checked in");
});

test("group attendance sequence never shows absence when receipt loading fails", async ({ page }) => {
  await setup(page, true);
  await openSequence(page);
  await expect(page.getByText("Session attendance unavailable")).toBeVisible();
  await expect(page.getByTestId(/^sequence-member-/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export report", exact: true })).toBeDisabled();
});

test("group attendance sequence requires a finite range and preserves the totals view", async ({ page }) => {
  await setup(page);
  await openSequence(page);
  await expect(page.getByTestId("sequence-member-emma")).toBeVisible();
  await page.getByRole("button", { name: "Date range: All time", exact: true }).click();
  await expect(page.getByText("Choose a complete date range of 93 days or fewer for the attendance sequence.")).toBeVisible();
  await expect(page.getByTestId(/^sequence-member-/)).toHaveCount(0);
  await page.getByRole("button", { name: "Report view: Totals", exact: true }).click();
  await expect(page.getByText("No check-ins for this group in this date range.")).toBeVisible();
});

test("group attendance sequence updates at session start and reloads a late check-in", async ({ page }) => {
  const start = Date.now();
  await page.clock.install({ time: start });
  await setup(page);
  const upcoming = { ...sessions[15]!, startsAt: new Date(start + 5000).toISOString(), endsAt: new Date(start + 3600000).toISOString() };
  await page.route(`**/api/v1/churches/${churchId}/occurrences?**`, route => route.fulfill({ json: { items: [upcoming], continuationToken: null } }));
  let arrived = false;
  await page.route(`**/api/v1/churches/${churchId}/attendance?**`, route => route.fulfill({ json: {
    items: arrived ? [{ ...metadata("late_receipt"), memberId: emma.id, occurrenceId: upcoming.id, eventId: event.id, checkedInAt: new Date(start + 6000).toISOString() }] : [],
    continuationToken: null,
  } }));
  await openSequence(page);
  const row = page.getByTestId("sequence-member-emma");
  await expect(row.getByRole("button", { name: /Upcoming$/ })).toHaveCount(1);
  await page.clock.fastForward(6000);
  await expect(row).toContainText("Latest streak: Absent 1 in a row");
  await expect(row.getByRole("button", { name: /Absent$/ })).toHaveCount(1);
  await expect(page.getByText("A session is in progress. Missing check-ins already count toward absence filters.")).toBeVisible();
  await page.getByRole("button", { name: "Sort and filter members" }).click();
  await page.getByLabel("Attendance preset", { exact: true }).selectOption("recently-absent");
  await page.getByRole("button", { name: "Apply filters and sort", exact: true }).click();
  await expect(row).toBeVisible();
  arrived = true;
  await page.getByRole("button", { name: "Refresh attendance sequence", exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "Clear attendance filters and sort", exact: true }).click();
  await expect(row).toContainText("Latest streak: Attended 1 in a row");
  await expect(row.getByRole("button", { name: /Checked in$/ })).toHaveCount(1);
});

test("recent absence filters apply drafts, validate thresholds, reset and export displayed members", async ({ page }, testInfo) => {
  await setup(page);
  await openSequence(page);
  const memberRows = page.getByTestId(/^sequence-member-/);
  const openFilters = () => page.getByRole("button", { name: "Sort and filter members", exact: true }).click();
  const apply = () => page.getByRole("button", { name: "Apply filters and sort", exact: true }).click();
  await expect(memberRows).toHaveCount(3);
  await openFilters();
  await page.getByLabel("Attendance preset", { exact: true }).selectOption("recently-absent");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(memberRows).toHaveCount(3);
  await openFilters();
  await expect(page.getByLabel("Attendance preset", { exact: true })).toHaveValue("all");
  await page.getByLabel("Attendance preset", { exact: true }).selectOption("recently-absent");
  await apply();
  await expect(memberRows).toHaveCount(2);
  await expect(memberRows.first()).toContainText("Ethan Example");
  await expect(page.getByTestId("sequence-member-emma")).toContainText("Missed 3 of last 5 eligible sessions");
  await expect(page.getByText(/2 of 3 current members/)).toBeVisible();
  await page.getByTestId("sequence-member-emma").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("recently-absent.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await openFilters();
  await page.getByLabel("Attendance filter", { exact: true }).selectOption("consecutive");
  await page.getByLabel("Minimum consecutive absences", { exact: true }).fill("4");
  await expect(page.getByLabel("Attendance preset", { exact: true })).toHaveValue("custom");
  await apply();
  await expect(memberRows).toHaveCount(1);
  await expect(memberRows).toContainText("Ethan Example");
  await openFilters();
  await page.getByLabel("Minimum consecutive absences", { exact: true }).fill("100");
  await apply();
  await expect(page.getByText("No members match this search and attendance filters.")).toBeVisible();
  await page.getByRole("button", { name: "Clear attendance filters and sort", exact: true }).click();
  await expect(memberRows).toHaveCount(3);

  await openFilters();
  await page.getByLabel("Attendance filter", { exact: true }).selectOption("recent");
  await page.getByLabel("Minimum missed sessions", { exact: true }).fill("6");
  await expect(page.getByRole("button", { name: "Apply filters and sort", exact: true })).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("no greater than");
  await page.getByLabel("Minimum missed sessions", { exact: true }).fill("3");
  await page.getByLabel("Sequence order", { exact: true }).selectOption("recent");
  await apply();
  await expect(memberRows).toHaveCount(2);
  await expect(memberRows.first()).toContainText("Ethan Example");
  await page.getByRole("textbox", { name: "Search members", exact: true }).fill("emma");
  await expect(memberRows).toHaveCount(1);
  await page.getByRole("textbox", { name: "Search members", exact: true }).fill("");
  await expect(memberRows).toHaveCount(2);

  await page.getByRole("button", { name: "Export report", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV", exact: true }).click();
  const csv = await readFile((await (await downloadPromise).path())!, "utf8");
  expect(csv).toContain("Last attended in selected dates");
  expect(csv).toContain("Missed 3+ of last 5 eligible sessions");
  expect(csv).not.toContain("Mia Example");
  expect(csv.indexOf("Ethan Example")).toBeLessThan(csv.indexOf("Emma Example"));
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await openFilters();
  await page.getByLabel("Attendance filter", { exact: true }).selectOption("none");
  await apply();
  await expect(memberRows).toHaveCount(1);
  await expect(memberRows).toContainText("No attendance in selected dates");
  await openFilters();
  await page.getByLabel("Attendance filter", { exact: true }).selectOption("all");
  await page.getByLabel("Sequence order", { exact: true }).selectOption("last-attended");
  await apply();
  await expect(memberRows.first()).toContainText("Ethan Example");
  await openFilters();
  await page.getByRole("button", { name: "Reset filters and sort", exact: true }).click();
  await apply();
  await expect(memberRows).toHaveCount(3);
  await expect(memberRows.first()).toContainText("Emma Example");
});