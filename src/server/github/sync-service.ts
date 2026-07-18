import "server-only";

import { z } from "zod";
import {
  getGitHubRepository,
  listGitHubRepositories,
  type GitHubRepositorySummary,
} from "@/integrations/github/repositories";
import {
  type GitHubPullRequest,
  type GitHubPullRequestCommitSummary,
  type GitHubPullRequestFileSummary,
} from "@/integrations/github/pullRequests";
import { createGitHubAdminSupabaseClient } from "@/lib/supabase/github-admin";
import type { ForgeUser } from "@/server/auth/session";
import { AuthorizationError, DataAccessError } from "@/server/api/errors";
import { withGitHubClient } from "@/server/github/connection-service";
import { readGitHubRepositoryHistory } from "@/server/github/ingestion";
import { createGitHubSourcePassport } from "@/server/github/passport";
import { ensureForgeProjectForUser } from "@/server/workspace/project";

const idRowSchema = z.object({ id: z.string().uuid() });
const passportAnalysisCacheSchema = z.object({
  id: z.string().uuid(),
  analysis_status: z.enum(["pending", "running", "complete", "failed"]),
  analysis_source_head_sha: z.string().nullable(),
});

type PersistedPullRequest = {
  id: string;
  source: GitHubPullRequest;
  files: GitHubPullRequestFileSummary[];
  commits: GitHubPullRequestCommitSummary[];
};

function throwForSyncError(operation: string, error: { code?: string; message?: string } | null) {
  if (error) {
    throw new DataAccessError(operation);
  }
}

function reviewStatus(pullRequest: GitHubPullRequest) {
  if (pullRequest.state === "closed") {
    return "closed";
  }

  return "in_review";
}

async function persistRepository(
  projectId: string,
  userId: string,
  repository: GitHubRepositorySummary,
) {
  const supabase = createGitHubAdminSupabaseClient();
  // Do not switch the active repository while source history is still being
  // fetched. The atomic activation RPC runs only after every source record
  // below has been persisted successfully.
  const payload = {
    project_id: projectId,
    provider: "github",
    provider_repository_id: repository.id,
    full_name: repository.fullName,
    owner_login: repository.owner,
    visibility: repository.visibility,
    is_private: repository.visibility !== "public",
    description: repository.description,
    default_branch: repository.defaultBranch,
    language: repository.language,
    html_url: repository.htmlUrl,
    source_updated_at: repository.updatedAt,
    last_activity_at: repository.lastActivityAt,
    last_synced_at: new Date().toISOString(),
    created_by: userId,
    updated_by: userId,
  };

  const { data: existing, error: existingError } = await supabase
    .from("repositories")
    .select("id")
    .eq("project_id", projectId)
    .eq("provider", "github")
    .eq("provider_repository_id", repository.id)
    .maybeSingle();
  throwForSyncError("select this repository", existingError);

  if (existing) {
    const repositoryId = idRowSchema.parse(existing).id;
    const { error } = await supabase.from("repositories").update(payload).eq("id", repositoryId);
    throwForSyncError("save this repository", error);
    return repositoryId;
  }

  const { data, error } = await supabase
    .from("repositories")
    .insert({
      ...payload,
      is_selected: false,
      selected_at: null,
    })
    .select("id")
    .single();
  throwForSyncError("save this repository", error);
  return idRowSchema.parse(data).id;
}

async function activateGitHubRepository(projectId: string, repositoryId: string, userId: string) {
  const supabase = createGitHubAdminSupabaseClient();
  const { error } = await supabase.rpc("activate_github_repository", {
    p_project_id: projectId,
    p_repository_id: repositoryId,
    p_user_id: userId,
  });
  throwForSyncError("activate this repository", error);
}

export async function persistPullRequest(
  projectId: string,
  repositoryId: string,
  userId: string,
  source: GitHubPullRequest,
) {
  const supabase = createGitHubAdminSupabaseClient();
  const { data, error } = await supabase.from("pull_requests").upsert(
    {
      project_id: projectId,
      repository_id: repositoryId,
      provider_pull_request_id: source.id,
      number: source.number,
      title: source.title,
      description: source.description,
      author_display_name: source.authorDisplayName,
      author_login: source.authorLogin,
      base_ref: source.baseRef,
      head_ref: source.headRef,
      base_sha: source.baseSha,
      head_sha: source.headSha,
      files_changed: source.changedFiles,
      additions: source.additions,
      deletions: source.deletions,
      commits_count: source.commitsCount,
      github_state: source.state,
      is_draft: source.draft,
      review_status: reviewStatus(source),
      source_created_at: source.createdAt,
      source_updated_at: source.updatedAt,
      source_closed_at: source.closedAt,
      source_merged_at: source.mergedAt,
      source_url: source.htmlUrl,
      source_fetched_at: new Date().toISOString(),
      created_by: userId,
      updated_by: userId,
    },
    { onConflict: "repository_id,number" },
  ).select("id").single();
  throwForSyncError("save pull request history", error);
  return idRowSchema.parse(data).id;
}

export async function persistPullRequestFiles(input: {
  projectId: string;
  repositoryId: string;
  pullRequestId: string;
  userId: string;
  files: GitHubPullRequestFileSummary[];
}) {
  const supabase = createGitHubAdminSupabaseClient();
  const { error: deleteError } = await supabase
    .from("pull_request_files")
    .delete()
    .eq("pull_request_id", input.pullRequestId);
  throwForSyncError("refresh changed-file evidence", deleteError);

  if (input.files.length === 0) {
    return;
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from("pull_request_files").insert(
    input.files.map((file) => ({
      project_id: input.projectId,
      repository_id: input.repositoryId,
      pull_request_id: input.pullRequestId,
      provider_file_sha: file.sha,
      path: file.path,
      previous_path: file.previousPath,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      source_url: file.htmlUrl,
      patch: file.patch,
      source_fetched_at: now,
      created_by: input.userId,
      updated_by: input.userId,
    })),
  );
  throwForSyncError("save changed-file evidence", error);
}

export async function persistPullRequestCommits(input: {
  projectId: string;
  repositoryId: string;
  pullRequestId: string;
  userId: string;
  commits: GitHubPullRequestCommitSummary[];
}) {
  const supabase = createGitHubAdminSupabaseClient();
  const { error: deleteError } = await supabase
    .from("pull_request_commits")
    .delete()
    .eq("pull_request_id", input.pullRequestId);
  throwForSyncError("refresh commit evidence", deleteError);

  if (input.commits.length === 0) {
    return;
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from("pull_request_commits").insert(
    input.commits.map((commit) => ({
      project_id: input.projectId,
      repository_id: input.repositoryId,
      pull_request_id: input.pullRequestId,
      commit_sha: commit.sha,
      subject: commit.subject,
      author_login: commit.authorLogin,
      author_name: commit.authorName,
      authored_at: commit.authoredAt,
      committed_at: commit.committedAt,
      source_url: commit.htmlUrl,
      source_fetched_at: now,
      created_by: input.userId,
      updated_by: input.userId,
    })),
  );
  throwForSyncError("save commit evidence", error);
}

async function persistSourcePassport(input: {
  projectId: string;
  repositoryId: string;
  repositoryFullName: string;
  pullRequestId: string;
  userId: string;
  pullRequest: GitHubPullRequest;
  files: GitHubPullRequestFileSummary[];
  commits: GitHubPullRequestCommitSummary[];
}) {
  const supabase = createGitHubAdminSupabaseClient();
  const { data: existing, error: existingError } = await supabase
    .from("change_passports")
    .select("id, analysis_status, analysis_source_head_sha")
    .eq("pull_request_id", input.pullRequestId)
    .eq("passport_version", 1)
    .maybeSingle();
  throwForSyncError("check the existing Change Passport", existingError);

  if (existing) {
    const cachedAnalysis = passportAnalysisCacheSchema.parse(existing);
    if (
      cachedAnalysis.analysis_status === "complete"
      && cachedAnalysis.analysis_source_head_sha === input.pullRequest.headSha
    ) {
      // Repository selection should never overwrite an unchanged completed
      // analysis with a source-only shell. The selected-PR route will still
      // revalidate the complete cache against the full live source context.
      return;
    }
  }

  const sourcePassport = createGitHubSourcePassport({
    repositoryFullName: input.repositoryFullName,
    pullRequest: input.pullRequest,
    files: input.files,
    commits: input.commits,
  });
  const { data, error } = await supabase.from("change_passports").upsert(
    {
      project_id: input.projectId,
      repository_id: input.repositoryId,
      pull_request_id: input.pullRequestId,
      passport_version: 1,
      verdict: sourcePassport.verdict,
      summary: sourcePassport.summary,
      required_condition: sourcePassport.requiredCondition,
      confidence_label: sourcePassport.confidenceLabel,
      review_state: sourcePassport.reviewState,
      analysis_source_head_sha: null,
      analysis_input_hash: null,
      analysis_model: null,
      analysis_prompt_version: null,
      analysis_status: "pending",
      analysis_completed_at: null,
      analysis_error_code: null,
      analysis_error_message: null,
      analysis_payload: null,
      created_by: input.userId,
      updated_by: input.userId,
    },
    { onConflict: "pull_request_id,passport_version" },
  ).select("id").single();
  throwForSyncError("build this Change Passport", error);
  const passportId = idRowSchema.parse(data).id;

  const { error: deleteError } = await supabase.from("evidence").delete().eq("passport_id", passportId);
  throwForSyncError("refresh Passport evidence", deleteError);

  const evidence = sourcePassport.evidence;
  const { error: evidenceError } = await supabase.from("evidence").insert(
    evidence.map((entry) => ({
      project_id: input.projectId,
      passport_id: passportId,
      guarantee_id: null,
      ordinal: entry.ordinal,
      kind: entry.kind,
      tone: entry.tone,
      label: entry.label,
      title: entry.title,
      detail: entry.detail,
      source_label: entry.sourceLabel,
      source_path: entry.sourcePath,
      commit_sha: entry.commitSha,
      provider: "github",
      provider_object_id: entry.providerObjectId,
      source_url: entry.sourceUrl,
      source_fetched_at: new Date().toISOString(),
      created_by: input.userId,
      updated_by: input.userId,
    })),
  );
  throwForSyncError("save Passport evidence", evidenceError);
}

export async function listAvailableGitHubRepositories(user: ForgeUser) {
  return withGitHubClient(user.id, (client) => listGitHubRepositories(client));
}

export async function selectGitHubRepositoryForUser(user: ForgeUser, providerRepositoryId: string) {
  const availableRepositories = await listAvailableGitHubRepositories(user);
  const listedRepository = availableRepositories.find((repository) => repository.id === providerRepositoryId);
  if (!listedRepository) {
    throw new AuthorizationError();
  }

  const repository = await withGitHubClient(user.id, (client) => getGitHubRepository(
    client,
    listedRepository.owner,
    listedRepository.name,
  ));
  if (repository.id !== providerRepositoryId) {
    throw new AuthorizationError();
  }

  const admin = createGitHubAdminSupabaseClient();
  const project = await ensureForgeProjectForUser(admin, user.id);
  const repositoryId = await persistRepository(project.id, user.id, repository);

  const pullRequests = await withGitHubClient(user.id, (client) => readGitHubRepositoryHistory(client, repository, 10));

  const persistedPullRequests: PersistedPullRequest[] = [];
  for (const record of pullRequests) {
    const pullRequestId = await persistPullRequest(project.id, repositoryId, user.id, record.source);
    await Promise.all([
      persistPullRequestFiles({
        projectId: project.id,
        repositoryId,
        pullRequestId,
        userId: user.id,
        files: record.files,
      }),
      persistPullRequestCommits({
        projectId: project.id,
        repositoryId,
        pullRequestId,
        userId: user.id,
        commits: record.commits,
      }),
    ]);
    await persistSourcePassport({
      projectId: project.id,
      repositoryId,
      pullRequestId,
      userId: user.id,
      pullRequest: record.source,
      files: record.files,
      commits: record.commits,
      repositoryFullName: repository.fullName,
    });
    persistedPullRequests.push({ id: pullRequestId, ...record });
  }

  await activateGitHubRepository(project.id, repositoryId, user.id);

  return {
    repositoryId,
    repository,
    pullRequestCount: persistedPullRequests.length,
  };
}
