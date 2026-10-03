# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: src/JcChurchMobile/tests/e2e/workflows.spec.ts >> group drafts survive uncertain writes without duplicate submission
- Location: src/JcChurchMobile/tests/e2e/workflows.spec.ts:207:5

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/church/church_alpha/groups", waiting until "load"

```

# Test source

```ts
  135 |   await page.goto(`/church/${alpha.id}`);
  136 |   await page.getByRole("button", { name: "Settings" }).click();
  137 |   await page.getByRole("button", { name: /Manage groups/ }).click();
  138 |   await expect(page.getByRole("heading", { name: "Groups", exact: true })).toBeVisible();
  139 |   await page.getByRole("button", { name: "Add group", exact: true }).first().click();
  140 |   await page.getByRole("textbox", { name: "Group name", exact: true }).fill("Youth");
  141 |   await page.getByRole("button", { name: "Save group", exact: true }).click();
  142 |   await expect(page.getByText("Group saved.", { exact: true })).toBeVisible();
  143 |   await page.getByRole("button", { name: "Add subgroup under Youth", exact: true }).click();
  144 |   await expect(page.getByText("Parent group: Youth", { exact: true })).toBeVisible();
  145 |   await page.getByRole("textbox", { name: "Subgroup name", exact: true }).fill("High School");
  146 |   await page.getByRole("button", { name: "Save subgroup", exact: true }).click();
  147 |   await expect(page.getByText("Group saved.", { exact: true })).toBeVisible();
  148 |   await page.getByRole("textbox", { name: "Search groups" }).fill("high");
  149 |   await expect(page.getByRole("button", { name: "Add subgroup under Youth", exact: true })).toBeVisible();
  150 |   await expect(page.getByText("Adults", { exact: true })).toHaveCount(0);
  151 |   await page.getByRole("textbox", { name: "Search groups" }).fill("missing");
  152 |   await expect(page.getByText("No groups found.", { exact: true })).toBeVisible();
  153 |   await page.getByRole("textbox", { name: "Search groups" }).fill("");
  154 |   await page.screenshot({ path: testInfo.outputPath("groups.png"), fullPage: true });
  155 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  156 |   await page.getByRole("button", { name: /High School/ }).click();
  157 |   await page.getByRole("textbox", { name: "Subgroup name", exact: true }).fill("Students High");
  158 |   await page.getByRole("button", { name: "Save subgroup", exact: true }).click();
  159 |   await expect(page.getByRole("alert")).toContainText(
  160 |     "This record changed elsewhere",
  161 |   );
  162 |   await page.getByRole("button", { name: "Reload latest version", exact: true }).click();
  163 |   await expect(page.getByRole("textbox", { name: "Subgroup name", exact: true })).toHaveValue("Students");
  164 |   await page.getByRole("textbox", { name: "Subgroup name", exact: true }).fill("High School");
  165 |   await page.getByRole("button", { name: "Save subgroup", exact: true }).click();
  166 |   await expect(page.getByText("Group saved.", { exact: true })).toBeVisible();
  167 |   await page.getByRole("tab", { name: "Members", exact: true }).click();
  168 |   await page.getByRole("button", { name: /Jordan Example/ }).click();
  169 |   await page.getByRole("button", { name: "Edit member", exact: true }).click();
  170 |   await page.getByLabel("Youth / High School").check();
  171 |   await page.getByRole("button", { name: "Save member", exact: true }).click();
  172 |   await expect(page.getByText("Member saved.", { exact: true })).toBeVisible();
  173 |   await expect(page.getByRole("button", { name: /Jordan Example/ })).toContainText("Youth / High School");
  174 |   await page.getByRole("tab", { name: "Home", exact: true }).click();
  175 |   await page.getByRole("button", { name: /Manage groups/ }).click();
  176 |   await page.getByRole("button", { name: /High School/ }).click();
  177 |   await page.getByRole("button", { name: "Archive subgroup", exact: true }).click();
  178 |   await page.getByRole("button", { name: "Confirm archive", exact: true }).click();
  179 |   await expect(page.getByText("Group archived.", { exact: true })).toBeVisible();
  180 |   await page.getByRole("tab", { name: "Members", exact: true }).click();
  181 |   await page.getByRole("button", { name: "Add member", exact: true }).click();
  182 |   await expect(page.getByLabel("Youth / High School", { exact: true })).toHaveCount(0);
  183 |   await page.getByRole("button", { name: "Close", exact: true }).click();
  184 |   await page.getByRole("button", { name: /Jordan Example/ }).click();
  185 |   await page.getByRole("button", { name: "Edit member", exact: true }).click();
  186 |   await expect(page.getByRole("alert")).toContainText("Archived group assignments");
  187 |   await expect(page.getByRole("button", { name: "Save member", exact: true })).toBeDisabled();
  188 |   await page.getByLabel("Youth / High School (archived)", { exact: true }).click();
  189 |   await expect(page.getByLabel("Youth / High School (archived)", { exact: true })).toHaveCount(0);
  190 |   await page.getByLabel("Youth", { exact: true }).check();
  191 |   await page.getByRole("button", { name: "Save member", exact: true }).click();
  192 |   await expect(page.getByText("Member saved.", { exact: true })).toBeVisible();
  193 |   await page.getByRole("button", { name: "Switch church", exact: true }).click();
  194 |   await page.getByRole("button", { name: /Beta Community/ }).click();
  195 |   await page.getByRole("button", { name: /Manage groups/ }).click();
  196 |   await expect(page.getByText("No groups defined.", { exact: true })).toBeVisible();
  197 |   await expect(page.getByText("Youth", { exact: true })).toHaveCount(0);
  198 |   expect(errors).toEqual([]);
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
> 235 |   await page.goto(`/church/${alpha.id}/groups`);
      |              ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
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
```