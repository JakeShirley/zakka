import { expect, test } from "./fixtures";

test("signed-out visitors are sent to the sign-in page", async ({ page }) => {
  await page.goto("/books");

  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByRole("heading", { name: "Zakka" })).toBeVisible();
});

test("creating an account signs in, survives a reload, and signing out ends the session", async ({
  page,
}) => {
  await page.goto("/auth");
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.getByLabel("Name").fill("New Person");
  await page.getByLabel("Email").fill(`new-${Date.now()}@zakka.test`);
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Create account" }).click();

  // Signing in always lands on Books.
  await expect(page).toHaveURL(/\/books$/);
  await page.reload();
  await expect(page.getByRole("button", { name: "New book" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/auth$/);
  await page.goto("/library");
  await expect(page).toHaveURL(/\/auth$/);
});

test("a wrong password shows an error and the right one signs in", async ({ page, request }) => {
  const email = `login-${Date.now()}@zakka.test`;
  const password = "correct horse battery staple";
  // The standalone request context has its own cookies, so this page stays signed out.
  const registration = await request.post("/api/v1/auth/register", {
    data: { displayName: "Login Tester", email, password },
  });
  expect(registration.ok()).toBe(true);

  await page.goto("/auth");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".alert")).toBeVisible();
  await expect(page).toHaveURL(/\/auth$/);

  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/books$/);
});
