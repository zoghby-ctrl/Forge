import "server-only";

import type { ForgeUser } from "@/server/auth/session";
import { DataAccessError, NotFoundError, ValidationError } from "@/server/api/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { PassportAnalysisInput, PassportAnalysisResult } from "@/server/openai/contracts";
import { passportAnalysisSchema, type PassportCitation } from "@/server/openai/schema";

const maxDiffCharacters = 180_000;
const maxPatchCharacters = 24_000;

type PassportRecord = {
  id: string;
  project_id: string;
  repository_id: string;
  pull_request_id: string;
  analysis_status: "pending" | "running" | "complete" | "failed";
  analysis_source_head_sha: string | null;
  analysis_payload: unknown;
  updated_at: string;
};

type PullRequestRecord = {
  number: number;
  title: string;
  description: string | null;
  author_display_name: string;
  base_ref: string;
  head_ref: string;
  base_sha: string | null;
  head_sha: string | null;
  source_url: string | null;
};

type FileRecord = {
  provider_file_sha: string;
  path: string;
  previous_path: string | null;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
  source_url: string | null;
};

type CommitRecord = {
  commit_sha: string;
  subject: string;
  author_login: string | null;
  author_name: string | null;
  authored_at: string | null;
  committed_at: string | null;
  source_url: string | null;
};

export type PassportSourceContext = {
  passport: PassportRecord;
  repositoryFullName: string;
  input: PassportAnalysisInput;
};

function throwForDataError(operation: string, error: { code?: string; message?: string } | null) {
  if (error) throw new DataAccessError(operation);
}

function truncate(value: string, maximum: number) {
  if (value.length <= maximum) return { value, truncated: false };
  return {
    value: `${value.slice(0, maximum)}\n\n[Forge truncated this source for the model input.]`,
    truncated: true,
  };
}

function buildStoredDiff(files: FileRecord[]) {
  const rawDiff = files.map((file) => {
    const fromPath = file.previous_path ?? file.path;
    const patch = file.patch ?? "[GitHub did not provide a textual patch for this changed file.]";
    return `diff --git a/${fromPath} b/${file.path}\n${patch}`;
  }).join("\n\n");
  return truncate(rawDiff, maxDiffCharacters);
}

function createStoredAnalysisInput(input: {
  repositoryFullName: string;
  pullRequest: PullRequestRecord;
  files: FileRecord[];
  commits: CommitRecord[];
}): PassportAnalysisInput {
  if (!input.pullRequest.base_sha || !input.pullRequest.head_sha || !input.pullRequest.source_url) {
    throw new DataAccessError("read the complete pull request source");
  }
  const diff = buildStoredDiff(input.files);

  return {
    repositoryFullName: input.repositoryFullName,
    pullRequest: {
      number: input.pullRequest.number,
      title: input.pullRequest.title,
      description: input.pullRequest.description,
      author: input.pullRequest.author_display_name,
      baseRef: input.pullRequest.base_ref,
      headRef: input.pullRequest.head_ref,
      baseSha: input.pullRequest.base_sha,
      headSha: input.pullRequest.head_sha,
      htmlUrl: input.pullRequest.source_url,
    },
    files: input.files.map((file) => ({
      sha: file.provider_file_sha,
      path: file.path,
      previousPath: file.previous_path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch ? truncate(file.patch, maxPatchCharacters).value : null,
      htmlUrl: file.source_url,
    })),
    commits: input.commits.map((commit) => ({
      sha: commit.commit_sha,
      subject: commit.subject,
      author: commit.author_name ?? commit.author_login,
      authoredAt: commit.authored_at,
      committedAt: commit.committed_at,
      htmlUrl: commit.source_url ?? input.pullRequest.source_url!,
    })),
    diff: diff.value,
    diffTruncated: diff.truncated,
  };
}

/** Read the persisted GitHub source through RLS; no source data reaches the browser. */
export async function loadPassportSourceForUser(user: ForgeUser, passportId: string): Promise<PassportSourceContext> {
  const supabase = await createServerSupabaseClient();
  const { data: passportData, error: passportError } = await supabase
    .from("change_passports")
    .select("id, project_id, repository_id, pull_request_id, analysis_status, analysis_source_head_sha, analysis_payload, updated_at")
    .eq("id", passportId)
    .maybeSingle();
  throwForDataError("load this Change Passport", passportError);
  if (!passportData) throw new NotFoundError("Change Passport");
  const passport = passportData as PassportRecord;

  const [{ data: repositoryData, error: repositoryError }, { data: pullRequestData, error: pullRequestError }, { data: fileData, error: fileError }, { data: commitData, error: commitError }] = await Promise.all([
    supabase.from("repositories").select("full_name").eq("id", passport.repository_id).maybeSingle(),
    supabase
      .from("pull_requests")
      .select("number, title, description, author_display_name, base_ref, head_ref, base_sha, head_sha, source_url")
      .eq("id", passport.pull_request_id)
      .maybeSingle(),
    supabase
      .from("pull_request_files")
      .select("provider_file_sha, path, previous_path, status, additions, deletions, changes, patch, source_url")
      .eq("pull_request_id", passport.pull_request_id)
      .order("path"),
    supabase
      .from("pull_request_commits")
      .select("commit_sha, subject, author_login, author_name, authored_at, committed_at, source_url")
      .eq("pull_request_id", passport.pull_request_id)
      .order("committed_at", { ascending: true }),
  ]);
  throwForDataError("load this repository", repositoryError);
  throwForDataError("load this pull request", pullRequestError);
  throwForDataError("load changed-file source", fileError);
  throwForDataError("load commit source", commitError);
  if (!repositoryData) throw new NotFoundError("Repository");
  if (!pullRequestData) throw new NotFoundError("Pull request");

  const repository = repositoryData as { full_name: string };
  const input = createStoredAnalysisInput({
    repositoryFullName: repository.full_name,
    pullRequest: pullRequestData as PullRequestRecord,
    files: (fileData ?? []) as FileRecord[],
    commits: (commitData ?? []) as CommitRecord[],
  });

  return { passport, repositoryFullName: repository.full_name, input };
}

export function requireCompletedPassportAnalysis(source: PassportSourceContext): PassportAnalysisResult {
  if (source.passport.analysis_status !== "complete") {
    throw new ValidationError("Complete this Change Passport analysis before using AI review.");
  }
  const analysis = passportAnalysisSchema.safeParse(source.passport.analysis_payload);
  if (!analysis.success) {
    throw new ValidationError("This Change Passport does not have a valid completed analysis. Run it again before using AI review.");
  }
  return analysis.data;
}

/** Resolve a validated citation to a URL from the verified source, never from the model. */
export function getCitationSourceUrl(citation: PassportCitation, source: PassportAnalysisInput) {
  if (citation.sourceKind === "commit" && citation.commitSha) {
    return source.commits.find((commit) => commit.sha === citation.commitSha)?.htmlUrl ?? source.pullRequest.htmlUrl;
  }
  if ((citation.sourceKind === "changed_file" || citation.sourceKind === "diff") && citation.path) {
    return source.files.find((file) => file.path === citation.path)?.htmlUrl ?? source.pullRequest.htmlUrl;
  }
  return source.pullRequest.htmlUrl;
}
