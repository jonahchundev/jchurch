# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: src/JcChurchMobile/tests/e2e/workflows.spec.ts >> attendance reports drill from the hub to a read-only session roster
- Location: src/JcChurchMobile/tests/e2e/workflows.spec.ts:1043:5

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/church/church_alpha/reports", waiting until "load"

```

# Test source

```ts
  993  | });
  994  | 
  995  | // User management: a global admin (temp "admin" login) can invite a user,
  996  | // see the Invited badge, and the claim endpoint flips the record to Active.
  997  | test("global admin invites a user and the invite can be claimed", async ({ page }) => {
  998  |   const invitedUser = {
  999  |     ...metadata("jane@example.com", "global"),
  1000 |     email: "jane@example.com",
  1001 |     role: "church-admin",
  1002 |     churchIds: [alpha.id],
  1003 |     displayName: "Jane Admin",
  1004 |     invitedBy: "admin",
  1005 |     status: "invited",
  1006 |     claimedOn: null,
  1007 |   };
  1008 |   let users: unknown[] = [invitedUser];
  1009 |   await page.route("**/api/v1/**", async (route) => {
  1010 |     const url = new URL(route.request().url());
  1011 |     const path = url.pathname.replace("/api/v1", "");
  1012 |     const method = route.request().method();
  1013 |     let body: unknown = pageBody([]);
  1014 |     if (path === "/churches") body = pageBody([alpha, beta]);
  1015 |     else if (path === "/users") {
  1016 |       if (method === "POST") {
  1017 |         const input = route.request().postDataJSON();
  1018 |         const created = { ...metadata(input.email, "global"), ...input, status: "invited", claimedOn: null, _etag: '"u-created"' };
  1019 |         users = [...users, created];
  1020 |         await route.fulfill({ status: 201, json: created });
  1021 |         return;
  1022 |       }
  1023 |       body = pageBody(users);
  1024 |     } else if (path === `/users/${encodeURIComponent("jane@example.com")}/claim`) {
  1025 |       users = users.map((u) => (u as { email: string }).email === "jane@example.com" ? { ...(u as object), status: "active", claimedOn: new Date().toISOString() } : u);
  1026 |       body = users.find((u) => (u as { email: string }).email === "jane@example.com");
  1027 |     }
  1028 |     await route.fulfill({ json: body });
  1029 |   });
  1030 |   await page.goto("/settings");
  1031 |   await page.getByRole("button", { name: /Manage users/ }).click();
  1032 |   await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
  1033 |   await expect(page.getByRole("button", { name: /jane@example\.com/ })).toContainText("Invited");
  1034 |   await page.getByRole("button", { name: "Invite user", exact: true }).click();
  1035 |   await page.getByRole("textbox", { name: "Email", exact: true }).fill("new.user@example.com");
  1036 |   await page.getByRole("textbox", { name: "Display name", exact: true }).fill("New User");
  1037 |   await page.getByLabel("Alpha Community", { exact: true }).check();
  1038 |   await page.getByRole("button", { name: "Send invite", exact: true }).click();
  1039 |   await expect(page.getByText("User saved.", { exact: true })).toBeVisible();
  1040 |   await expect(page.getByRole("button", { name: /new\.user@example\.com/ })).toContainText("Invited");
  1041 | });
  1042 | 
  1043 | test("attendance reports drill from the hub to a read-only session roster", async ({ page }) => {
  1044 |   const pastSession = {
  1045 |     ...metadata("occ_past", alpha.id),
  1046 |     eventId: sampleEvent.id,
  1047 |     startsAt: new Date(Date.now() - 86400000).toISOString(),
  1048 |     endsAt: new Date(Date.now() - 82800000).toISOString(),
  1049 |     cancelled: false,
  1050 |     archived: false,
  1051 |     overridden: false,
  1052 |   };
  1053 |   const adults = { ...metadata("group_adults", alpha.id), name: "Adults", parentGroupId: null };
  1054 |   const receipts = [jordan, secondMember].map((member, index) => ({
  1055 |     ...metadata(`${pastSession.id}_${member.id}`, alpha.id),
  1056 |     eventId: sampleEvent.id,
  1057 |     occurrenceId: pastSession.id,
  1058 |     memberId: member.id,
  1059 |     checkedInAt: new Date(Date.now() - 86000000 + index * 60000).toISOString(),
  1060 |     groupIds: [adults.id],
  1061 |     inclusiveGroupIds: [adults.id],
  1062 |   }));
  1063 |   await page.route("**/api/v1/**", async (route) => {
  1064 |     const url = new URL(route.request().url());
  1065 |     const path = url.pathname.replace("/api/v1", "");
  1066 |     let body: unknown = pageBody([]);
  1067 |     if (path === "/churches") body = pageBody([alpha]);
  1068 |     else if (path === `/churches/${alpha.id}`) body = alpha;
  1069 |     else if (path === `/churches/${alpha.id}/events`) body = pageBody([sampleEvent]);
  1070 |     else if (path === `/churches/${alpha.id}/events/${sampleEvent.id}/occurrences`) body = pageBody([pastSession]);
  1071 |     else if (path === `/churches/${alpha.id}/events/${sampleEvent.id}/occurrence-check-in-counts`)
  1072 |       body = pageBody([{ occurrenceId: pastSession.id, checkedInCount: 2 }]);
  1073 |     else if (path === `/churches/${alpha.id}/attendance/summary`) {
  1074 |       const groupBy = url.searchParams.get("groupBy");
  1075 |       body = {
  1076 |         items: groupBy === "member"
  1077 |           ? [
  1078 |               { key: jordan.id, checkedInCount: 1, uniqueMemberCount: 1 },
  1079 |               { key: secondMember.id, checkedInCount: 1, uniqueMemberCount: 1 },
  1080 |             ]
  1081 |           : groupBy === "group"
  1082 |             ? [{ key: adults.id, checkedInCount: 2, uniqueMemberCount: 2 }]
  1083 |             : [{ key: pastSession.id, checkedInCount: 2, uniqueMemberCount: 2 }],
  1084 |       };
  1085 |     }
  1086 |     else if (path === `/churches/${alpha.id}/attendance`) body = pageBody(receipts);
  1087 |     else if (path === `/churches/${alpha.id}/members`) body = pageBody([jordan, secondMember]);
  1088 |     else if (path === `/churches/${alpha.id}/members/${jordan.id}`) body = jordan;
  1089 |     else if (path === `/churches/${alpha.id}/members/${secondMember.id}`) body = secondMember;
  1090 |     else if (path === `/churches/${alpha.id}/groups`) body = pageBody([adults]);
  1091 |     await route.fulfill({ json: body });
  1092 |   });
> 1093 |   await page.goto(`/church/${alpha.id}/reports`);
       |              ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  1094 |   await page.getByRole("button", { name: /By Event/ }).click();
  1095 |   await page.getByLabel("Event", { exact: true }).selectOption(sampleEvent.id);
  1096 |   await expect(page.getByText("Unique attendees", { exact: true })).toBeVisible();
  1097 |   const sessionRow = page.getByRole("button", { name: /2 checked in/ });
  1098 |   await expect(sessionRow).toBeVisible();
  1099 |   await sessionRow.click();
  1100 |   // The session report is pre-filled by the drill-down and its roster is read-only.
  1101 |   await expect(page.getByRole("heading", { name: "Roster", exact: true })).toBeVisible();
  1102 |   await expect(page.getByText("Jordan Example", { exact: true })).toBeVisible();
  1103 |   await expect(page.getByText("Casey Example", { exact: true })).toBeVisible();
  1104 |   await expect(page.getByText("Adults", { exact: true })).toBeVisible();
  1105 |   await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0);
  1106 | });
  1107 | 
```