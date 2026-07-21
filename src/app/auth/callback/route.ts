import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { logError } from "@/server/observability/logger";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const nextPath = safeNextPath(request.nextUrl.searchParams.get("next"));

  if (code) {
    const successResponse = NextResponse.redirect(new URL(nextPath, request.url));
    const supabase = await createServerSupabaseClient(successResponse);
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return successResponse;
    }

    logError("Supabase magic-link callback exchange failed", {
      authStage: "magic_link",
      errorName: error.name,
      authErrorMessage: error.message,
    });
  }

  const signInUrl = new URL("/sign-in", request.url);
  signInUrl.searchParams.set("next", nextPath);
  signInUrl.searchParams.set("error", "callback");
  return NextResponse.redirect(signInUrl);
}
