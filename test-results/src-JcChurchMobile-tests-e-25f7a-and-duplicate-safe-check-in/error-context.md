# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: src/JcChurchMobile/tests/e2e/workflows.spec.ts >> church settings, members, sessions and duplicate-safe check-in
- Location: src/JcChurchMobile/tests/e2e/workflows.spec.ts:750:5

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/", waiting until "load"

```

# Test source

```ts
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
> 759 |     await page.goto("/");
      |                ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  760 |     await expect(
  761 |       page.getByRole("heading", { name: "Choose your church" }),
  762 |     ).toBeVisible();
  763 |     await page.getByRole("button", { name: "Settings" }).click();
  764 |     await page
  765 |       .getByRole("button", { name: "Create church", exact: true })
  766 |       .last()
  767 |       .click();
  768 |     await page
  769 |       .getByRole("textbox", { name: "Church name", exact: true })
  770 |       .fill(name);
  771 |     const created = page.waitForResponse(
  772 |       (response) =>
  773 |         response.url().endsWith("/api/v1/churches") &&
  774 |         response.request().method() === "POST",
  775 |     );
  776 |     await page
  777 |       .getByRole("button", { name: "Save church", exact: true })
  778 |       .click();
  779 |     const church = await (await created).json();
  780 |     churchId = church.id;
  781 |     await expect(
  782 |       page.getByText("Church saved.", { exact: true }),
  783 |     ).toBeVisible();
  784 |     await page.goto("/");
  785 |     await page.getByRole("textbox", { name: "Search churches" }).fill(name);
  786 |     await page.getByRole("button", { name: new RegExp(name) }).click();
  787 |     await page.getByRole("button", { name: "Settings" }).click();
  788 |     await page.getByRole("button", { name: /Manage groups/ }).click();
  789 |     await page.getByRole("button", { name: "Add group", exact: true }).first().click();
  790 |     await page.getByRole("textbox", { name: "Group name", exact: true }).fill("Youth");
  791 |     await page.getByRole("button", { name: "Save group", exact: true }).click();
  792 |     await page.getByRole("button", { name: "Add subgroup under Youth", exact: true }).click();
  793 |     await page.getByRole("textbox", { name: "Subgroup name", exact: true }).fill("High School");
  794 |     await page.getByRole("button", { name: "Save subgroup", exact: true }).click();
  795 |     await expect(page.getByRole("button", { name: /High School Youth/ })).toBeVisible();
  796 |     await page.getByRole("button", { name: "Settings" }).click();
  797 |     await page.getByRole("button", { name: /Manage custom fields/ }).click();
  798 |     await page.getByRole("button", { name: "Add custom field", exact: true }).first().click();
  799 |     await page.getByRole("textbox", { name: "Field name", exact: true }).fill("Emergency contact");
  800 |     await page.getByRole("button", { name: "Save custom field", exact: true }).click();
  801 |     await expect(page.getByRole("button", { name: /Emergency contact Text/ })).toBeVisible();
  802 |     await page.getByRole("tab", { name: "Home", exact: true }).click();
  803 |     await page.getByRole("button", { name: /Manage members/ }).click();
  804 |     await page.getByRole("button", { name: "Add member", exact: true }).click();
  805 |     await page
  806 |       .getByRole("textbox", { name: "First name", exact: true })
  807 |       .fill("Jordan");
  808 |     await page
  809 |       .getByRole("textbox", { name: "Last name", exact: true })
  810 |       .fill("Sample");
  811 |     await page
  812 |       .getByRole("textbox", { name: "Emergency contact", exact: true })
  813 |       .fill("Taylor Sample");
  814 |     await page.getByLabel("Youth / High School", { exact: true }).check();
  815 |     await page
  816 |       .getByRole("button", { name: "Save member", exact: true })
  817 |       .click();
  818 |     await expect(
  819 |       page.getByText("Member saved.", { exact: true }),
  820 |     ).toBeVisible();
  821 |     await page.getByRole("button", { name: /Jordan Sample/ }).click();
  822 |     await page
  823 |       .getByRole("button", { name: "Edit member", exact: true })
  824 |       .click();
  825 |     await page
  826 |       .getByRole("textbox", { name: "School", exact: true })
  827 |       .fill("Sample Academy");
  828 |     await page
  829 |       .getByRole("button", { name: "Save member", exact: true })
  830 |       .click();
  831 |     await expect(
  832 |       page.getByRole("button", { name: /Jordan Sample/ }),
  833 |     ).toContainText("Youth / High School");
  834 |     await page.goto(`/church/${churchId}/events`);
  835 |     await page.getByRole("button", { name: "Add event", exact: true }).click();
  836 |     await page
  837 |       .getByRole("textbox", { name: "Event name", exact: true })
  838 |       .fill("Sunday Gathering");
  839 |     const startDate = new Date(Date.now() + 24 * 60 * 60000)
  840 |       .toISOString()
  841 |       .slice(0, 10);
  842 |     const startDateInput = page.locator('input[aria-label="Start date"]');
  843 |     const startTimeInput = page.locator('input[aria-label="Start time"]');
  844 |     await expect(startDateInput).toHaveAttribute("type", "date");
  845 |     await expect(startTimeInput).toHaveAttribute("type", "time");
  846 |     await startDateInput.fill(startDate);
  847 |     await startTimeInput.fill("09:00");
  848 |     await page.getByLabel("Timezone", { exact: true }).selectOption("UTC");
  849 |     await page.getByRole("button", { name: "Save event", exact: true }).click();
  850 |     await expect(page.getByText("Event saved.", { exact: true })).toBeVisible();
  851 |     await page
  852 |       .getByRole("button", { name: "Generate next occurrence", exact: true })
  853 |       .click();
  854 |     await expect(
  855 |       page.getByText("Next session created.", { exact: true }),
  856 |     ).toBeVisible();
  857 |     await page
  858 |       .getByRole("button", { name: "Generate next occurrence", exact: true })
  859 |       .click();
```