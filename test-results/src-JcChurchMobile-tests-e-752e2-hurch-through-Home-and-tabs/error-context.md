# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: src/JcChurchMobile/tests/e2e/workflows.spec.ts >> event navigation preserves the selected church through Home and tabs
- Location: src/JcChurchMobile/tests/e2e/workflows.spec.ts:268:5

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/", waiting until "load"

```

# Test source

```ts
  199 |   expect(groupWrites).toMatchObject([
  200 |     { name: "Youth", parentGroupId: null },
  201 |     { name: "High School" },
  202 |     { name: "High School" },
  203 |   ]);
  204 |   expect(memberWrites[0]).toMatchObject({ groupIds: ["group_2"] });
  205 | });
  206 | 
  207 | test("group drafts survive uncertain writes without duplicate submission", async ({ page }) => {
  208 |   let saved = { ...metadata("group_existing", alpha.id), name: "Existing", parentGroupId: null };
  209 |   let creates = 0;
  210 |   let updates = 0;
  211 |   let archives = 0;
  212 |   await page.route("**/api/v1/**", async route => {
  213 |     const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
  214 |     const method = route.request().method();
  215 |     if (path.endsWith("/groups") && method === "POST") {
  216 |       creates++;
  217 |       await route.abort("failed");
  218 |       return;
  219 |     }
  220 |     if (path.endsWith(`/groups/${saved.id}`) && method !== "GET") {
  221 |       expect(route.request().headers()["if-match"]).toBe(saved._etag);
  222 |       if (method === "PUT") {
  223 |         updates++;
  224 |         saved = { ...saved, ...route.request().postDataJSON(), _etag: '"updated"' };
  225 |       } else {
  226 |         archives++;
  227 |         saved = { ...saved, active: false, _etag: '"archived"' };
  228 |       }
  229 |       await route.abort("failed");
  230 |       return;
  231 |     }
  232 |     await route.fulfill({ json: path === `/churches/${alpha.id}` ? alpha
  233 |       : path.endsWith(`/groups/${saved.id}`) ? saved : pageBody([saved]) });
  234 |   });
  235 |   await page.goto(`/church/${alpha.id}/groups`);
  236 |   await page.getByRole("button", { name: "Add group", exact: true }).first().click();
  237 |   await page.getByRole("textbox", { name: "Group name", exact: true }).fill("Draft");
  238 |   await page.getByRole("button", { name: "Close", exact: true }).click();
  239 |   await expect(page.getByRole("heading", { name: "Discard unsaved changes?" })).toBeVisible();
  240 |   await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  241 |   await page.getByRole("button", { name: "Save group", exact: true }).click();
  242 |   await expect(page.getByText(/Creation could not be confirmed/)).toBeVisible();
  243 |   await expect(page.getByRole("textbox", { name: "Group name", exact: true })).toHaveValue("Draft");
  244 |   await expect(page.getByRole("button", { name: "Save group", exact: true })).toBeDisabled();
  245 |   expect(creates).toBe(1);
  246 |   await page.getByRole("button", { name: "Close", exact: true }).click();
  247 |   await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  248 |   await page.getByRole("button", { name: /Existing Top-level group/ }).click();
  249 |   await page.getByRole("textbox", { name: "Group name", exact: true }).fill("Recovered");
  250 |   await page.getByRole("button", { name: "Save group", exact: true }).click();
  251 |   await expect(page.getByText(/Confirmation pending/)).toBeVisible();
  252 |   await expect(page.getByRole("button", { name: "Save group", exact: true })).toBeDisabled();
  253 |   await expect(page.getByRole("button", { name: "Archive group", exact: true })).toBeDisabled();
  254 |   await page.getByRole("button", { name: "Reload latest version", exact: true }).click();
  255 |   await expect(page.getByRole("textbox", { name: "Group name", exact: true })).toHaveValue("Recovered");
  256 |   expect(updates).toBe(1);
  257 |   await page.getByRole("button", { name: "Archive group", exact: true }).click();
  258 |   await page.getByRole("button", { name: "Confirm archive", exact: true }).click();
  259 |   await expect(page.getByText(/Confirmation pending/)).toBeVisible();
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
> 299 |   await page.goto("/");
      |              ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
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
  360 |   await page.goto(`/church/${alpha.id}/events`);
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
```