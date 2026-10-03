# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: src/JcChurchMobile/tests/e2e/workflows.spec.ts >> session groups can be changed from session details
- Location: src/JcChurchMobile/tests/e2e/workflows.spec.ts:576:5

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/church/church_alpha/check-in?eventId=event_sample&occurrenceId=occ_sample", waiting until "load"

```

# Test source

```ts
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
  524 |   await page.goto(
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
> 609 |   await page.goto(
      |              ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
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
  625 |   async function decodeCard() {
  626 |     const pixels = await page.locator("svg").last().evaluate(async (element, density) => {
  627 |       const image = new Image();
  628 |       const loaded = new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; });
  629 |       image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(element));
  630 |       await loaded;
  631 |       const canvas = document.createElement("canvas");
  632 |       canvas.width = image.width * density;
  633 |       canvas.height = image.height * density;
  634 |       const context = canvas.getContext("2d")!;
  635 |       context.fillStyle = "white";
  636 |       context.fillRect(0, 0, canvas.width, canvas.height);
  637 |       context.drawImage(image, 0, 0, canvas.width, canvas.height);
  638 |       const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  639 |       return { width: canvas.width, height: canvas.height,
  640 |         gray: Array.from({ length: canvas.width * canvas.height }, (_, index) => rgba[index * 4]) };
  641 |     }, saved.scanCodeFormat === "qr" ? 2 : 3);
  642 |     const source = new RGBLuminanceSource(Uint8ClampedArray.from(pixels.gray), pixels.width, pixels.height);
  643 |     const reader = new MultiFormatReader();
  644 |     reader.setHints(new Map([[DecodeHintType.POSSIBLE_FORMATS, [saved.scanCodeFormat === "qr" ? BarcodeFormat.QR_CODE : BarcodeFormat.CODE_128]]]));
  645 |     expect(reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(source))).getText()).toBe(saved.scanCode);
  646 |   }
  647 |   const writes: unknown[] = [];
  648 |   let attendanceWrites = 0;
  649 |   await page.route("**/api/v1/**", async route => {
  650 |     const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
  651 |     let body: unknown = pageBody([]);
  652 |     if (path === `/churches/${alpha.id}`) body = alpha;
  653 |     else if (path.endsWith("/members")) body = pageBody([saved]);
  654 |     else if (path.endsWith(`/members/${jordan.id}`)) {
  655 |       if (route.request().method() === "PUT") {
  656 |         writes.push(route.request().postDataJSON());
  657 |         saved = { ...saved, ...route.request().postDataJSON(), _etag: '"second"' };
  658 |       }
  659 |       body = saved;
  660 |     }
  661 |     if (path.includes("check-ins") && route.request().method() === "POST") attendanceWrites++;
  662 |     await route.fulfill({ json: body });
  663 |   });
  664 |   await page.goto(`/church/${alpha.id}/members`);
  665 |   await page.getByRole("button", { name: /Jordan Example/ }).click();
  666 |   await expect(page.getByRole("button", { name: "Print member card", exact: true })).toBeVisible();
  667 |   await decodeCard();
  668 |   await page.getByRole("button", { name: "Edit member", exact: true }).click();
  669 |   await page.getByRole("button", { name: "Scan member code", exact: true }).click();
  670 |   const input = page.getByRole("textbox", { name: "Scan or enter code", exact: true });
  671 |   await input.fill("0000-replaced");
  672 |   await input.press("Enter");
  673 |   await expect(page.getByRole("textbox", { name: "Member scan code", exact: true })).toHaveValue("0000-REPLACED");
  674 |   await expect(page.getByRole("button", { name: "Print member card", exact: true })).toHaveCount(0);
  675 |   await page.getByRole("tab", { name: "Barcode", exact: true }).click();
  676 |   await page.getByRole("button", { name: "Save member", exact: true }).click();
  677 |   await expect(page.getByText(/old card will stop working/)).toBeVisible();
  678 |   expect(writes).toHaveLength(0);
  679 |   await page.getByRole("button", { name: "Confirm replacement", exact: true }).click();
  680 |   await expect(page.getByText("Member saved.", { exact: true })).toBeVisible();
  681 |   expect(writes).toHaveLength(1);
  682 |   expect(writes[0]).toMatchObject({ scanCode: "0000-REPLACED", scanCodeFormat: "code128" });
  683 |   expect(attendanceWrites).toBe(0);
  684 |   await page.getByRole("button", { name: /Jordan Example/ }).click();
  685 |   await expect(page.getByRole("button", { name: "Print member card", exact: true })).toBeVisible();
  686 |   await expect(page.locator("svg").last()).toBeVisible();
  687 |   await decodeCard();
  688 |   saved = { ...saved, scanCode: "0000" + "ABCD1234EFGH".repeat(5) };
  689 |   await page.reload();
  690 |   await page.getByRole("button", { name: /Jordan Example/ }).click();
  691 |   await expect(page.getByRole("button", { name: "Print member card", exact: true })).toBeVisible();
  692 |   await decodeCard();
  693 |   await page.screenshot({ path: testInfo.outputPath("synthetic-scan-card.png"), fullPage: true });
  694 | });
  695 | 
  696 | test("scan check-in submits automatically, suppresses repeats and recovers uncertain receipts", async ({ page }) => {
  697 |   const receipt = { ...metadata("scan_receipt", alpha.id), memberId: jordan.id, occurrenceId: sampleSession.id,
  698 |     eventId: sampleEvent.id, checkedInAt: new Date().toISOString() };
  699 |   const submitted: string[] = [];
  700 |   let confirmed = false;
  701 |   let statusReads = 0;
  702 |   await page.route("**/api/v1/**", async route => {
  703 |     const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
  704 |     let body: unknown = pageBody([]);
  705 |     if (path === `/churches/${alpha.id}`) body = alpha;
  706 |     else if (path.endsWith(`/events/${sampleEvent.id}`)) body = sampleEvent;
  707 |     else if (path.endsWith(`/occurrences/${sampleSession.id}`)) body = sampleSession;
  708 |     else if (path.endsWith("/scan-check-ins/status")) {
  709 |       if (++statusReads === 1) {
```