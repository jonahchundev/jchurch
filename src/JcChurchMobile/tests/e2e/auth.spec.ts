import { expect, test } from "@playwright/test";

const church = {
  id: "church_alpha",
  churchId: "church_alpha",
  _etag: '"first"',
  active: true,
  kind: "Church",
  searchText: "Alpha Community",
  name: "Alpha Community",
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/churches") {
      await route.fulfill({ json: { items: [church], continuationToken: null } });
      return;
    }
    if (path === `/churches/${church.id}`) {
      await route.fulfill({ json: church });
      return;
    }
    await route.fulfill({ status: 404, json: { detail: "Not found." } });
  });
});

test("login persists until Settings logout and protects staff routes", async ({ page }) => {
  await page.goto(`/church/${church.id}`);
  await expect(page.getByRole("heading", { name: "Sign in" }).last()).toBeVisible();

  await page.getByRole("textbox", { name: "Username (required)" }).fill("admin");
  await page.getByLabel("Password (required)").fill("wrong");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Invalid username or password.", { exact: true })).toBeVisible();

  await page.getByLabel("Password (required)").fill("abc123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Choose your church" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Choose your church" })).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" }).last()).toBeVisible();

  await page.goto(`/church/${church.id}`);
  await expect(page.getByRole("heading", { name: "Sign in" }).last()).toBeVisible();
});

test("public registration remains available while logged out", async ({ page }) => {
  await page.goto(`/register/${church.id}`);
  await expect(page.getByRole("heading", { name: "Registration" }).last()).toBeVisible();
  await expect(page.getByText("Alpha Community", { exact: true })).toBeVisible();
});

test("Google sign-in button renders on the login screen", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" }).last()).toBeVisible();
  // Google button only appears when EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is configured;
  // the dev .env used for e2e sets it, so the button should be visible.
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  // Admin fallback remains available.
  await expect(page.getByRole("textbox", { name: "Username (required)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});