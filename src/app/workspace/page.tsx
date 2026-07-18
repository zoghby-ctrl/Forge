import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

/**
 * A canonical protected route for direct links and future nested workspace
 * routes. The primary visual surface remains / to preserve Forge's flow.
 */
export default async function WorkspacePage() {
  await requireCurrentUser();
  redirect("/?stage=repositories");
}
