import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const nextPath = safeNextPath(request.nextUrl.searchParams.get("next"));

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(nextPath, request.url));
    }
  }

  const signInUrl = new URL("/sign-in", request.url);
  signInUrl.searchParams.set("next", nextPath);
  signInUrl.searchParams.set("error", "callback");
  return NextResponse.redirect(signInUrl);
}
