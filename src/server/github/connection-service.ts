import "server-only";

import { z } from "zod";
import { GitHubApiError, GitHubRestClient } from "@/integrations/github/client";
import {
  buildGitHubAuthorizationUrl,
  createGitHubOAuthCookie,
  createGitHubOAuthState,
  exchangeGitHubOAuthCode,
  isMatchingGitHubOAuthState,
  parseGitHubOAuthCookie,
} from "@/integrations/github/oauth";
import {
  consumeGitHubOAuthState,
  deleteGitHubConnection,
  getGitHubConnectionForUser,
  markGitHubConnectionRevoked,
  persistGitHubOAuthState,
  readGitHubAccessToken,
  readGitHubOAuthCodeVerifier,
  saveGitHubConnection,
} from "@/server/github/credentials";
import {
  GitHubConfigurationError,
  getGitHubServerEnvironment,
  isGitHubIntegrationConfigured,
} from "@/server/github/env";
import {
  IntegrationUnavailableError,
  ReauthenticationRequiredError,
  UpstreamServiceError,
  ValidationError,
} from "@/server/api/errors";
import { logError, logInfo } from "@/server/observability/logger";

const githubIdentitySchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
});

export type GitHubConnectionStatus = {
  status: "connected" | "disconnected" | "expired" | "not_configured";
  login: string | null;
};

function logGitHubOAuthStage(requestId: string | undefined, githubStage: string) {
  logInfo("GitHub OAuth stage completed", {
    requestId,
    integration: "github",
    githubStage,
  });
}

function logGitHubApiError(error: GitHubApiError) {
  logError("GitHub API request failed", {
    integration: "github",
    errorName: error.name,
    errorCode: error.code,
    githubStatus: error.status,
    githubResponseBody: error.responseBody,
  });
}

function isExpired(expiresAt: string | null) {
  return Boolean(expiresAt && new Date(expiresAt).getTime() <= Date.now());
}

export async function startGitHubAuthorization(userId: string) {
  let environment;
  try {
    environment = getGitHubServerEnvironment();
  } catch (error) {
    if (error instanceof GitHubConfigurationError) {
      throw new IntegrationUnavailableError();
    }
    throw error;
  }

  const state = createGitHubOAuthState(userId);
  await persistGitHubOAuthState(state);

  return {
    authorizationUrl: buildGitHubAuthorizationUrl(environment, state),
    stateCookie: createGitHubOAuthCookie(state),
    expiresAt: state.expiresAt,
  };
}

export async function completeGitHubAuthorization(input: {
  userId: string;
  code: string | null;
  state: string | null;
  stateCookie: string | undefined;
  requestId?: string;
}) {
  if (!input.code || !input.state) {
    throw new ValidationError("GitHub authorization could not be verified.");
  }

  const cookie = parseGitHubOAuthCookie(input.stateCookie);
  const stateValid = Boolean(cookie && isMatchingGitHubOAuthState(cookie, input.state, input.userId));
  logInfo("GitHub OAuth state validation completed", {
    requestId: input.requestId,
    integration: "github",
    githubStage: "state_validation",
    stateValidation: stateValid ? "passed" : "failed",
  });
  if (!stateValid || !cookie) {
    throw new ValidationError("GitHub authorization could not be verified.");
  }
  logGitHubOAuthStage(input.requestId, "state_cookie_verified");

  const consumedState = await consumeGitHubOAuthState({
    id: cookie.stateId,
    userId: input.userId,
    state: input.state,
  });
  if (!consumedState) {
    throw new ValidationError("GitHub authorization has expired. Connect GitHub again.");
  }
  logGitHubOAuthStage(input.requestId, "state_record_consumed");

  let environment;
  try {
    environment = getGitHubServerEnvironment();
  } catch (error) {
    if (error instanceof GitHubConfigurationError) {
      throw new IntegrationUnavailableError();
    }
    throw error;
  }

  let token;
  try {
    token = await exchangeGitHubOAuthCode(
      environment,
      input.code,
      readGitHubOAuthCodeVerifier(consumedState),
    );
  } catch (error) {
    logError("GitHub OAuth token exchange failed", {
      requestId: input.requestId,
      integration: "github",
      githubStage: "token_exchange",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    throw error;
  }
  logInfo("GitHub OAuth token exchange succeeded", {
    requestId: input.requestId,
    integration: "github",
    githubStage: "token_exchange",
  });
  logGitHubOAuthStage(input.requestId, "token_exchanged");
  const client = new GitHubRestClient(token.accessToken, environment.GITHUB_API_BASE_URL);

  let identity;
  try {
    identity = await client.get("/user", githubIdentitySchema);
  } catch (error) {
    if (error instanceof GitHubApiError) {
      logGitHubApiError(error);
    }
    throw new UpstreamServiceError("GitHub could not validate this authorization. Connect GitHub again.");
  }
  logGitHubOAuthStage(input.requestId, "github_identity_validated");

  await saveGitHubConnection({
    userId: input.userId,
    githubUserId: String(identity.data.id),
    githubLogin: identity.data.login,
    accessToken: token.accessToken,
    tokenType: token.tokenType,
    scopes: token.scopes,
    tokenExpiresAt: token.expiresAt,
  });
  logGitHubOAuthStage(input.requestId, "connection_persisted");

  return { login: identity.data.login };
}

export async function getGitHubConnectionStatus(userId: string): Promise<GitHubConnectionStatus> {
  if (!isGitHubIntegrationConfigured()) {
    return { status: "not_configured", login: null };
  }

  const connection = await getGitHubConnectionForUser(userId);
  if (!connection) {
    return { status: "disconnected", login: null };
  }
  if (connection.revoked_at || isExpired(connection.token_expires_at)) {
    if (!connection.revoked_at) {
      await markGitHubConnectionRevoked(userId);
    }
    return { status: "expired", login: connection.github_login };
  }

  return { status: "connected", login: connection.github_login };
}

export async function withGitHubClient<T>(
  userId: string,
  operation: (client: GitHubRestClient) => Promise<T>,
) {
  if (!isGitHubIntegrationConfigured()) {
    throw new IntegrationUnavailableError();
  }

  const connection = await getGitHubConnectionForUser(userId);
  if (!connection || connection.revoked_at || isExpired(connection.token_expires_at)) {
    if (connection && !connection.revoked_at) {
      await markGitHubConnectionRevoked(userId);
    }
    throw new ReauthenticationRequiredError();
  }

  const environment = getGitHubServerEnvironment();
  const client = new GitHubRestClient(
    readGitHubAccessToken(connection),
    environment.GITHUB_API_BASE_URL,
  );

  try {
    return await operation(client);
  } catch (error) {
    if (error instanceof GitHubApiError) {
      logGitHubApiError(error);
    }
    if (error instanceof GitHubApiError && error.status === 401) {
      await markGitHubConnectionRevoked(userId);
      throw new ReauthenticationRequiredError();
    }
    if (error instanceof GitHubApiError && error.code === "rate_limited") {
      throw new UpstreamServiceError("GitHub rate limited this request. Please try again shortly.");
    }
    if (error instanceof GitHubApiError) {
      throw new UpstreamServiceError();
    }
    throw error;
  }
}

async function revokeGitHubGrant(accessToken: string) {
  const environment = getGitHubServerEnvironment();
  let response: Response;
  try {
    response = await fetch(
      new URL(`/applications/${encodeURIComponent(environment.GITHUB_CLIENT_ID)}/grant`, environment.GITHUB_API_BASE_URL),
      {
        method: "DELETE",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Basic ${Buffer.from(`${environment.GITHUB_CLIENT_ID}:${environment.GITHUB_CLIENT_SECRET}`).toString("base64")}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Forge-GitHub-Integration",
        },
        body: JSON.stringify({ access_token: accessToken }),
        cache: "no-store",
      },
    );
  } catch {
    throw new UpstreamServiceError("GitHub could not revoke access. Please try again.");
  }

  if (!response.ok && response.status !== 404) {
    throw new UpstreamServiceError("GitHub could not revoke access. Please try again.");
  }
}

export async function disconnectGitHub(userId: string) {
  if (!isGitHubIntegrationConfigured()) {
    return { status: "disconnected" as const };
  }

  const connection = await getGitHubConnectionForUser(userId);
  if (!connection) {
    return { status: "disconnected" as const };
  }

  if (!connection.revoked_at) {
    await revokeGitHubGrant(readGitHubAccessToken(connection));
  }

  await deleteGitHubConnection(userId);
  return { status: "disconnected" as const };
}
