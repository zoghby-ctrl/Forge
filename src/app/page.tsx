import { ForgeDemo } from "@/features/demo/forge-demo";
import { workspaceStageSchema } from "@/domain/forge-workspace";
import { getCurrentUser } from "@/server/auth/session";
import { loadForgeWorkspaceForUser } from "@/server/workspace/service";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; github?: string }>;
}) {
  const [{ stage, github }, user] = await Promise.all([searchParams, getCurrentUser()]);

  if (!user) {
    return <ForgeDemo />;
  }

  const workspace = await loadForgeWorkspaceForUser(user);
  const requestedStage = workspaceStageSchema.safeParse(stage);

  return (
    <ForgeDemo
      workspace={workspace}
      initialStage={requestedStage.success ? requestedStage.data : "landing"}
      initialGitHubNotice={github}
    />
  );
}
