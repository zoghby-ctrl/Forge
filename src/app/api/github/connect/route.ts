import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { IntegrationUnavailableError } from "@/server/api/errors";
import { startGitHubAuthorization } from "@/server/github/connection-service";

export const dynamic = "force-dynamic";

function secureRedirect(url: URL) {
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return secureRedirect(new URL("/sign-in?next=%2Fapi%2Fgithub%2Fconnect", request.url));
  }

  try {
    const authorization = await startGitHubAuthorization(user.id);
    const response = secureRedirect(new URL(authorization.authorizationUrl));
    response.cookies.set("forge_github_oauth", authorization.stateCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/github",
      expires: authorization.expiresAt,
    });
    return response;
  } catch (error) {
    const status = error instanceof IntegrationUnavailableError
      ? "configuration_required"
      : "connection_failed";
    return secureRedirect(new URL(`/?github=${status}`, request.url));
  }
}
