import { failure, success } from "@/server/api/response";
import { requireCurrentUser } from "@/server/auth/session";
import { getForgeWorkspaceForUser } from "@/server/workspace/service";

export async function GET() {
  try {
    const user = await requireCurrentUser();
    const workspace = await getForgeWorkspaceForUser(user);
    return success(workspace);
  } catch (error) {
    return failure(error);
  }
}
