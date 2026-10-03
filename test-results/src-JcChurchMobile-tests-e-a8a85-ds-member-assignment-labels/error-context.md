# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: src/JcChurchMobile/tests/e2e/workflows.spec.ts >> settings manage groups creates subgroups and feeds member assignment labels
- Location: src/JcChurchMobile/tests/e2e/workflows.spec.ts:62:5

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/church/church_alpha", waiting until "load"

```

# Test source

```ts
  35  | };
  36  | const sampleSession = {
  37  |   ...metadata("occ_sample", alpha.id),
  38  |   eventId: sampleEvent.id,
  39  |   startsAt: new Date(Date.now() + 86400000).toISOString(),
  40  |   endsAt: new Date(Date.now() + 90000000).toISOString(),
  41  |   cancelled: false,
  42  |   archived: false,
  43  |   overridden: false,
  44  | };
  45  | const pageBody = (
  46  |   items: unknown[],
  47  |   continuationToken: string | null = null,
  48  | ) => ({ items, continuationToken });
  49  | 
  50  | // Staff workflows require an authenticated session. Seed the current session
  51  | // key with an admin session (matches AuthContext's StoredSession shape) so
  52  | // these tests reach protected routes without going through the login UI.
  53  | test.beforeEach(async ({ page }) => {
  54  |   await page.addInitScript(() => {
  55  |     window.localStorage.setItem(
  56  |       "jchurch:auth-session:v1",
  57  |       JSON.stringify({ provider: "admin" }),
  58  |     );
  59  |   });
  60  | });
  61  | 
  62  | test("settings manage groups creates subgroups and feeds member assignment labels", async ({ page }, testInfo) => {
  63  |   const errors: string[] = [];
  64  |   page.on("pageerror", error => errors.push(error.message));
  65  |   let groups = [
  66  |     {
  67  |       ...metadata("group_adults", alpha.id),
  68  |       name: "Adults",
  69  |       parentGroupId: null,
  70  |     },
  71  |   ];
  72  |   let savedMember = { ...jordan, groupIds: [] as string[] };
  73  |   let stale = true;
  74  |   const groupWrites: unknown[] = [];
  75  |   const memberWrites: unknown[] = [];
  76  |   await page.route("**/api/v1/**", async (route) => {
  77  |     const url = new URL(route.request().url());
  78  |     const path = url.pathname.replace("/api/v1", "");
  79  |     const method = route.request().method();
  80  |     let body: unknown = pageBody([]);
  81  |     if (path === "/churches") body = pageBody([alpha, beta]);
  82  |     else if (path === `/churches/${alpha.id}`) body = alpha;
  83  |     else if (path === `/churches/${beta.id}`) body = beta;
  84  |     else if (path === `/churches/${alpha.id}/groups`) {
  85  |       if (method === "POST") {
  86  |         const input = route.request().postDataJSON();
  87  |         groupWrites.push(input);
  88  |         const next = {
  89  |           ...metadata(`group_${groups.length}`, alpha.id),
  90  |           ...input,
  91  |           _etag: '"created"',
  92  |           active: true,
  93  |         };
  94  |         groups = [...groups, next];
  95  |         body = next;
  96  |       } else body = url.searchParams.has("continuationToken")
  97  |         ? pageBody(groups.filter(group => !group.parentGroupId))
  98  |         : pageBody(groups.filter(group => group.parentGroupId), "parents");
  99  |     } else if (path.startsWith(`/churches/${alpha.id}/groups/`)) {
  100 |       const id = path.split("/").at(-1)!;
  101 |       const existing = groups.find((group) => group.id === id)!;
  102 |       if (method === "PUT") {
  103 |         if (stale) {
  104 |           stale = false;
  105 |           groups = groups.map((group) =>
  106 |             group.id === id ? { ...group, name: "Students", _etag: '"latest"' } : group,
  107 |           );
  108 |           await route.fulfill({ status: 412, json: { detail: "ETag is stale." } });
  109 |           return;
  110 |         }
  111 |         const input = route.request().postDataJSON();
  112 |         groupWrites.push(input);
  113 |         groups = groups.map((group) =>
  114 |           group.id === id ? { ...group, ...input, _etag: '"saved"' } : group,
  115 |         );
  116 |       } else if (method === "DELETE") {
  117 |         groups = groups.map((group) =>
  118 |           group.id === id ? { ...group, active: false, _etag: '"archived"' } : group,
  119 |         );
  120 |         await route.fulfill({ status: 204 });
  121 |         return;
  122 |       }
  123 |       body = groups.find((group) => group.id === id) ?? existing;
  124 |     } else if (path === `/churches/${alpha.id}/members`) body = pageBody([savedMember]);
  125 |     else if (path === `/churches/${alpha.id}/members/${jordan.id}`) {
  126 |       if (method === "PUT") {
  127 |         const input = route.request().postDataJSON();
  128 |         memberWrites.push(input);
  129 |         savedMember = { ...savedMember, ...input, _etag: '"member-saved"' };
  130 |       }
  131 |       body = savedMember;
  132 |     } else if (path === `/churches/${alpha.id}/custom-fields`) body = pageBody([]);
  133 |     await route.fulfill({ json: body });
  134 |   });
> 135 |   await page.goto(`/church/${alpha.id}`);
      |              ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
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
  235 |   await page.goto(`/church/${alpha.id}/groups`);
```