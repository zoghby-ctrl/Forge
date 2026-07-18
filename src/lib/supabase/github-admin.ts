import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getPublicEnvironment } from "@/lib/env";
import { getGitHubServerEnvironment } from "@/server/github/env";

/**
 * This client is deliberately limited to GitHub credential and ingestion work.
 * It is never imported by browser code and every caller must authenticate the
 * Forge user before using it because the service role bypasses RLS.
 */
export function createGitHubAdminSupabaseClient() {
  const environment = getGitHubServerEnvironment();
  const publicEnvironment = getPublicEnvironment();

  return createClient(
    publicEnvironment.NEXT_PUBLIC_SUPABASE_URL,
    environment.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );
}
