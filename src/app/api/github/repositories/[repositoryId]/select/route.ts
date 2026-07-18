import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/session";
import { requireSameOrigin } from "@/server/api/request";
import { failure, success } from "@/server/api/response";
import { selectGitHubRepositoryForUser } from "@/server/github/sync-service";
import { getForgeWorkspaceForUser } from "@/server/workspace/service";
import { logInfo } from "@/server/observability/logger";

export const dynamic = "force-dynamic";

const providerRepositoryIdSchema = z.string().regex(/^\d+$/);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ repositoryId: string }> },
) {
  const requestId = crypto.randomUUID();
  let repositoryId: string | undefined;

  try {
    requireSameOrigin(request);
    const [user, routeParams] = await Promise.all([requireCurrentUser(), params]);
    repositoryId = providerRepositoryIdSchema.parse(routeParams.repositoryId);

    logInfo("GitHub repository selection started", {
      requestId,
      integration: "github",
      githubStage: "repository_selection_started",
      githubRepositoryId: repositoryId,
      session: "present",
    });
    const selected = await selectGitHubRepositoryForUser(
      user,
      repositoryId,
    );
    const workspace = await getForgeWorkspaceForUser(user);
    logInfo("GitHub repository selection completed", {
      requestId,
      integration: "github",
      githubStage: "repository_workspace_loaded",
      githubRepositoryId: repositoryId,
    });
    const response = success({ repositoryId: selected.repositoryId, workspace });
    response.headers.set("X-Forge-Request-Id", requestId);
    return response;
  } catch (error) {
    const response = failure(error, {
      requestId,
      integration: "github",
      githubStage: "repository_selection",
      githubRepositoryId: repositoryId,
    });
    response.headers.set("X-Forge-Request-Id", requestId);
    return response;
  }
}
