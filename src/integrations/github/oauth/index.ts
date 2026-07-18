import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  signGitHubOAuthCookie,
  timingSafeStringEqual,
} from "@/server/github/crypto";
import type { GitHubServerEnvironment } from "@/server/github/env";

export const githubOAuthStateLifetimeMs = 10 * 60 * 1_000;

export const githubOAuthTokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  scope: z.string().optional().default(""),
  expires_in: z.number().int().positive().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export type GitHubOAuthToken = {
  accessToken: string;
  tokenType: string;
  scopes: string[];
  expiresAt: string | null;
};

export type GitHubOAuthState = {
  id: string;
  userId: string;
  state: string;
  codeVerifier: string;
  expiresAt: Date;
};

type GitHubOAuthCookiePayload = {
  version: 1;
  stateId: string;
  userId: string;
  state: string;
  expiresAt: string;
};

export function createGitHubOAuthState(userId: string, id = crypto.randomUUID()): GitHubOAuthState {
  return {
    id,
    userId,
    state: randomBytes(32).toString("base64url"),
    codeVerifier: randomBytes(48).toString("base64url"),
    expiresAt: new Date(Date.now() + githubOAuthStateLifetimeMs),
  };
}

export function createCodeChallenge(codeVerifier: string) {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export function createGitHubOAuthCookie(state: GitHubOAuthState) {
  const payload: GitHubOAuthCookiePayload = {
    version: 1,
    stateId: state.id,
    userId: state.userId,
    state: state.state,
    expiresAt: state.expiresAt.toISOString(),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signGitHubOAuthCookie(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function parseGitHubOAuthCookie(value: string | undefined, now = new Date()) {
  if (!value) {
    return null;
  }

  const [encodedPayload, signature, ...rest] = value.split(".");
  if (!encodedPayload || !signature || rest.length > 0 || !timingSafeStringEqual(signature, signGitHubOAuthCookie(encodedPayload))) {
    return null;
  }

  try {
    const candidate = z.object({
      version: z.literal(1),
      stateId: z.string().uuid(),
      userId: z.string().uuid(),
      state: z.string().min(32),
      expiresAt: z.string().datetime(),
    }).parse(JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")));

    if (new Date(candidate.expiresAt) <= now) {
      return null;
    }

    return candidate;
  } catch {
    return null;
  }
}

export function isMatchingGitHubOAuthState(
  cookie: ReturnType<typeof parseGitHubOAuthCookie>,
  state: string | null,
  userId: string,
) {
  return Boolean(
    cookie
    && state
    && cookie.userId === userId
    && timingSafeStringEqual(cookie.state, state),
  );
}

export function buildGitHubAuthorizationUrl(
  environment: GitHubServerEnvironment,
  state: GitHubOAuthState,
) {
  const url = new URL("/login/oauth/authorize", environment.GITHUB_OAUTH_BASE_URL);
  url.searchParams.set("client_id", environment.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", environment.GITHUB_REDIRECT_URI);
  // OAuth Apps have only coarse scopes. `repo` is the narrowest scope that can
  // read private repository and pull-request metadata; Forge itself makes GET
  // requests only and never writes to GitHub.
  url.searchParams.set("scope", "repo");
  url.searchParams.set("state", state.state);
  url.searchParams.set("code_challenge", createCodeChallenge(state.codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("allow_signup", "false");
  return url.toString();
}

export async function exchangeGitHubOAuthCode(
  environment: GitHubServerEnvironment,
  code: string,
  codeVerifier: string,
  fetcher: typeof fetch = fetch,
): Promise<GitHubOAuthToken> {
  let response: Response;
  try {
    response = await fetcher(new URL("/login/oauth/access_token", environment.GITHUB_OAUTH_BASE_URL), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: environment.GITHUB_CLIENT_ID,
        client_secret: environment.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: environment.GITHUB_REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
      cache: "no-store",
    });
  } catch {
    throw new Error("GitHub authorization could not be completed.");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("GitHub authorization could not be completed.");
  }

  const parsed = githubOAuthTokenSchema.safeParse(payload);
  if (!response.ok || !parsed.success || parsed.data.error) {
    throw new Error("GitHub authorization could not be completed.");
  }

  return {
    accessToken: parsed.data.access_token,
    tokenType: parsed.data.token_type,
    scopes: parsed.data.scope.split(/[,\s]+/).filter(Boolean),
    expiresAt: parsed.data.expires_in
      ? new Date(Date.now() + parsed.data.expires_in * 1_000).toISOString()
      : null,
  };
}
