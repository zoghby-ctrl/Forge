import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnvironment } from "@/lib/env";

/**
 * Browser access is deliberately limited to Supabase Auth. Forge data is read
 * and mutated through authenticated server routes, where authorization and
 * validation live in one place.
 */
export function createBrowserSupabaseClient() {
  const environment = getPublicEnvironment();

  return createBrowserClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
