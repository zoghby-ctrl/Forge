"use server";

import { magicLinkSchema, type MagicLinkState } from "@/features/auth/magic-link-contract";
import { getPublicEnvironment } from "@/lib/env";
import { safeNextPath } from "@/lib/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function requestMagicLink(
  _previousState: MagicLinkState,
  formData: FormData,
): Promise<MagicLinkState> {
  const parsed = magicLinkSchema.safeParse({
    email: formData.get("email"),
    next: formData.get("next"),
  });

  if (!parsed.success) {
    return { status: "error", message: "Enter a valid email address." };
  }

  try {
    const environment = getPublicEnvironment();
    const nextPath = safeNextPath(parsed.data.next);
    const callbackUrl = new URL("/auth/callback", environment.NEXT_PUBLIC_APP_URL);
    callbackUrl.searchParams.set("next", nextPath);

    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data.email,
      options: {
        emailRedirectTo: callbackUrl.toString(),
        shouldCreateUser: true,
      },
    });

    if (error) {
      return { status: "error", message: "Forge could not send that sign-in link. Please try again." };
    }

    return {
      status: "sent",
      message: "Check your email for a secure sign-in link.",
    };
  } catch {
    return {
      status: "error",
      message: "Forge sign-in is not configured yet. Ask an administrator to complete the Supabase setup.",
    };
  }
}
