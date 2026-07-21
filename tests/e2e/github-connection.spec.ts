import { expect, test, type Page } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3003";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasMockedGitHubFlow = Boolean(
  process.env.FORGE_E2E_GITHUB_MOCK
  && supabaseUrl
  && publishableKey
  && serviceRoleKey
  && process.env.GITHUB_CLIENT_ID
  && process.env.GITHUB_CLIENT_SECRET
  && process.env.GITHUB_REDIRECT_URI
  && process.env.GITHUB_TOKEN_ENCRYPTION_KEY
  && process.env.GITHUB_API_BASE_URL
  && process.env.GITHUB_OAUTH_BASE_URL,
);

async function deleteTestUser(userId: string) {
  if (!supabaseUrl || !serviceRoleKey) return;
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Could not delete test user (${response.status}).`);
  }
}

async function authenticateWithTestSession(page: Page) {
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    throw new Error("Live Supabase credentials are required for this test.");
  }

  const email = `forge-github-e2e-${crypto.randomUUID()}@example.test`;
  const password = `ForgeE2E-${crypto.randomUUID()}`;
  const headers = {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
  };
  // Create a confirmed, disposable account and establish a normal Auth session
  // directly. Admin-generated email links are not initiated by the browser and
  // therefore do not have the browser's PKCE verifier cookie.
  const createUserResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!createUserResponse.ok) {
    throw new Error(`Could not create test user (${createUserResponse.status}).`);
  }
  const createdUser = await createUserResponse.json() as { id: string };

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: publishableKey, "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password,
      }),
    });
    if (!response.ok) {
      throw new Error(`Could not create test session (${response.status}).`);
    }

    const session = await response.json();
    const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
    const cookieValue = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
    await page.context().addCookies([{
      name: `sb-${projectRef}-auth-token`,
      value: cookieValue,
      url: baseURL,
      sameSite: "Lax",
    }]);

    await page.goto("/");
    await expect(page.getByRole("button", { name: "Connect GitHub" })).toBeVisible();
    return createdUser.id;
  } catch (error) {
    await deleteTestUser(createdUser.id);
    throw error;
  }
}

test("requires sign-in before starting GitHub OAuth", async ({ page }) => {
  await page.goto("/");
  await expect(async () => {
    await page.getByRole("button", { name: "Connect GitHub" }).click();
    await expect(page).toHaveURL(/\/sign-in\?next=/, { timeout: 1_500 });
  }).toPass({ timeout: 10_000 });
  await expect(page.getByLabel("Work email")).toBeVisible();
});

test.describe("mocked GitHub OAuth and ingestion flow", () => {
  test.skip(!hasMockedGitHubFlow, "Configure the local mock GitHub OAuth/API provider and Supabase test credentials to run this flow.");

  test("connects GitHub, shows repository metadata, and creates a source-backed Passport", async ({ page }) => {
    const userId = await authenticateWithTestSession(page);
    const browserRequests: string[] = [];
    page.on("request", (request) => browserRequests.push(request.url()));

    try {
      await page.getByRole("button", { name: "Connect GitHub" }).click();
      await expect(page.getByRole("heading", { name: /Choose the system you want to understand/i })).toBeVisible();

      const picker = page.getByLabel("Available repositories");
      await expect(picker.getByText("forge-api", { exact: true })).toBeVisible();
      await expect(picker.getByText(/acme \/ forge-api/i)).toBeVisible();
      await expect(picker.getByText(/private/i)).toBeVisible();
      await expect(picker.getByText(/main/)).toBeVisible();
      await expect(picker.getByText(/TypeScript/)).toBeVisible();

      await picker.getByRole("button", { name: /forge-api/i }).click();
      await expect(page.getByRole("heading", { name: /Repository source captured/i })).toBeVisible();
      await expect(page.getByText("Reading repository history")).toBeVisible();
      await page.getByRole("button", { name: /Review workspace readiness/i }).click();
      await page.getByRole("button", { name: /Review pull requests/i }).click();
      const openNavigation = page.getByRole("button", { name: "Open navigation" });
      if (await openNavigation.isVisible()) await openNavigation.click();
      await page.getByRole("button", { name: /Change Passport pending/i }).click();

      await expect(page.getByRole("heading", { name: "Analysis not run" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Insufficient Evidence" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Analysis required before a decision/i })).toBeDisabled();
      await expect(page.getByText("src/auth/callback.ts")).toBeVisible();
      await expect(page.getByText(/Validate callback state/)).toBeVisible();
      expect(browserRequests.join("\n")).not.toMatch(/gho_[A-Za-z0-9]+/);
    } finally {
      await deleteTestUser(userId);
    }
  });
});
