import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DataAccessError } from "@/server/api/errors";

export const forgeProjectSlug = "forge";
export const forgeProjectName = "Forge";

export type ForgeProjectRow = {
  id: string;
  slug: string;
  name: string;
  status: "draft" | "ready" | "archived";
};

function throwForProjectError(operation: string, error: { code?: string; message?: string } | null) {
  if (error) {
    throw new DataAccessError(operation);
  }
}

export async function ensureForgeProjectForUser(supabase: SupabaseClient, userId: string) {
  const { error: upsertError } = await supabase.from("projects").upsert(
    {
      owner_id: userId,
      slug: forgeProjectSlug,
      name: forgeProjectName,
      status: "ready",
      created_by: userId,
      updated_by: userId,
    },
    { onConflict: "owner_id,slug", ignoreDuplicates: true },
  );
  throwForProjectError("initialize your Forge workspace", upsertError);

  const { data, error } = await supabase
    .from("projects")
    .select("id, slug, name, status")
    .eq("owner_id", userId)
    .eq("slug", forgeProjectSlug)
    .maybeSingle();
  throwForProjectError("load your Forge workspace", error);

  if (!data) {
    throw new DataAccessError("initialize your Forge workspace");
  }

  return data as ForgeProjectRow;
}
