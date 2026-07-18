import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildGitHubAuthorizationUrl,
  createGitHubOAuthCookie,
  createGitHubOAuthState,
  exchangeGitHubOAuthCode,
  isMatchingGitHubOAuthState,
  parseGitHubOAuthCookie,
} from "../../src/integrations/github/oauth";
import type { GitHubServerEnvironment } from "../../src/server/github/env";

const userId = "11111111-1111-4111-8111-111111111111";
const originalEnvironment = { ...process.env };

const environment: GitHubServerEnvironment = {
  GITHUB_CLIENT_ID: "forge-client-id",
  GITHUB_CLIENT_SECRET: "server-only-secret",
  GITHUB_REDIRECT_URI: "https://forge.example/api/github/callback",
  GITHUB_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  SUPABASE_SERVICE_ROLE_KEY: "supabase-service-role",
  GITHUB_API_BASE_URL: "https://api.github.com",
  GITHUB_OAUTH_BASE_URL: "https://github.com",
};

beforeAll(() => {
  Object.assign(process.env, environment);
});

afterAll(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
});

describe("GitHub OAuth state", () => {
  it("creates a signed, user-bound state cookie without a PKCE verifier", () => {
    const state = createGitHubOAuthState(userId, "22222222-2222-4222-8222-222222222222");
    const cookie = createGitHubOAuthCookie(state);
    const parsed = parseGitHubOAuthCookie(cookie);

    expect(parsed).toMatchObject({ stateId: state.id, userId, state: state.state });
    expect(cookie).not.toContain(state.codeVerifier);
    expect(isMatchingGitHubOAuthState(parsed, state.state, userId)).toBe(true);
  });

  it("rejects tampered, mismatched, expired, and wrong-user state values", () => {
    const state = createGitHubOAuthState(userId, "33333333-3333-4333-8333-333333333333");
    const cookie = createGitHubOAuthCookie(state);
    const tampered = `${cookie.slice(0, -1)}x`;
    const parsed = parseGitHubOAuthCookie(cookie);

    expect(parseGitHubOAuthCookie(tampered)).toBeNull();
    expect(isMatchingGitHubOAuthState(parsed, "wrong-state", userId)).toBe(false);
    expect(isMatchingGitHubOAuthState(parsed, state.state, "44444444-4444-4444-8444-444444444444")).toBe(false);

    const expired = { ...state, expiresAt: new Date("2020-01-01T00:00:00.000Z") };
    expect(parseGitHubOAuthCookie(createGitHubOAuthCookie(expired), new Date("2026-01-01T00:00:00.000Z"))).toBeNull();
  });

  it("requests PKCE and the minimum OAuth scope needed for private repository metadata", () => {
    const state = createGitHubOAuthState(userId, "55555555-5555-4555-8555-555555555555");
    const url = new URL(buildGitHubAuthorizationUrl(environment, state));

    expect(url.origin).toBe("https://github.com");
    expect(url.searchParams.get("client_id")).toBe(environment.GITHUB_CLIENT_ID);
    expect(url.searchParams.get("scope")).toBe("repo");
    expect(url.searchParams.get("state")).toBe(state.state);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toHaveLength(43);
    expect(url.toString()).not.toContain(environment.GITHUB_CLIENT_SECRET);
  });

  it("records an expiry when GitHub supplies one so the server can require reauthorization", async () => {
    const before = Date.now();
    const token = await exchangeGitHubOAuthCode(
      environment,
      "authorization-code",
      "pkce-verifier",
      async () => new Response(JSON.stringify({
        access_token: "server-only-token",
        token_type: "bearer",
        scope: "repo",
        expires_in: 3600,
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    expect(token.expiresAt).not.toBeNull();
    expect(new Date(token.expiresAt ?? "").getTime()).toBeGreaterThanOrEqual(before + 3_599_000);
  });
});
