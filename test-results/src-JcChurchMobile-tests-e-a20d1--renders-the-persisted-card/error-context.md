# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: src/JcChurchMobile/tests/e2e/workflows.spec.ts >> member scan code reissue saves only after confirmation and renders the persisted card
- Location: src/JcChurchMobile/tests/e2e/workflows.spec.ts:623:5

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/church/church_alpha/members", waiting until "load"

```

# Test source

```ts
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
> 664 |   await page.goto(`/church/${alpha.id}/members`);
      |              ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
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
  710 |         await route.fulfill({ status: 429, headers: { "Retry-After": "1" }, json: { detail: "Scan rate limit reached." } });
  711 |         return;
  712 |       }
  713 |       body = { checkedIn: confirmed, receipt: confirmed ? receipt : null, member: jordan };
  714 |     }
  715 |     else if (path.endsWith("/scan-check-ins")) {
  716 |       const code = route.request().postDataJSON().scanCode;
  717 |       submitted.push(code);
  718 |       if (code === "UNKNOWN-CODE") { await route.fulfill({ status: 404, json: { detail: "No matching member for this scan code." } }); return; }
  719 |       if (code === "UNCERTAIN-CODE") { await route.abort("failed"); return; }
  720 |       body = { receipt, member: jordan, already: false };
  721 |     }
  722 |     await route.fulfill({ json: body });
  723 |   });
  724 |   await page.goto(`/church/${alpha.id}/check-in?eventId=${sampleEvent.id}&occurrenceId=${sampleSession.id}`);
  725 |   await page.getByRole("button", { name: "Begin check-in", exact: true }).click();
  726 |   await page.getByRole("tab", { name: "Scan", exact: true }).click();
  727 |   const input = page.getByRole("textbox", { name: "Scan or enter code", exact: true });
  728 |   await input.fill("0000-code");
  729 |   await input.press("Enter");
  730 |   await expect(page.getByText(/Jordan Example: Checked in/)).toBeVisible();
  731 |   await input.fill("0000-code");
  732 |   await input.press("Enter");
  733 |   await input.fill("unknown-code");
  734 |   await input.press("Enter");
  735 |   await expect(page.getByText("No matching member for this scan code.")).toBeVisible();
  736 |   expect(submitted).toEqual(["0000-CODE", "UNKNOWN-CODE"]);
  737 |   await input.fill("uncertain-code");
  738 |   await input.press("Enter");
  739 |   await expect(page.getByText("Confirmation pending", { exact: true })).toBeVisible();
  740 |   await expect(input).not.toBeEditable();
  741 |   await expect(page.getByRole("button", { name: "Change session", exact: true })).toBeDisabled();
  742 |   await expect(page.getByRole("button", { name: "Check scan status", exact: true })).toBeDisabled();
  743 |   confirmed = true;
  744 |   await page.getByRole("button", { name: "Check scan status", exact: true }).click();
  745 |   await expect(page.getByText(/Jordan Example: Already checked in/)).toBeVisible();
  746 |   expect(submitted.filter(code => code === "UNCERTAIN-CODE")).toHaveLength(1);
  747 |   await expect(input).toBeEditable();
  748 | });
  749 | 
  750 | test("church settings, members, sessions and duplicate-safe check-in", async ({
  751 |   page,
  752 |   request,
  753 | }, testInfo) => {
  754 |   const name = `Mobile QA ${testInfo.project.name} ${Date.now()}`;
  755 |   const errors: string[] = [];
  756 |   page.on("pageerror", (error) => errors.push(error.message));
  757 |   let churchId: string | undefined;
  758 |   try {
  759 |     await page.goto("/");
  760 |     await expect(
  761 |       page.getByRole("heading", { name: "Choose your church" }),
  762 |     ).toBeVisible();
  763 |     await page.getByRole("button", { name: "Settings" }).click();
  764 |     await page
```