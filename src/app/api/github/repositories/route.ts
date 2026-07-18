import { requireCurrentUser } from "@/server/auth/session";
import { failure, success } from "@/server/api/response";
import { listAvailableGitHubRepositories } from "@/server/github/sync-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireCurrentUser();
    const repositories = await listAvailableGitHubRepositories(user);
    return success({ repositories });
  } catch (error) {
    return failure(error);
  }
}
