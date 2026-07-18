import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  forgeDecisionSchema,
  forgeWorkspaceSchema,
  type ForgeDecision,
  type ForgeGitHubConnection,
  type ForgeWorkspace,
  type RecordDecisionInput,
  type StageRepairPathInput,
} from "@/domain/forge-workspace";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { ForgeUser } from "@/server/auth/session";
import { ensureCurrentUserProfile } from "@/server/auth/session";
import { DataAccessError, NotFoundError } from "@/server/api/errors";
import { getGitHubConnectionStatus } from "@/server/github/connection-service";
import { logError } from "@/server/observability/logger";
import { ensureForgeProjectForUser, type ForgeProjectRow } from "@/server/workspace/project";

type RepositoryRow = {
  id: string;
  project_id: string;
  full_name: string;
  owner_login: string | null;
  visibility: "public" | "private" | "internal";
  description: string | null;
  default_branch: string;
  language: string | null;
  html_url: string | null;
  last_activity_at: string | null;
};

type PullRequestRow = {
  id: string;
  repository_id: string;
  number: number;
  title: string;
  author_display_name: string;
  head_ref: string;
  base_sha: string | null;
  head_sha: string | null;
  files_changed: number;
  additions: number;
  deletions: number;
  commits_count: number;
  review_status: "needs_decision" | "ready" | "in_review" | "closed";
  source_created_at: string | null;
  source_updated_at: string | null;
  source_merged_at: string | null;
  source_url: string | null;
};

type PassportRow = {
  id: string;
  project_id: string;
  repository_id: string;
  pull_request_id: string;
  verdict: "ship" | "ship_with_conditions" | "hold" | "insufficient_evidence";
  summary: string;
  required_condition: string;
  confidence_label: string;
  review_state: string;
  analysis_status: "pending" | "running" | "complete" | "failed";
  analysis_error_message: string | null;
  repair_staged_at: string | null;
};

type EvidenceRow = {
  id: string;
  passport_id: string;
  guarantee_id: string | null;
  ordinal: number;
  kind: "intent" | "guarantee" | "path" | "contradiction" | "repair";
  tone: "default" | "alert" | "repair";
  label: string;
  title: string;
  detail: string;
  source_label: string;
  source_path: string | null;
  commit_sha: string | null;
  source_url: string | null;
};

type DecisionRow = {
  id: string;
  passport_id: string;
  action: "ship" | "ship_with_conditions" | "hold" | "insufficient_evidence";
  recorded_at: string;
};

function throwForDatabaseError(operation: string, error: { code?: string; message?: string } | null) {
  if (!error) {
    return;
  }

  logError("Supabase data operation failed", { requestId: error.code });
  throw new DataAccessError(operation);
}

function statusLabel(status: PullRequestRow["review_status"]) {
  switch (status) {
    case "needs_decision":
      return "Needs a decision";
    case "ready":
      return "Ready to merge";
    case "in_review":
      return "In review";
    case "closed":
      return "Closed";
  }
}

function relativeTime(timestamp: string | null) {
  if (!timestamp) {
    return "No recent activity";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "Recently updated";
  }

  const elapsedMilliseconds = Math.max(0, Date.now() - date.getTime());
  const elapsedMinutes = Math.floor(elapsedMilliseconds / 60_000);

  if (elapsedMinutes < 1) return "just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;

  return `${Math.floor(elapsedHours / 24)}d ago`;
}

function emptyWorkspace(project: ForgeProjectRow, github: ForgeGitHubConnection): ForgeWorkspace {
  return forgeWorkspaceSchema.parse({
    project,
    github,
    repositories: [],
    pullRequests: [],
    // Behavioral guarantees require source analysis. Until that work exists,
    // Forge intentionally presents no inferred guarantees rather than seeding
    // a plausible-sounding claim.
    guarantees: [],
    passports: [],
  });
}

async function readWorkspace(
  supabase: SupabaseClient,
  project: ForgeProjectRow,
  github: ForgeGitHubConnection,
): Promise<ForgeWorkspace> {
  if (github.status !== "connected") {
    return emptyWorkspace(project, github);
  }

  const { data: repositoryData, error: repositoryError } = await supabase
    .from("repositories")
    .select("id, project_id, full_name, owner_login, visibility, description, default_branch, language, html_url, last_activity_at")
    .eq("project_id", project.id)
    .eq("provider", "github")
    .eq("is_selected", true)
    .order("selected_at", { ascending: false });
  throwForDatabaseError("load your connected repository", repositoryError);
  const repositories = (repositoryData ?? []) as RepositoryRow[];

  if (repositories.length === 0) {
    return emptyWorkspace(project, github);
  }

  const repositoryIds = repositories.map((repository) => repository.id);
  const { data: pullRequestData, error: pullRequestError } = await supabase
    .from("pull_requests")
    .select("id, repository_id, number, title, author_display_name, head_ref, base_sha, head_sha, files_changed, additions, deletions, commits_count, review_status, source_created_at, source_updated_at, source_merged_at, source_url")
    .in("repository_id", repositoryIds)
    .order("source_updated_at", { ascending: false });
  throwForDatabaseError("load pull request history", pullRequestError);
  const pullRequests = (pullRequestData ?? []) as PullRequestRow[];

  const { data: passportData, error: passportError } = await supabase
    .from("change_passports")
    .select("id, project_id, repository_id, pull_request_id, verdict, summary, required_condition, confidence_label, review_state, analysis_status, analysis_error_message, repair_staged_at")
    .in("repository_id", repositoryIds)
    .order("created_at");
  throwForDatabaseError("load Change Passports", passportError);
  const passports = (passportData ?? []) as PassportRow[];
  const passportIds = passports.map((passport) => passport.id);

  const { data: evidenceData, error: evidenceError } = passportIds.length > 0
    ? await supabase
      .from("evidence")
      .select("id, passport_id, guarantee_id, ordinal, kind, tone, label, title, detail, source_label, source_path, commit_sha, source_url")
      .in("passport_id", passportIds)
      .order("ordinal")
    : { data: [], error: null };
  throwForDatabaseError("load Passport evidence", evidenceError);
  const evidence = (evidenceData ?? []) as EvidenceRow[];

  const { data: decisionData, error: decisionError } = passportIds.length > 0
    ? await supabase
      .from("decisions")
      .select("id, passport_id, action, recorded_at")
      .in("passport_id", passportIds)
      .order("recorded_at", { ascending: false })
    : { data: [], error: null };
  throwForDatabaseError("load recorded decisions", decisionError);
  const decisions = (decisionData ?? []) as DecisionRow[];

  const openPullRequestCounts = new Map<string, number>();
  for (const pullRequest of pullRequests) {
    if (pullRequest.review_status !== "closed") {
      openPullRequestCounts.set(
        pullRequest.repository_id,
        (openPullRequestCounts.get(pullRequest.repository_id) ?? 0) + 1,
      );
    }
  }

  const evidenceByPassport = new Map<string, EvidenceRow[]>();
  for (const item of evidence) {
    const entries = evidenceByPassport.get(item.passport_id) ?? [];
    entries.push(item);
    evidenceByPassport.set(item.passport_id, entries);
  }

  const decisionByPassport = new Map<string, DecisionRow>();
  for (const decision of decisions) {
    if (!decisionByPassport.has(decision.passport_id)) {
      decisionByPassport.set(decision.passport_id, decision);
    }
  }

  return forgeWorkspaceSchema.parse({
    project,
    github,
    repositories: repositories.map((repository) => ({
      id: repository.id,
      projectId: repository.project_id,
      fullName: repository.full_name,
      description: repository.description,
      branch: repository.default_branch,
      language: repository.language,
      openPullRequests: openPullRequestCounts.get(repository.id) ?? 0,
      owner: repository.owner_login,
      visibility: repository.visibility,
      lastActivityAt: repository.last_activity_at,
      lastActivityLabel: relativeTime(repository.last_activity_at),
      htmlUrl: repository.html_url,
    })),
    pullRequests: pullRequests.map((pullRequest) => ({
      id: pullRequest.id,
      repositoryId: pullRequest.repository_id,
      number: pullRequest.number,
      title: pullRequest.title,
      author: pullRequest.author_display_name,
      branch: pullRequest.head_ref,
      base: pullRequest.base_sha ?? "base unavailable",
      head: pullRequest.head_sha ?? "head unavailable",
      filesChanged: pullRequest.files_changed,
      additions: pullRequest.additions,
      deletions: pullRequest.deletions,
      commitsCount: pullRequest.commits_count,
      createdAt: pullRequest.source_created_at,
      mergedAt: pullRequest.source_merged_at,
      htmlUrl: pullRequest.source_url,
      status: pullRequest.review_status,
      statusLabel: statusLabel(pullRequest.review_status),
      updatedLabel: relativeTime(pullRequest.source_updated_at),
    })),
    guarantees: [],
    passports: passports.map((passport) => {
      const decision = decisionByPassport.get(passport.id);

      return {
        id: passport.id,
        projectId: passport.project_id,
        repositoryId: passport.repository_id,
        pullRequestId: passport.pull_request_id,
        verdict: passport.verdict,
        summary: passport.summary,
        condition: passport.required_condition,
        confidence: passport.confidence_label,
        reviewState: passport.review_state,
        analysisStatus: passport.analysis_status,
        analysisError: passport.analysis_error_message,
        repairStaged: Boolean(passport.repair_staged_at),
        evidence: (evidenceByPassport.get(passport.id) ?? []).map((item) => ({
          id: item.id,
          passportId: item.passport_id,
          guaranteeId: item.guarantee_id,
          ordinal: item.ordinal,
          kind: item.kind,
          tone: item.tone,
          label: item.label,
          title: item.title,
          detail: item.detail,
          source: item.source_label,
          sourcePath: item.source_path,
          commitSha: item.commit_sha,
          sourceUrl: item.source_url,
        })),
        decision: decision
          ? {
            id: decision.id,
            action: decision.action,
            recordedAt: decision.recorded_at,
          }
          : null,
      };
    }),
  });
}

export async function loadForgeWorkspaceForUser(user: ForgeUser) {
  await ensureCurrentUserProfile(user);
  const supabase = await createServerSupabaseClient();
  const project = await ensureForgeProjectForUser(supabase, user.id);
  const connection = await getGitHubConnectionStatus(user.id);

  return readWorkspace(supabase, project, connection);
}

export async function getForgeWorkspaceForUser(user: ForgeUser) {
  return loadForgeWorkspaceForUser(user);
}

export async function stagePassportRepairForUser(
  user: ForgeUser,
  passportId: string,
  input: StageRepairPathInput,
) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("change_passports")
    .update({
      repair_staged_at: input.repairStaged ? new Date().toISOString() : null,
      repair_staged_by: input.repairStaged ? user.id : null,
      updated_by: user.id,
    })
    .eq("id", passportId)
    .select("id, repair_staged_at")
    .maybeSingle();

  throwForDatabaseError("stage the repair path", error);
  if (!data) {
    throw new NotFoundError("Change Passport");
  }

  return {
    passportId: (data as { id: string }).id,
    repairStaged: Boolean((data as { repair_staged_at: string | null }).repair_staged_at),
  };
}

export async function recordPassportDecisionForUser(
  _user: ForgeUser,
  passportId: string,
  input: RecordDecisionInput,
): Promise<{ passportId: string; decision: ForgeDecision }> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("record_forge_decision", {
    p_passport_id: passportId,
    p_action: input.action,
    p_idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
    p_rationale: null,
  });

  if (error?.code === "P0002") {
    throw new NotFoundError("Change Passport");
  }
  throwForDatabaseError("record this decision", error);

  const row = data as Pick<DecisionRow, "id" | "action" | "recorded_at"> | null;
  if (!row) {
    throw new DataAccessError("record this decision");
  }

  return {
    passportId,
    decision: forgeDecisionSchema.parse({
      id: row.id,
      action: row.action,
      recordedAt: row.recorded_at,
    }),
  };
}
