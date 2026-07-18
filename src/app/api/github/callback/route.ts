import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { AppError, IntegrationUnavailableError } from "@/server/api/errors";
import { completeGitHubAuthorization } from "@/server/github/connection-service";
import { logError, logInfo } from "@/server/observability/logger";

export const dynamic = "force-dynamic";

function secureRedirect(request: NextRequest, destination: string, requestId: string) {
  const response = NextResponse.redirect(new URL(destination, request.url));
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  // This contains no credential material and lets an operator correlate the
  // browser response with the safe structured server log entry.
  response.headers.set("X-Forge-Request-Id", requestId);
  response.cookies.set("forge_github_oauth", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/github",
    maxAge: 0,
  });
  return response;
}

function safeCallbackErrorContext(error: unknown) {
  return {
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorCode: error instanceof AppError ? error.code : undefined,
    validationIssues: error instanceof z.ZodError
      ? error.issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`)
      : undefined,
  };
}

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const providerError = request.nextUrl.searchParams.get("error");
  if (providerError) {
    logInfo("GitHub OAuth authorization was cancelled by the provider", {
      requestId,
      integration: "github",
      githubStage: "provider_cancelled",
    });
    return secureRedirect(request, "/?github=authorization_cancelled", requestId);
  }

  let user;
  try {
    user = await getCurrentUser();
  } catch (error) {
    logError("GitHub OAuth callback could not read the Forge session", {
      requestId,
      integration: "github",
      githubStage: "callback_session_check",
      ...safeCallbackErrorContext(error),
    });
    return secureRedirect(request, "/?github=authorization_failed", requestId);
  }

  if (!user) {
    logInfo("GitHub OAuth callback has no authenticated Forge session", {
      requestId,
      integration: "github",
      githubStage: "callback_session_check",
      session: "missing",
    });
    return secureRedirect(request, "/sign-in?next=%2F%3Fgithub%3Dauthorization_expired", requestId);
  }

  logInfo("GitHub OAuth callback accepted", {
    requestId,
    integration: "github",
    githubStage: "callback_session_check",
    session: "present",
  });

  try {
    await completeGitHubAuthorization({
      userId: user.id,
      code: request.nextUrl.searchParams.get("code"),
      state: request.nextUrl.searchParams.get("state"),
      stateCookie: request.cookies.get("forge_github_oauth")?.value,
      requestId,
    });
    return secureRedirect(request, "/?stage=repositories&github=connected", requestId);
  } catch (error) {
    logError("GitHub OAuth callback failed", {
      requestId,
      integration: "github",
      githubStage: "callback_failed",
      ...safeCallbackErrorContext(error),
    });

    const status = error instanceof IntegrationUnavailableError
      ? "configuration_required"
      : "authorization_failed";

    return secureRedirect(request, `/?github=${status}`, requestId);
  }
}
