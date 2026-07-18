import { requireCurrentUser } from "@/server/auth/session";
import { requireSameOrigin } from "@/server/api/request";
import { failure, success } from "@/server/api/response";
import { disconnectGitHub } from "@/server/github/connection-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await requireCurrentUser();
    return success(await disconnectGitHub(user.id));
  } catch (error) {
    return failure(error);
  }
}
