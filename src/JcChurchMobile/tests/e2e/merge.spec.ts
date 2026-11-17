import { expect, test, type Page } from "@playwright/test";

const churchId = "church_merge";
const member = (id: string) => ({
  id, churchId, kind: "Member", active: true, _etag: '"first"',
  memberType: "adult", firstName: "Ada", lastName: "Example", email: "ada@example.test",
  groupIds: [], customFields: {},
});

async function openComparison(page: Page) {
  await page.goto(`/church/${churchId}/duplicates`);
  await page.getByRole("button", { name: "Review possible duplicate Ada Example" }).click();
  await expect(page.getByText(/1 check-in will move/)).toBeVisible();
}

async function confirmMerge(page: Page) {
  await page.getByRole("button", { name: "Merge into Ada Example", exact: true }).click();
  await page.getByRole("button", { name: "Merge into Ada Example", exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("jchurch:auth-session:v1", JSON.stringify({ provider: "admin" }));
  });
});

test("duplicate merge closes immediately after success even when member refresh stalls", async ({ page }, testInfo) => {
  let merged = false;
  let refreshStarted = false;
  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve; });
  const keeper = member("keeper");
  const loser = member("loser");
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    let body: unknown = { items: [], continuationToken: null };
    if (path === `/churches/${churchId}`) body = { id: churchId, churchId, name: "Merge Church", active: true };
    else if (path === "/churches") body = { items: [{ id: churchId, churchId, name: "Merge Church", active: true }], continuationToken: null };
    else if (path === `/churches/${churchId}/members`) {
      if (merged) {
        refreshStarted = true;
        await refreshGate;
      }
      body = { items: merged ? [keeper] : [keeper, loser], continuationToken: null };
    } else if (path.endsWith("/merge")) {
      if (url.searchParams.get("dryRun") === "true") body = { keeperCheckIns: 1, loserCheckIns: 2, movable: 1, skipped: 1 };
      else {
        merged = true;
        body = { kept: keeper.id, archived: loser.id, checkInsMoved: 1, checkInsSkipped: 1 };
      }
    }
    await route.fulfill({ json: body });
  });
  try {
    await openComparison(page);
    await confirmMerge(page);
    await expect(page.getByRole("heading", { name: "Resolve duplicate" })).toHaveCount(0, { timeout: 3000 });
    await expect(page.getByText(/Merged .*1 check-in moved, 1 already counted/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Review possible duplicate Ada Example" })).toHaveCount(0);
    await expect.poll(() => refreshStarted).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("merge-completed.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    releaseRefresh();
  }
});

test("duplicate merge reloads both versions and remaining attendance before retrying archive", async ({ page }) => {
  let writes = 0;
  let archived = false;
  const bodies: Record<string, unknown>[] = [];
  const keeper = member("keeper");
  let loser = member("loser");
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    let body: unknown = { items: [], continuationToken: null };
    if (path === `/churches/${churchId}`) body = { id: churchId, churchId, name: "Merge Church", active: true };
    else if (path === `/churches/${churchId}/members`) body = { items: archived ? [keeper] : [keeper, loser], continuationToken: null };
    else if (path === `/churches/${churchId}/members/keeper`) body = keeper;
    else if (path === `/churches/${churchId}/members/loser`) body = loser;
    else if (path.endsWith("/merge")) {
      if (url.searchParams.get("dryRun") === "true") body = { keeperCheckIns: 1, loserCheckIns: writes ? 0 : 2, movable: writes ? 0 : 1, skipped: writes ? 0 : 1 };
      else {
        writes++;
        bodies.push(route.request().postDataJSON());
        if (writes === 1) {
          loser = { ...loser, _etag: '"latest"' };
          await route.fulfill({ status: 412, json: { detail: "Merge stopped during archive. Reload both members and review." } });
          return;
        }
        archived = true;
        body = { kept: keeper.id, archived: loser.id, checkInsMoved: 0, checkInsSkipped: 0 };
      }
    }
    await route.fulfill({ json: body });
  });
  await openComparison(page);
  await confirmMerge(page);
  await expect(page.getByRole("alert")).toContainText("This record changed elsewhere");
  await expect(page.getByRole("button", { name: "Merge into Ada Example", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Reload and review" }).click();
  await expect(page.getByText(/0 check-ins will move/)).toBeVisible();
  expect(writes).toBe(1);
  await confirmMerge(page);
  await expect(page.getByRole("heading", { name: "Resolve duplicate" })).toHaveCount(0);
  expect(bodies[1]).toMatchObject({ loserEtag: '"latest"', keeperEtag: '"first"' });
  expect(bodies[1]).not.toHaveProperty("keeperUpdate");
  expect(writes).toBe(2);
});

test("duplicate merge checks uncertain completion without submitting another merge", async ({ page }) => {
  let writes = 0;
  const keeper = member("keeper");
  let loser = member("loser");
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    let body: unknown = { items: [], continuationToken: null };
    if (path === `/churches/${churchId}`) body = { id: churchId, churchId, name: "Merge Church", active: true };
    else if (path === `/churches/${churchId}/members`) body = { items: loser.active ? [keeper, loser] : [keeper], continuationToken: null };
    else if (path === `/churches/${churchId}/members/keeper`) body = keeper;
    else if (path === `/churches/${churchId}/members/loser`) body = loser;
    else if (path.endsWith("/merge")) {
      if (url.searchParams.get("dryRun") === "true") body = { keeperCheckIns: 1, loserCheckIns: 2, movable: 1, skipped: 1 };
      else {
        writes++;
        loser = { ...loser, active: false };
        await route.abort("failed");
        return;
      }
    }
    await route.fulfill({ json: body });
  });
  await openComparison(page);
  await confirmMerge(page);
  await expect(page.getByText(/Merge completion could not be confirmed/)).toBeVisible();
  await page.getByRole("button", { name: "Check status", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Resolve duplicate" })).toHaveCount(0);
  await expect(page.getByText("The other member is already archived.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Review possible duplicate Ada Example" })).toHaveCount(0);
  expect(writes).toBe(1);
});