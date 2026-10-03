# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: src/JcChurchMobile/tests/e2e/workflows.spec.ts >> uncertain check-in stays pending until retry and cancelled sessions are blocked
- Location: src/JcChurchMobile/tests/e2e/workflows.spec.ts:482:5

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/church/church_alpha/check-in?eventId=event_sample&occurrenceId=occ_sample", waiting until "load"

```

# Test source

```ts
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
  461 |   expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
  462 |     await page.evaluate(() => window.innerHeight),
  463 |   );
  464 |   await page
  465 |     .getByRole("button", { name: "Switch church", exact: true })
  466 |     .click();
  467 |   await page.getByRole("button", { name: /Beta Community/ }).click();
  468 |   await page.screenshot({
  469 |     path: testInfo.outputPath("home.png"),
  470 |     fullPage: true,
  471 |   });
  472 |   await page.getByRole("button", { name: /Manage members/ }).click();
  473 |   await expect(
  474 |     page.getByText("No members found.", { exact: true }),
  475 |   ).toBeVisible();
  476 |   await expect(page.getByText("Reviewed Example", { exact: true })).toHaveCount(
  477 |     0,
  478 |   );
  479 |   await expect(page.getByText("Casey Example", { exact: true })).toHaveCount(0);
  480 | });
  481 | 
  482 | test("uncertain check-in stays pending until retry and cancelled sessions are blocked", async ({
  483 |   page,
  484 | }) => {
  485 |   let attempts = 0;
  486 |   let cancelled = false;
  487 |   const receipt = {
  488 |     ...metadata("receipt", alpha.id),
  489 |     memberId: jordan.id,
  490 |     eventId: sampleEvent.id,
  491 |     occurrenceId: sampleSession.id,
  492 |     checkedInAt: new Date().toISOString(),
  493 |   };
  494 |   const submitted: unknown[] = [];
  495 |   await page.route("**/api/v1/**", async (route) => {
  496 |     const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
  497 |     let body: unknown = pageBody([]);
  498 |     if (path === `/churches/${alpha.id}`) body = alpha;
  499 |     else if (path === `/churches/${alpha.id}/events`) body = pageBody([sampleEvent]);
  500 |     else if (path.endsWith(`/events/${sampleEvent.id}`)) body = sampleEvent;
  501 |     else if (path.endsWith(`/occurrences/${sampleSession.id}`))
  502 |       body = { ...sampleSession, cancelled };
  503 |     else if (path.endsWith(`/events/${sampleEvent.id}/occurrence-check-in-counts`))
  504 |       body = { items: [] };
  505 |     else if (path.endsWith(`/events/${sampleEvent.id}/occurrences`))
  506 |       body = pageBody([{ ...sampleSession, cancelled }]);
  507 |     else if (path.endsWith("/members")) body = pageBody([jordan]);
  508 |     else if (path.endsWith(`/check-ins/${jordan.id}`))
  509 |       body = { checkedIn: false, receipt: null };
  510 |     else if (
  511 |       path.endsWith("/check-ins") &&
  512 |       route.request().method() === "POST"
  513 |     ) {
  514 |       attempts++;
  515 |       submitted.push(route.request().postDataJSON());
  516 |       if (attempts === 1) {
  517 |         await route.abort("failed");
  518 |         return;
  519 |       }
  520 |       body = receipt;
  521 |     }
  522 |     await route.fulfill({ json: body });
  523 |   });
> 524 |   await page.goto(
      |              ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  525 |     `/church/${alpha.id}/check-in?eventId=${sampleEvent.id}&occurrenceId=${sampleSession.id}`,
  526 |   );
  527 |   await page
  528 |     .getByRole("button", { name: "Begin check-in", exact: true })
  529 |     .click();
  530 |   await page
  531 |     .getByRole("button", { name: "Check in", exact: true })
  532 |     .click();
  533 |   await expect(page.getByRole("alert")).toContainText("Confirmation pending");
  534 |   await expect(page.getByText(/^Checked in ·/)).toHaveCount(0);
  535 |   await expect(page.getByText(/^Already checked in ·/)).toHaveCount(0);
  536 |   await page.getByRole("button", { name: "Retry", exact: true }).click();
  537 |   await expect(page.getByText(/^Already checked in ·/)).toBeVisible();
  538 |   expect(submitted).toEqual([{ memberId: jordan.id }, { memberId: jordan.id }]);
  539 |   cancelled = true;
  540 |   await page.reload();
  541 |   await expect(page.getByRole("alert")).toContainText("cancelled");
  542 |   await expect(
  543 |     page.getByRole("button", { name: "Begin check-in", exact: true }),
  544 |   ).toBeDisabled();
  545 | });
  546 | 
  547 | test("closing a session editor returns to active check-in", async ({ page }) => {
  548 |   await page.route("**/api/v1/**", async (route) => {
  549 |     const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
  550 |     let body: unknown = pageBody([]);
  551 |     if (path === `/churches/${alpha.id}`) body = alpha;
  552 |     else if (path === `/churches/${alpha.id}/events`) body = pageBody([sampleEvent]);
  553 |     else if (path.endsWith(`/events/${sampleEvent.id}`)) body = sampleEvent;
  554 |     else if (path.endsWith(`/occurrences/${sampleSession.id}`)) body = sampleSession;
  555 |     else if (path.endsWith(`/events/${sampleEvent.id}/occurrence-check-in-counts`))
  556 |       body = { items: [] };
  557 |     else if (path.endsWith(`/events/${sampleEvent.id}/occurrences`))
  558 |       body = pageBody([sampleSession]);
  559 |     else if (path.endsWith("/members")) body = pageBody([jordan]);
  560 |     else if (path.endsWith(`/check-ins/${jordan.id}`))
  561 |       body = { checkedIn: false, receipt: null };
  562 |     await route.fulfill({ json: body });
  563 |   });
  564 |   await page.goto(
  565 |     `/church/${alpha.id}/check-in?eventId=${sampleEvent.id}&occurrenceId=${sampleSession.id}`,
  566 |   );
  567 |   await page.getByRole("button", { name: "Begin check-in", exact: true }).click();
  568 |   await expect(page.getByText("UTC", { exact: true })).toHaveCount(0);
  569 |   await page.getByRole("button", { name: "Edit session", exact: true }).click();
  570 |   await expect(page.getByRole("heading", { name: "Session details", exact: true })).toBeVisible();
  571 |   await page.getByRole("button", { name: "Close", exact: true }).click();
  572 |   await expect(page.getByRole("heading", { name: "Session details", exact: true })).toHaveCount(0);
  573 |   await expect(page.getByRole("button", { name: "Edit session", exact: true })).toBeVisible();
  574 | });
  575 | 
  576 | test("session groups can be changed from session details", async ({ page }) => {
  577 |   const adults = { ...metadata("group_adults", alpha.id), name: "Adults", parentGroupId: null };
  578 |   let session = {
  579 |     ...sampleSession,
  580 |     startsAt: new Date(Date.now() - 15 * 60000).toISOString(),
  581 |     endsAt: new Date(Date.now() + 45 * 60000).toISOString(),
  582 |     groupIds: [] as string[],
  583 |   };
  584 |   const writes: unknown[] = [];
  585 |   await page.route("**/api/v1/**", async (route) => {
  586 |     const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
  587 |     const method = route.request().method();
  588 |     let body: unknown = pageBody([]);
  589 |     if (path === `/churches/${alpha.id}`) body = alpha;
  590 |     else if (path === `/churches/${alpha.id}/events`) body = pageBody([sampleEvent]);
  591 |     else if (path.endsWith(`/events/${sampleEvent.id}`)) body = sampleEvent;
  592 |     else if (path === `/churches/${alpha.id}/groups`) body = pageBody([adults]);
  593 |     else if (path.endsWith(`/occurrences/${sampleSession.id}`)) {
  594 |       if (method === "PUT") {
  595 |         const input = route.request().postDataJSON();
  596 |         writes.push(input);
  597 |         session = { ...session, ...input, _etag: '"groups-saved"' };
  598 |       }
  599 |       body = session;
  600 |     } else if (path.endsWith(`/events/${sampleEvent.id}/occurrence-check-in-counts`))
  601 |       body = { items: [] };
  602 |     else if (path.endsWith(`/events/${sampleEvent.id}/occurrences`))
  603 |       body = pageBody([session]);
  604 |     else if (path.endsWith("/members")) body = pageBody([jordan]);
  605 |     else if (path.endsWith(`/check-ins/${jordan.id}`))
  606 |       body = { checkedIn: false, receipt: null };
  607 |     await route.fulfill({ json: body });
  608 |   });
  609 |   await page.goto(
  610 |     `/church/${alpha.id}/check-in?eventId=${sampleEvent.id}&occurrenceId=${sampleSession.id}`,
  611 |   );
  612 |   await page.getByRole("button", { name: "Begin check-in", exact: true }).click();
  613 |   await page.getByRole("button", { name: "Edit session", exact: true }).click();
  614 |   await page.getByLabel("Adults", { exact: true }).click();
  615 |   await page.getByRole("button", { name: "Save session", exact: true }).click();
  616 |   await expect(page.getByText("Session saved.", { exact: true })).toBeVisible();
  617 |   expect(writes).toHaveLength(1);
  618 |   expect(writes[0]).toMatchObject({ groupIds: [adults.id] });
  619 |   await page.getByRole("button", { name: "Close", exact: true }).click();
  620 |   await expect(page.getByText("Groups: Adults", { exact: true })).toBeVisible();
  621 | });
  622 | 
  623 | test("member scan code reissue saves only after confirmation and renders the persisted card", async ({ page }, testInfo) => {
  624 |   let saved = { ...jordan, scanCode: "0000-ORIGINAL", scanCodeFormat: "qr" };
```