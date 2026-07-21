import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { IntegrationUnavailableError } from "@/server/api/errors";
import { startGitHubAuthorization } from "@/server/github/connection-service";
import { logError, logInfo } from "@/server/observability/logger";

export const dynamic = "force-dynamic";

function secureRedirect(url: URL) {
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: NextRequest) {
  logInfo("GitHub OAuth connect route reached", {
    integration: "github",
    githubStage: "connect_reached",
  });
  const user = await getCurrentUser();
  if (!user) {
    logInfo("GitHub OAuth connect route has no authenticated Forge user", {
      integration: "github",
      githubStage: "connect_session_check",
      session: "missing",
    });
    return secureRedirect(new URL("/sign-in?next=%2Fapi%2Fgithub%2Fconnect", request.url));
  }

  logInfo("GitHub OAuth connect route has an authenticated Forge user", {
    integration: "github",
    githubStage: "connect_session_check",
    session: "present",
  });

  try {
    const authorization = await startGitHubAuthorization(user.id);
    const response = secureRedirect(new URL(authorization.authorizationUrl));
    const redirectUrl = new URL(authorization.authorizationUrl);
    logInfo("GitHub OAuth redirect URL created", {
      integration: "github",
      githubStage: "connect_redirect_created",
      redirectOrigin: redirectUrl.origin,
      redirectPath: redirectUrl.pathname,
    });
    response.cookies.set("forge_github_oauth", authorization.stateCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/github",
      expires: authorization.expiresAt,
    });
    return response;
  } catch (error) {
    logError("GitHub OAuth connect route failed", {
      integration: "github",
      githubStage: "connect_failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    const status = error instanceof IntegrationUnavailableError
      ? "configuration_required"
      : "connection_failed";
    return secureRedirect(new URL(`/?github=${status}`, request.url));
  }
}
