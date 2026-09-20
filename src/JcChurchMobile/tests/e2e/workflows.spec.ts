import { expect, test } from "@playwright/test";
import { BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from "@zxing/library";

const metadata = (id: string, churchId = id) => ({
  id,
  churchId,
  _etag: '"first"',
  active: true,
  kind: "Document",
  searchText: "",
});
const alpha = { ...metadata("church_alpha"), name: "Alpha Community" };
const beta = { ...metadata("church_beta"), name: "Beta Community" };
const jordan = {
  ...metadata("member_jordan", alpha.id),
  firstName: "Jordan",
  lastName: "Example",
  groupIds: [],
  customFields: {},
};
const secondMember = {
  ...metadata("member_casey", alpha.id),
  firstName: "Casey",
  lastName: "Example",
  groupIds: [],
  customFields: {},
};
const sampleEvent = {
  ...metadata("event_sample", alpha.id),
  name: "Community gathering",
  localStart: "2026-09-21T09:00:00",
  timeZone: "UTC",
  durationMinutes: 60,
  recurrenceRule: null,
};
const sampleSession = {
  ...metadata("occ_sample", alpha.id),
  eventId: sampleEvent.id,
  startsAt: new Date(Date.now() + 86400000).toISOString(),
  endsAt: new Date(Date.now() + 90000000).toISOString(),
  cancelled: false,
  overridden: false,
};
const pageBody = (
  items: unknown[],
  continuationToken: string | null = null,
) => ({ items, continuationToken });

test("event navigation preserves the selected church through Home and tabs", async ({ page }) => {
  const missingPaths: string[] = [];
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let body: unknown;
    if (path === "/churches") body = pageBody([alpha, beta]);
    else if (path === `/churches/${alpha.id}`) body = alpha;
    else if (path === `/churches/${beta.id}`) body = beta;
    else if (path === `/churches/${alpha.id}/events`) body = pageBody([sampleEvent]);
    else if (path === `/churches/${beta.id}/events`) body = pageBody([]);
    else if ([alpha.id, beta.id].some(churchId => ["members", "groups", "custom-fields"].some(resource => path === `/churches/${churchId}/${resource}`))) body = pageBody([]);
    else if (path === `/churches/${alpha.id}/events/${sampleEvent.id}/occurrences`) body = pageBody([sampleSession]);
    else {
      missingPaths.push(path);
      await route.fulfill({ status: 404, json: { detail: "Resource not found in this church." } });
      return;
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Alpha Community/ }).click();
  await page.getByRole("tab", { name: "Members", exact: true }).click();
  await expect(page.getByText("No members found.", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Check-In", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Choose an event", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Community gathering/ })).toBeVisible();
  await page.getByRole("tab", { name: "Events", exact: true }).click();
  await expect(page.getByRole("button", { name: /Community gathering/ })).toBeVisible();
  await page.getByRole("button", { name: /Community gathering/ }).click();
  await expect(page.getByRole("button", { name: /Ends .*UTC/ })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("tab", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: /Manage events/ }).click();
  await expect(page.getByRole("button", { name: /Community gathering/ })).toBeVisible();
  await page.getByRole("button", { name: "Switch church", exact: true }).click();
  await page.getByRole("button", { name: /Beta Community/ }).click();
  await page.getByRole("tab", { name: "Events", exact: true }).click();
  await expect(page.getByText("No events found.", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Members", exact: true }).click();
  await expect(page.getByText("No members found.", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Check-In", exact: true }).click();
  await expect(page.getByText("No events available.", { exact: true })).toBeVisible();
  expect(missingPaths).toEqual([]);
});

test("draft protection, stale edits, pagination and church isolation", async ({
  page,
}, testInfo) => {
  let saved = { ...jordan };
  let stale = true;
  let savedEtag = "";
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    const method = route.request().method();
    let body: unknown = pageBody([]);
    if (path === "/churches") body = pageBody([alpha, beta]);
    else if (path === `/churches/${alpha.id}`) body = alpha;
    else if (path === `/churches/${beta.id}`) body = beta;
    else if (path === `/churches/${alpha.id}/members`)
      body = url.searchParams.has("continuationToken")
        ? pageBody([secondMember])
        : pageBody([saved], "next+token");
    else if (path === `/churches/${alpha.id}/members/${jordan.id}`) {
      if (method === "PUT") {
        if (stale) {
          stale = false;
          saved = { ...saved, firstName: "Updated", _etag: '"latest"' };
          await route.fulfill({
            status: 412,
            json: { detail: "ETag is stale." },
          });
          return;
        }
        savedEtag = route.request().headers()["if-match"] ?? "";
        saved = { ...saved, ...route.request().postDataJSON() };
      }
      body = saved;
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Alpha Community/ }).click();
  await page.getByRole("button", { name: /Manage members/ }).click();
  await page.getByRole("button", { name: "Load more members" }).click();
  await expect(
    page.getByRole("button", { name: /Casey Example/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Jordan Example/ }).click();
  await page.getByRole("button", { name: "Edit member", exact: true }).click();
  await page
    .getByRole("textbox", { name: "First name", exact: true })
    .fill("Draft");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "First name", exact: true }),
  ).toHaveValue("Draft");
  await page.getByRole("button", { name: "Save member", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "This record changed elsewhere",
  );
  await expect(
    page.getByRole("textbox", { name: "First name", exact: true }),
  ).toHaveValue("Draft");
  await page
    .getByRole("button", { name: "Reload latest version", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "First name", exact: true }),
  ).toHaveValue("Updated");
  await page
    .getByRole("textbox", { name: "First name", exact: true })
    .fill("Reviewed");
  await page.getByRole("button", { name: "Save member", exact: true }).click();
  await expect(page.getByText("Member saved.", { exact: true })).toBeVisible();
  expect(savedEtag).toBe('"latest"');
  await page.getByRole("tab", { name: "Home", exact: true }).click();
  await page.getByRole("tab", { name: "Members", exact: true }).click();
  await expect(page.getByRole("button", { name: /Reviewed Example/ })).toBeVisible();
  await expect(page.getByText("Member saved.", { exact: true })).toHaveCount(0);
  const tabLabel = page
    .getByRole("tab", { name: "Members", exact: true })
    .getByText("Members", { exact: true });
  const bounds = await tabLabel.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerHeight),
  );
  await page
    .getByRole("button", { name: "Switch church", exact: true })
    .click();
  await page.getByRole("button", { name: /Beta Community/ }).click();
  await page.screenshot({
    path: testInfo.outputPath("home.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: /Manage members/ }).click();
  await expect(
    page.getByText("No members found.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Reviewed Example", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("Casey Example", { exact: true })).toHaveCount(0);
});

test("uncertain check-in stays pending until retry and cancelled sessions are blocked", async ({
  page,
}) => {
  let attempts = 0;
  let cancelled = false;
  const receipt = {
    ...metadata("receipt", alpha.id),
    memberId: jordan.id,
    eventId: sampleEvent.id,
    occurrenceId: sampleSession.id,
    checkedInAt: new Date().toISOString(),
  };
  const submitted: unknown[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let body: unknown = pageBody([]);
    if (path === `/churches/${alpha.id}`) body = alpha;
    else if (path.endsWith(`/events/${sampleEvent.id}`)) body = sampleEvent;
    else if (path.endsWith(`/occurrences/${sampleSession.id}`))
      body = { ...sampleSession, cancelled };
    else if (path.endsWith(`/events/${sampleEvent.id}/occurrences`))
      body = pageBody([{ ...sampleSession, cancelled }]);
    else if (path.endsWith("/members")) body = pageBody([jordan]);
    else if (path.endsWith(`/check-ins/${jordan.id}`))
      body = { checkedIn: false, receipt: null };
    else if (
      path.endsWith("/check-ins") &&
      route.request().method() === "POST"
    ) {
      attempts++;
      submitted.push(route.request().postDataJSON());
      if (attempts === 1) {
        await route.abort("failed");
        return;
      }
      body = receipt;
    }
    await route.fulfill({ json: body });
  });
  await page.goto(
    `/church/${alpha.id}/check-in?eventId=${sampleEvent.id}&occurrenceId=${sampleSession.id}`,
  );
  await page
    .getByRole("button", { name: "Begin check-in", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Check in Jordan", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Confirmation pending");
  await expect(page.getByText(/^Checked in ·/)).toHaveCount(0);
  await expect(page.getByText(/^Already checked in ·/)).toHaveCount(0);
  await page.getByRole("button", { name: "Retry Jordan", exact: true }).click();
  await expect(page.getByText(/^Already checked in ·/)).toBeVisible();
  expect(submitted).toEqual([{ memberId: jordan.id }, { memberId: jordan.id }]);
  cancelled = true;
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("cancelled");
  await expect(
    page.getByRole("button", { name: "Begin check-in", exact: true }),
  ).toBeDisabled();
});

test("member scan code reissue saves only after confirmation and renders the persisted card", async ({ page }, testInfo) => {
  let saved = { ...jordan, scanCode: "0000-ORIGINAL", scanCodeFormat: "qr" };
  async function decodeCard() {
    const pixels = await page.locator("svg").last().evaluate(async (element, density) => {
      const image = new Image();
      const loaded = new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; });
      image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(element));
      await loaded;
      const canvas = document.createElement("canvas");
      canvas.width = image.width * density;
      canvas.height = image.height * density;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      return { width: canvas.width, height: canvas.height,
        gray: Array.from({ length: canvas.width * canvas.height }, (_, index) => rgba[index * 4]) };
    }, saved.scanCodeFormat === "qr" ? 2 : 3);
    const source = new RGBLuminanceSource(Uint8ClampedArray.from(pixels.gray), pixels.width, pixels.height);
    const reader = new MultiFormatReader();
    reader.setHints(new Map([[DecodeHintType.POSSIBLE_FORMATS, [saved.scanCodeFormat === "qr" ? BarcodeFormat.QR_CODE : BarcodeFormat.CODE_128]]]));
    expect(reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(source))).getText()).toBe(saved.scanCode);
  }
  const writes: unknown[] = [];
  let attendanceWrites = 0;
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let body: unknown = pageBody([]);
    if (path === `/churches/${alpha.id}`) body = alpha;
    else if (path.endsWith("/members")) body = pageBody([saved]);
    else if (path.endsWith(`/members/${jordan.id}`)) {
      if (route.request().method() === "PUT") {
        writes.push(route.request().postDataJSON());
        saved = { ...saved, ...route.request().postDataJSON(), _etag: '"second"' };
      }
      body = saved;
    }
    if (path.includes("check-ins") && route.request().method() === "POST") attendanceWrites++;
    await route.fulfill({ json: body });
  });
  await page.goto(`/church/${alpha.id}/members`);
  await page.getByRole("button", { name: /Jordan Example/ }).click();
  await expect(page.getByRole("button", { name: "Print member card", exact: true })).toBeVisible();
  await decodeCard();
  await page.getByRole("button", { name: "Edit member", exact: true }).click();
  await page.getByRole("button", { name: "Scan member code", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Scan or enter code", exact: true });
  await input.fill("0000-replaced");
  await input.press("Enter");
  await expect(page.getByRole("textbox", { name: "Member scan code", exact: true })).toHaveValue("0000-REPLACED");
  await expect(page.getByRole("button", { name: "Print member card", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Barcode", exact: true }).click();
  await page.getByRole("button", { name: "Save member", exact: true }).click();
  await expect(page.getByText(/old card will stop working/)).toBeVisible();
  expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "Confirm replacement", exact: true }).click();
  await expect(page.getByText("Member saved.", { exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ scanCode: "0000-REPLACED", scanCodeFormat: "code128" });
  expect(attendanceWrites).toBe(0);
  await page.getByRole("button", { name: /Jordan Example/ }).click();
  await expect(page.getByRole("button", { name: "Print member card", exact: true })).toBeVisible();
  await expect(page.locator("svg").last()).toBeVisible();
  await decodeCard();
  saved = { ...saved, scanCode: "0000" + "ABCD1234EFGH".repeat(5) };
  await page.reload();
  await page.getByRole("button", { name: /Jordan Example/ }).click();
  await expect(page.getByRole("button", { name: "Print member card", exact: true })).toBeVisible();
  await decodeCard();
  await page.screenshot({ path: testInfo.outputPath("synthetic-scan-card.png"), fullPage: true });
});

test("scan check-in submits automatically, suppresses repeats and recovers uncertain receipts", async ({ page }) => {
  const receipt = { ...metadata("scan_receipt", alpha.id), memberId: jordan.id, occurrenceId: sampleSession.id,
    eventId: sampleEvent.id, checkedInAt: new Date().toISOString() };
  const submitted: string[] = [];
  let confirmed = false;
  let statusReads = 0;
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let body: unknown = pageBody([]);
    if (path === `/churches/${alpha.id}`) body = alpha;
    else if (path.endsWith(`/events/${sampleEvent.id}`)) body = sampleEvent;
    else if (path.endsWith(`/occurrences/${sampleSession.id}`)) body = sampleSession;
    else if (path.endsWith("/scan-check-ins/status")) {
      if (++statusReads === 1) {
        await route.fulfill({ status: 429, headers: { "Retry-After": "1" }, json: { detail: "Scan rate limit reached." } });
        return;
      }
      body = { checkedIn: confirmed, receipt: confirmed ? receipt : null, member: jordan };
    }
    else if (path.endsWith("/scan-check-ins")) {
      const code = route.request().postDataJSON().scanCode;
      submitted.push(code);
      if (code === "UNKNOWN-CODE") { await route.fulfill({ status: 404, json: { detail: "No matching member for this scan code." } }); return; }
      if (code === "UNCERTAIN-CODE") { await route.abort("failed"); return; }
      body = { receipt, member: jordan, already: false };
    }
    await route.fulfill({ json: body });
  });
  await page.goto(`/church/${alpha.id}/check-in?eventId=${sampleEvent.id}&occurrenceId=${sampleSession.id}`);
  await page.getByRole("button", { name: "Begin check-in", exact: true }).click();
  await page.getByRole("tab", { name: "Scan", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Scan or enter code", exact: true });
  await input.fill("0000-code");
  await input.press("Enter");
  await expect(page.getByText(/Jordan Example: Checked in/)).toBeVisible();
  await input.fill("0000-code");
  await input.press("Enter");
  await input.fill("unknown-code");
  await input.press("Enter");
  await expect(page.getByText("No matching member for this scan code.")).toBeVisible();
  expect(submitted).toEqual(["0000-CODE", "UNKNOWN-CODE"]);
  await input.fill("uncertain-code");
  await input.press("Enter");
  await expect(page.getByText("Confirmation pending", { exact: true })).toBeVisible();
  await expect(input).not.toBeEditable();
  await expect(page.getByRole("button", { name: "Change session", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Check scan status", exact: true })).toBeDisabled();
  confirmed = true;
  await page.getByRole("button", { name: "Check scan status", exact: true }).click();
  await expect(page.getByText(/Jordan Example: Already checked in/)).toBeVisible();
  expect(submitted.filter(code => code === "UNCERTAIN-CODE")).toHaveLength(1);
  await expect(input).toBeEditable();
});

test("church settings, members, sessions and duplicate-safe check-in", async ({
  page,
  request,
}, testInfo) => {
  const name = `Mobile QA ${testInfo.project.name} ${Date.now()}`;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let churchId: string | undefined;
  try {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Choose your church" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Create church", exact: true })
      .last()
      .click();
    await page
      .getByRole("textbox", { name: "Church name", exact: true })
      .fill(name);
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/churches") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Save church", exact: true })
      .click();
    const church = await (await created).json();
    churchId = church.id;
    await expect(
      page.getByText("Church saved.", { exact: true }),
    ).toBeVisible();
    await page.goto("/");
    await page.getByRole("textbox", { name: "Search churches" }).fill(name);
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await page.getByRole("button", { name: /Manage members/ }).click();
    await page.getByRole("button", { name: "Add member", exact: true }).click();
    await page
      .getByRole("textbox", { name: "First name", exact: true })
      .fill("Jordan");
    await page
      .getByRole("textbox", { name: "Last name", exact: true })
      .fill("Sample");
    await page
      .getByRole("button", { name: "Save member", exact: true })
      .click();
    await expect(
      page.getByText("Member saved.", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Jordan Sample/ }).click();
    await page
      .getByRole("button", { name: "Edit member", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "School", exact: true })
      .fill("Sample Academy");
    await page
      .getByRole("button", { name: "Save member", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /Jordan Sample/ }),
    ).toContainText("Sample Academy");
    await page.goto(`/church/${churchId}/events`);
    await page.getByRole("button", { name: "Add event", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Event name", exact: true })
      .fill("Sunday Gathering");
    await page
      .getByRole("textbox", { name: "Timezone", exact: true })
      .fill("UTC");
    await page
      .getByRole("textbox", { name: "Local start", exact: true })
      .fill(new Date(Date.now() - 5 * 60000).toISOString().slice(0, 16));
    await page.getByRole("button", { name: "Save event", exact: true }).click();
    await expect(page.getByText("Event saved.", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Generate occurrences", exact: true })
      .click();
    await expect(
      page.getByText("1 sessions created.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Generate occurrences", exact: true })
      .click();
    await expect(
      page.getByText("Sessions are already up to date.", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Ends .*UTC/ }).click();
    await page
      .getByRole("button", { name: "Start check-in", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Begin check-in", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Search members to check in" })
      .fill("Jordan");
    await page
      .getByRole("button", { name: "Check in Jordan", exact: true })
      .click();
    await expect(page.getByText(/^Checked in ·/)).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("check-in.png"),
      fullPage: true,
    });
    await page.getByRole("tab", { name: "Checked in", exact: true }).click();
    await expect(
      page.getByText("Jordan Sample", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("attendance.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Change session", exact: true })
      .click();
    await page.getByRole("button", { name: /Ends .*UTC/ }).click();
    await page
      .getByRole("button", { name: "Begin check-in", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Check in Jordan", exact: true })
      .click();
    await expect(page.getByText(/^Already checked in ·/)).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("textbox", { name: "Search churches" }).fill(name);
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await page
      .getByRole("textbox", { name: "Church name", exact: true })
      .fill(`${name} Updated`);
    await page
      .getByRole("button", { name: "Save church", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: new RegExp(`${name} Updated`) }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: new RegExp(`${name} Updated`) })
      .click();
    await page
      .getByRole("button", { name: "Delete church", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Archive church", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Choose your church" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    if (churchId) {
      const response = await request.get(`/api/v1/churches/${churchId}`);
      if (response.ok()) {
        const church = await response.json();
        if (church.active)
          await request.delete(`/api/v1/churches/${churchId}`, {
            headers: { "If-Match": church._etag },
          });
      }
    }
  }
});
