import { requireCurrentUser } from "@/server/auth/session";
import { failure, success } from "@/server/api/response";
import { getGitHubConnectionStatus } from "@/server/github/connection-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireCurrentUser();
    return success(await getGitHubConnectionStatus(user.id));
  } catch (error) {
    return failure(error);
  }
}
