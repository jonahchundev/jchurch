# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: src/JcChurchMobile/tests/e2e/workflows.spec.ts >> cancelling an occurrence dismisses confirmation and shows cancelled status only
- Location: src/JcChurchMobile/tests/e2e/workflows.spec.ts:336:5

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/church/church_alpha/events", waiting until "load"

```

# Test source

```ts
  260 |   await expect(page.getByRole("button", { name: "Confirm archive", exact: true })).toBeDisabled();
  261 |   await page.getByRole("button", { name: "Reload latest version", exact: true }).click();
  262 |   await expect(page.getByText("This group is archived.", { exact: true })).toBeVisible();
  263 |   await page.getByRole("button", { name: "Close", exact: true }).click();
  264 |   await expect(page.getByRole("button", { name: /Recovered Archived group/ })).toBeVisible();
  265 |   expect(archives).toBe(1);
  266 | });
  267 | 
  268 | test("event navigation preserves the selected church through Home and tabs", async ({ page }) => {
  269 |   const missingPaths: string[] = [];
  270 |   const laterSession = {
  271 |     ...sampleSession,
  272 |     id: "occ_later",
  273 |     startsAt: new Date(Date.parse(sampleSession.startsAt) + 86400000).toISOString(),
  274 |     endsAt: new Date(Date.parse(sampleSession.endsAt) + 86400000).toISOString(),
  275 |   };
  276 |   await page.route("**/api/v1/**", async route => {
  277 |     const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
  278 |     let body: unknown;
  279 |     if (path === "/churches") body = pageBody([alpha, beta]);
  280 |     else if (path === `/churches/${alpha.id}`) body = alpha;
  281 |     else if (path === `/churches/${beta.id}`) body = beta;
  282 |     else if (path === `/churches/${alpha.id}/events`) body = pageBody([sampleEvent]);
  283 |     else if (path === `/churches/${beta.id}/events`) body = pageBody([]);
  284 |     else if ([alpha.id, beta.id].some(churchId => ["members", "groups", "custom-fields"].some(resource => path === `/churches/${churchId}/${resource}`))) body = pageBody([]);
  285 |     else if (path === `/churches/${alpha.id}/events/${sampleEvent.id}/occurrence-check-in-counts`) body = {
  286 |       items: [
  287 |         { occurrenceId: sampleSession.id, checkedInCount: 2 },
  288 |         { occurrenceId: laterSession.id, checkedInCount: 5 },
  289 |       ],
  290 |     };
  291 |     else if (path === `/churches/${alpha.id}/events/${sampleEvent.id}/occurrences`) body = pageBody([sampleSession, laterSession]);
  292 |     else {
  293 |       missingPaths.push(path);
  294 |       await route.fulfill({ status: 404, json: { detail: "Resource not found in this church." } });
  295 |       return;
  296 |     }
  297 |     await route.fulfill({ json: body });
  298 |   });
  299 |   await page.goto("/");
  300 |   await page.getByRole("button", { name: /Alpha Community/ }).click();
  301 |   await page.getByRole("tab", { name: "Members", exact: true }).click();
  302 |   await expect(page.getByText("No members found.", { exact: true })).toBeVisible();
  303 |   await page.getByRole("tab", { name: "Check-In", exact: true }).click();
  304 |   await expect(page.getByRole("heading", { name: "Choose an event", exact: true })).toBeVisible();
  305 |   await expect(page.getByRole("button", { name: /Community gathering/ })).toBeVisible();
  306 |   await page.getByRole("tab", { name: "Events", exact: true }).click();
  307 |   await expect(page.getByRole("button", { name: /Community gathering/ })).toBeVisible();
  308 |   await page.getByRole("button", { name: /Community gathering/ }).click();
  309 |   await expect(page.getByRole("button", { name: /Ends .*UTC/ }).first()).toBeVisible();
  310 |   await expect(page.getByRole("heading", { name: "Sessions", exact: true })).toHaveCount(0);
  311 |   const sessionRows = page.getByRole("button").filter({ hasText: /checked in/ });
  312 |   await expect(sessionRows).toHaveCount(2);
  313 |   await expect(sessionRows.nth(0)).toContainText("Upcoming");
  314 |   await expect(sessionRows.nth(0)).toContainText("2 checked in");
  315 |   await expect(sessionRows.nth(1)).toContainText("5 checked in");
  316 |   await expect(page.getByLabel("Date order", { exact: true })).toHaveValue("soonest");
  317 |   await page.getByLabel("Date order", { exact: true }).selectOption("latest");
  318 |   await expect(page.getByLabel("Date order", { exact: true })).toHaveValue("latest");
  319 |   await expect(sessionRows.nth(0)).toContainText("5 checked in");
  320 |   await expect(sessionRows.nth(1)).toContainText("2 checked in");
  321 |   await page.getByRole("button", { name: "Close", exact: true }).click();
  322 |   await page.getByRole("tab", { name: "Home", exact: true }).click();
  323 |   await page.getByRole("button", { name: /Manage events/ }).click();
  324 |   await expect(page.getByRole("button", { name: /Community gathering/ })).toBeVisible();
  325 |   await page.getByRole("button", { name: "Switch church", exact: true }).click();
  326 |   await page.getByRole("button", { name: /Beta Community/ }).click();
  327 |   await page.getByRole("tab", { name: "Events", exact: true }).click();
  328 |   await expect(page.getByText("No events found.", { exact: true })).toBeVisible();
  329 |   await page.getByRole("tab", { name: "Members", exact: true }).click();
  330 |   await expect(page.getByText("No members found.", { exact: true })).toBeVisible();
  331 |   await page.getByRole("tab", { name: "Check-In", exact: true }).click();
  332 |   await expect(page.getByText("No events available.", { exact: true })).toBeVisible();
  333 |   expect(missingPaths).toEqual([]);
  334 | });
  335 | 
  336 | test("cancelling an occurrence dismisses confirmation and shows cancelled status only", async ({ page }) => {
  337 |   const event = { ...sampleEvent, timeZone: "America/New_York" };
  338 |   let session = { ...sampleSession };
  339 |   await page.route("**/api/v1/**", async route => {
  340 |     const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
  341 |     const method = route.request().method();
  342 |     if (path === `/churches/${alpha.id}`)
  343 |       await route.fulfill({ json: alpha });
  344 |     else if (path === `/churches/${alpha.id}/events`)
  345 |       await route.fulfill({ json: pageBody([event]) });
  346 |     else if (path === `/churches/${alpha.id}/events/${event.id}/occurrences`)
  347 |       await route.fulfill({ json: pageBody([session]) });
  348 |     else if (path === `/churches/${alpha.id}/events/${event.id}/occurrence-check-in-counts`)
  349 |       await route.fulfill({ json: { items: [] } });
  350 |     else if (path === `/churches/${alpha.id}/occurrences/${session.id}` && method === "PUT") {
  351 |       session = {
  352 |         ...session,
  353 |         ...route.request().postDataJSON(),
  354 |         overridden: true,
  355 |         _etag: '"cancelled"',
  356 |       };
  357 |       await route.fulfill({ json: session });
  358 |     } else await route.fulfill({ json: pageBody([]) });
  359 |   });
> 360 |   await page.goto(`/church/${alpha.id}/events`);
      |              ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  361 |   await page.getByRole("button", { name: /Community gathering/ }).click();
  362 |   const sessionRow = page.getByRole("button").filter({ hasText: /checked in/ });
  363 |   await expect(sessionRow).toContainText("Eastern Time");
  364 |   await sessionRow.click();
  365 |   await page.getByRole("button", { name: "Cancel occurrence", exact: true }).click();
  366 |   await expect(page.getByRole("alert")).toContainText("Cancel this occurrence?");
  367 |   await page.getByRole("button", { name: "Confirm cancellation", exact: true }).click();
  368 |   await expect(page.getByText("Cancel this occurrence?", { exact: false })).toHaveCount(0);
  369 |   await expect(page.getByText("This occurrence is cancelled and unavailable for check-in.", { exact: true })).toBeVisible();
  370 |   await page.getByRole("button", { name: "Close", exact: true }).click();
  371 |   await expect(sessionRow).toContainText("Cancelled");
  372 |   await expect(sessionRow).not.toContainText("Rescheduled");
  373 |   await expect(sessionRow).not.toContainText("Upcoming");
  374 |   await expect(page.getByText("Cancelled", { exact: true })).toHaveCSS("color", "rgb(175, 53, 68)");
  375 | });
  376 | 
  377 | test("draft protection, stale edits, pagination and church isolation", async ({
  378 |   page,
  379 | }, testInfo) => {
  380 |   let saved = { ...jordan };
  381 |   let stale = true;
  382 |   let savedEtag = "";
  383 |   await page.route("**/api/v1/**", async (route) => {
  384 |     const url = new URL(route.request().url());
  385 |     const path = url.pathname.replace("/api/v1", "");
  386 |     const method = route.request().method();
  387 |     let body: unknown = pageBody([]);
  388 |     if (path === "/churches") body = pageBody([alpha, beta]);
  389 |     else if (path === `/churches/${alpha.id}`) body = alpha;
  390 |     else if (path === `/churches/${beta.id}`) body = beta;
  391 |     else if (path === `/churches/${alpha.id}/members`)
  392 |       body = url.searchParams.has("continuationToken")
  393 |         ? pageBody([secondMember])
  394 |         : pageBody([saved], "next+token");
  395 |     else if (path === `/churches/${alpha.id}/members/${jordan.id}`) {
  396 |       if (method === "PUT") {
  397 |         if (stale) {
  398 |           stale = false;
  399 |           saved = { ...saved, firstName: "Updated", _etag: '"latest"' };
  400 |           await route.fulfill({
  401 |             status: 412,
  402 |             json: { detail: "ETag is stale." },
  403 |           });
  404 |           return;
  405 |         }
  406 |         savedEtag = route.request().headers()["if-match"] ?? "";
  407 |         saved = { ...saved, ...route.request().postDataJSON() };
  408 |       }
  409 |       body = saved;
  410 |     }
  411 |     await route.fulfill({ json: body });
  412 |   });
  413 |   await page.goto("/");
  414 |   await page.getByRole("button", { name: /Alpha Community/ }).click();
  415 |   await page.getByRole("button", { name: /Manage members/ }).click();
  416 |   await page.getByRole("button", { name: "Load more members" }).click();
  417 |   await expect(
  418 |     page.getByRole("button", { name: /Casey Example/ }),
  419 |   ).toBeVisible();
  420 |   await page.getByRole("button", { name: /Jordan Example/ }).click();
  421 |   await page.getByRole("button", { name: "Edit member", exact: true }).click();
  422 |   await page
  423 |     .getByRole("textbox", { name: "First name", exact: true })
  424 |     .fill("Draft");
  425 |   await page.getByRole("button", { name: "Close", exact: true }).click();
  426 |   await expect(
  427 |     page.getByRole("heading", { name: "Discard unsaved changes?" }),
  428 |   ).toBeVisible();
  429 |   await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  430 |   await expect(
  431 |     page.getByRole("textbox", { name: "First name", exact: true }),
  432 |   ).toHaveValue("Draft");
  433 |   await page.getByRole("button", { name: "Save member", exact: true }).click();
  434 |   await expect(page.getByRole("alert")).toContainText(
  435 |     "This record changed elsewhere",
  436 |   );
  437 |   await expect(
  438 |     page.getByRole("textbox", { name: "First name", exact: true }),
  439 |   ).toHaveValue("Draft");
  440 |   await page
  441 |     .getByRole("button", { name: "Reload latest version", exact: true })
  442 |     .click();
  443 |   await expect(
  444 |     page.getByRole("textbox", { name: "First name", exact: true }),
  445 |   ).toHaveValue("Updated");
  446 |   await page
  447 |     .getByRole("textbox", { name: "First name", exact: true })
  448 |     .fill("Reviewed");
  449 |   await page.getByRole("button", { name: "Save member", exact: true }).click();
  450 |   await expect(page.getByText("Member saved.", { exact: true })).toBeVisible();
  451 |   expect(savedEtag).toBe('"latest"');
  452 |   await page.getByRole("tab", { name: "Home", exact: true }).click();
  453 |   await page.getByRole("tab", { name: "Members", exact: true }).click();
  454 |   await expect(page.getByRole("button", { name: /Reviewed Example/ })).toBeVisible();
  455 |   await expect(page.getByText("Member saved.", { exact: true })).toHaveCount(0);
  456 |   const tabLabel = page
  457 |     .getByRole("tab", { name: "Members", exact: true })
  458 |     .getByText("Members", { exact: true });
  459 |   const bounds = await tabLabel.boundingBox();
  460 |   expect(bounds).not.toBeNull();
```