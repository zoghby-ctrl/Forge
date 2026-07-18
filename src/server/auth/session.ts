import "server-only";

import type { User } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AuthenticationError, DataAccessError } from "@/server/api/errors";

export type ForgeUser = Pick<User, "id" | "email" | "user_metadata">;

export async function getCurrentUser(): Promise<ForgeUser | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    // An expired or absent session is an ordinary anonymous request. Other data
    // operations will still explicitly require a validated current user.
    return null;
  }

  return data.user;
}

export async function requireCurrentUser(): Promise<ForgeUser> {
  const user = await getCurrentUser();

  if (!user) {
    throw new AuthenticationError();
  }

  return user;
}

export async function ensureCurrentUserProfile(user: ForgeUser) {
  if (!user.email) {
    throw new DataAccessError("initialize your profile");
  }

  const supabase = await createServerSupabaseClient();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new DataAccessError("load your profile");
  }

  if (profile) {
    return;
  }

  const displayName = typeof user.user_metadata.full_name === "string"
    ? user.user_metadata.full_name
    : typeof user.user_metadata.name === "string"
      ? user.user_metadata.name
      : null;

  // The auth trigger normally creates this row. A confirmed user can also
  // predate the trigger or arrive in concurrent requests, so make the
  // application fallback idempotent rather than treating a unique conflict as
  // a failed sign-in.
  const { error: insertError } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      email: user.email,
      display_name: displayName,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );

  if (insertError) {
    throw new DataAccessError("initialize your profile");
  }

  const { data: confirmedProfile, error: confirmedProfileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (confirmedProfileError || !confirmedProfile) {
    throw new DataAccessError("load your profile");
  }
}
