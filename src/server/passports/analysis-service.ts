import "server-only";

import type { ForgePassport } from "@/domain/forge-workspace";
import {
  readGitHubPullRequestAnalysisContext,
  type GitHubPullRequestAnalysisContext,
} from "@/integrations/github/pullRequests";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createGitHubAdminSupabaseClient } from "@/lib/supabase/github-admin";
import { getAIAnalysisInputHash, getSelectedAIProvider } from "@/server/ai";
import { DataAccessError, NotFoundError } from "@/server/api/errors";
import type { ForgeUser } from "@/server/auth/session";
import { withGitHubClient } from "@/server/github/connection-service";
import {
  persistPullRequest,
  persistPullRequestCommits,
  persistPullRequestFiles,
} from "@/server/github/sync-service";
import { createGitHubSourcePassport } from "@/server/github/passport";
import { logError, logInfo } from "@/server/observability/logger";
import {
  createPassportAnalysisInput,
} from "@/server/openai/passport";
import { passportPromptVersion } from "@/server/openai/prompts";
import type {
  PassportAnalysisInput,
  PassportAnalysisResult,
} from "@/server/openai/contracts";
import type { PassportCitation, PassportGroundedClaim } from "@/server/openai/schema";
import { getForgeWorkspaceForUser } from "@/server/workspace/service";
import { withAnalysisReviewPayload } from "@/server/passports/passport-extensions";

export type PassportAnalysisProgress = {
  phase:
    | "reading_pull_request"
    | "loading_changed_files"
    | "analyzing_guarantees"
    | "searching_contradictions"
    | "generating_repair"
    | "decision_complete";
  message: string;
};

type AnalysisTarget = {
  passportId: string;
  projectId: string;
  repositoryId: string;
  pullRequestId: string;
  repositoryFullName: string;
  pullRequestNumber: number;
  analysisStatus: "pending" | "running" | "complete" | "failed";
  analysisInputHash: string | null;
  analysisModel: string | null;
  analysisPromptVersion: string | null;
  analysisPayload: unknown;
};

type PersistableEvidence = {
  ordinal: number;
  kind: "intent" | "guarantee" | "path" | "contradiction" | "repair";
  tone: "default" | "alert" | "repair";
  label: string;
  title: string;
  detail: string;
  source_label: string;
  source_path: string | null;
  commit_sha: string | null;
  line_start: number | null;
  line_end: number | null;
  excerpt: string | null;
  provider_object_id: string;
  source_url: string;
};

const maxDatabaseText = {
  label: 120,
  title: 1_000,
  detail: 4_000,
  sourceLabel: 1_000,
  confidence: 160,
};

function limitText(value: string, maximum: number) {
  return value.length <= maximum ? value : `${value.slice(0, Math.max(0, maximum - 1))}…`;
}

function throwForDataError(operation: string, error: { code?: string; message?: string } | null) {
  if (error) {
    throw new DataAccessError(operation);
  }
}

async function loadAnalysisTarget(user: ForgeUser, passportId: string): Promise<AnalysisTarget> {
  const supabase = await createServerSupabaseClient();
  const { data: passport, error: passportError } = await supabase
    .from("change_passports")
    .select("id, project_id, repository_id, pull_request_id, analysis_status, analysis_input_hash, analysis_model, analysis_prompt_version, analysis_payload")
    .eq("id", passportId)
    .maybeSingle();
  throwForDataError("load this Change Passport", passportError);
  if (!passport) {
    throw new NotFoundError("Change Passport");
  }

  const { data: repository, error: repositoryError } = await supabase
    .from("repositories")
    .select("full_name")
    .eq("id", passport.repository_id)
    .maybeSingle();
  throwForDataError("load this repository", repositoryError);
  if (!repository) {
    throw new NotFoundError("Repository");
  }

  const { data: pullRequest, error: pullRequestError } = await supabase
    .from("pull_requests")
    .select("number")
    .eq("id", passport.pull_request_id)
    .maybeSingle();
  throwForDataError("load this pull request", pullRequestError);
  if (!pullRequest) {
    throw new NotFoundError("Pull request");
  }

  return {
    passportId: passport.id,
    projectId: passport.project_id,
    repositoryId: passport.repository_id,
    pullRequestId: passport.pull_request_id,
    repositoryFullName: repository.full_name,
    pullRequestNumber: pullRequest.number,
    analysisStatus: passport.analysis_status,
    analysisInputHash: passport.analysis_input_hash,
    analysisModel: passport.analysis_model,
    analysisPromptVersion: passport.analysis_prompt_version,
    analysisPayload: passport.analysis_payload,
  };
}

function splitRepositoryFullName(fullName: string) {
  const slash = fullName.indexOf("/");
  if (slash <= 0 || slash === fullName.length - 1) {
    throw new DataAccessError("read this repository");
  }

  return { owner: fullName.slice(0, slash), repository: fullName.slice(slash + 1) };
}

async function markAnalysisRunning(target: AnalysisTarget, userId: string) {
  const admin = createGitHubAdminSupabaseClient();
  const { error } = await admin
    .from("change_passports")
    .update({
      analysis_status: "running",
      analysis_error_code: null,
      analysis_error_message: null,
      updated_by: userId,
    })
    .eq("id", target.passportId)
    .eq("project_id", target.projectId);
  throwForDataError("start this AI analysis", error);
}

async function markAnalysisFailed(target: AnalysisTarget, userId: string, error: unknown) {
  const admin = createGitHubAdminSupabaseClient();
  const code = error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "OPENAI_ANALYSIS_FAILED";
  const { error: updateError } = await admin
    .from("change_passports")
    .update({
      analysis_status: "failed",
      analysis_error_code: limitText(code, 120),
      analysis_error_message: "Forge could not complete this AI analysis. Please retry.",
      updated_by: userId,
    })
    .eq("id", target.passportId)
    .eq("project_id", target.projectId);

  if (updateError) {
    logError("Could not mark Change Passport analysis as failed", {
      passportId: target.passportId,
      errorName: "SupabaseError",
      errorCode: updateError.code,
    });
  }
}

async function refreshPersistedGitHubSource(input: {
  target: AnalysisTarget;
  user: ForgeUser;
  source: GitHubPullRequestAnalysisContext;
}) {
  const pullRequestId = await persistPullRequest(
    input.target.projectId,
    input.target.repositoryId,
    input.user.id,
    input.source.pullRequest,
  );
  if (pullRequestId !== input.target.pullRequestId) {
    throw new DataAccessError("refresh this pull request source");
  }

  await Promise.all([
    persistPullRequestFiles({
      projectId: input.target.projectId,
      repositoryId: input.target.repositoryId,
      pullRequestId,
      userId: input.user.id,
      files: input.source.files,
    }),
    persistPullRequestCommits({
      projectId: input.target.projectId,
      repositoryId: input.target.repositoryId,
      pullRequestId,
      userId: input.user.id,
      commits: input.source.commits,
    }),
  ]);
}

function sourceForCitation(citation: PassportCitation, input: PassportAnalysisInput) {
  const file = citation.path ? input.files.find((item) => item.path === citation.path) ?? null : null;
  const commit = citation.commitSha
    ? input.commits.find((item) => item.sha === citation.commitSha) ?? null
    : null;

  if (citation.sourceKind === "commit" && commit) {
    return {
      sourceLabel: `GitHub commit · ${commit.sha.slice(0, 12)}`,
      sourcePath: null,
      commitSha: commit.sha,
      sourceUrl: commit.htmlUrl,
      providerObjectId: commit.sha,
    };
  }

  if (file) {
    return {
      sourceLabel: `GitHub file · ${file.path}`,
      sourcePath: file.path,
      commitSha: citation.commitSha ?? input.pullRequest.headSha,
      sourceUrl: file.htmlUrl ?? input.pullRequest.htmlUrl,
      providerObjectId: file.sha,
    };
  }

  return {
    sourceLabel: `GitHub pull request #${input.pullRequest.number}`,
    sourcePath: null,
    commitSha: citation.commitSha ?? input.pullRequest.headSha,
    sourceUrl: input.pullRequest.htmlUrl,
    providerObjectId: String(input.pullRequest.number),
  };
}

function claimToEvidence(input: {
  ordinal: number;
  kind: PersistableEvidence["kind"];
  tone: PersistableEvidence["tone"];
  label: string;
  claim: PassportGroundedClaim;
  citation: PassportCitation;
  source: PassportAnalysisInput;
}): PersistableEvidence {
  const source = sourceForCitation(input.citation, input.source);

  return {
    ordinal: input.ordinal,
    kind: input.kind,
    tone: input.tone,
    label: limitText(input.label, maxDatabaseText.label),
    title: limitText(input.claim.statement, maxDatabaseText.title),
    detail: limitText(input.claim.rationale, maxDatabaseText.detail),
    source_label: limitText(source.sourceLabel, maxDatabaseText.sourceLabel),
    source_path: source.sourcePath,
    commit_sha: source.commitSha,
    line_start: input.citation.lineStart,
    line_end: input.citation.lineEnd,
    excerpt: limitText(input.citation.note, maxDatabaseText.detail),
    provider_object_id: source.providerObjectId,
    source_url: source.sourceUrl,
  };
}

function mapAnalysisToEvidence(input: {
  repositoryFullName: string;
  source: GitHubPullRequestAnalysisContext;
  analysisInput: PassportAnalysisInput;
  analysis: PassportAnalysisResult;
}) {
  const sourceEvidence = createGitHubSourcePassport({
    repositoryFullName: input.repositoryFullName,
    pullRequest: input.source.pullRequest,
    files: input.source.files,
    commits: input.source.commits,
  }).evidence.map<PersistableEvidence>((entry) => ({
    ordinal: entry.ordinal,
    kind: entry.kind,
    tone: entry.tone,
    label: entry.label,
    title: limitText(entry.title, maxDatabaseText.title),
    detail: limitText(entry.detail, maxDatabaseText.detail),
    source_label: entry.sourceLabel,
    source_path: entry.sourcePath,
    commit_sha: entry.commitSha,
    line_start: null,
    line_end: null,
    excerpt: null,
    provider_object_id: entry.providerObjectId,
    source_url: entry.sourceUrl,
  }));

  const mapped: PersistableEvidence[] = [...sourceEvidence];
  const addClaim = (
    kind: PersistableEvidence["kind"],
    tone: PersistableEvidence["tone"],
    label: string,
    claim: PassportGroundedClaim,
  ) => {
    claim.citations.forEach((citation, citationIndex) => {
      mapped.push(claimToEvidence({
        ordinal: mapped.length + 1,
        kind,
        tone,
        label: claim.citations.length > 1 ? `${label} · evidence ${citationIndex + 1}` : label,
        claim,
        citation,
        source: input.analysisInput,
      }));
    });
  };

  addClaim("intent", "default", "Intent", input.analysis.intent);
  input.analysis.guarantees.forEach((claim) => addClaim("guarantee", "default", "Guarantee", claim));
  input.analysis.evidence.forEach((claim) => addClaim("path", "default", "Analysis evidence", claim));
  input.analysis.contradictions.forEach((claim) => addClaim("contradiction", "alert", "Contradiction", claim));
  input.analysis.blastRadius.forEach((claim) => addClaim("path", "alert", "Blast radius", claim));
  input.analysis.repairPlan.forEach((claim) => addClaim("repair", "repair", "Repair plan", claim));

  return mapped;
}

async function persistAnalysis(input: {
  target: AnalysisTarget;
  user: ForgeUser;
  analysisInput: PassportAnalysisInput;
  analysisHash: string;
  analysisModel: string;
  source: GitHubPullRequestAnalysisContext;
  analysis: PassportAnalysisResult;
}) {
  const evidence = mapAnalysisToEvidence({
    repositoryFullName: input.target.repositoryFullName,
    source: input.source,
    analysisInput: input.analysisInput,
    analysis: input.analysis,
  });
  const confidence = limitText(
    `${input.analysis.confidence.score}% confidence · ${input.analysis.confidence.rationale}`,
    maxDatabaseText.confidence,
  );
  const requiredCondition = limitText(input.analysis.repairPlan[0]!.statement, 8_000);
  const admin = createGitHubAdminSupabaseClient();
  const { error } = await admin.rpc("persist_forge_passport_analysis", {
    p_passport_id: input.target.passportId,
    p_user_id: input.user.id,
    p_analysis_source_head_sha: input.analysisInput.pullRequest.headSha,
    p_analysis_input_hash: input.analysisHash,
    p_analysis_model: input.analysisModel,
    p_analysis_prompt_version: passportPromptVersion,
    // The analysis result remains at the existing top level. Preserve the
    // namespaced review sidecar so re-analysis never erases a user's chat.
    p_analysis_payload: withAnalysisReviewPayload(input.analysis, input.target.analysisPayload),
    p_verdict: input.analysis.verdict,
    p_summary: limitText(input.analysis.summary, 8_000),
    p_required_condition: requiredCondition,
    p_confidence_label: confidence,
    p_evidence: evidence,
  });
  throwForDataError("save this AI Change Passport", error);
}

async function loadCompletedPassport(user: ForgeUser, passportId: string) {
  const workspace = await getForgeWorkspaceForUser(user);
  const passport = workspace.passports.find((item) => item.id === passportId);
  if (!passport) {
    throw new NotFoundError("Change Passport");
  }
  return passport;
}

export async function analyzePassportForUser(input: {
  user: ForgeUser;
  passportId: string;
  onProgress: (progress: PassportAnalysisProgress) => void;
  requestId: string;
}): Promise<{ passport: ForgePassport; cached: boolean }> {
  let target: AnalysisTarget | null = null;

  try {
    target = await loadAnalysisTarget(input.user, input.passportId);
    const { owner, repository } = splitRepositoryFullName(target.repositoryFullName);

    input.onProgress({ phase: "reading_pull_request", message: "Reading pull request..." });
    input.onProgress({ phase: "loading_changed_files", message: "Loading changed files..." });
    const source = await withGitHubClient(input.user.id, (client) => readGitHubPullRequestAnalysisContext(
      client,
      owner,
      repository,
      target!.pullRequestNumber,
    ));
    const analysisInput = createPassportAnalysisInput({
      repositoryFullName: target.repositoryFullName,
      source,
    });
    const aiProvider = getSelectedAIProvider();
    const analysisHash = getAIAnalysisInputHash(analysisInput, aiProvider);
    const isCached = target.analysisStatus === "complete"
      && target.analysisInputHash === analysisHash
      && target.analysisModel === aiProvider.model
      && target.analysisPromptVersion === passportPromptVersion;

    if (isCached) {
      input.onProgress({ phase: "decision_complete", message: "Decision complete." });
      return { passport: await loadCompletedPassport(input.user, target.passportId), cached: true };
    }

    await markAnalysisRunning(target, input.user.id);
    await refreshPersistedGitHubSource({ target, user: input.user, source });

    input.onProgress({ phase: "analyzing_guarantees", message: "Analyzing guarantees..." });
    const analysis = await aiProvider.provider.analyzePullRequest(analysisInput);
    input.onProgress({ phase: "searching_contradictions", message: "Searching contradictions..." });
    input.onProgress({ phase: "generating_repair", message: "Generating repair..." });
    await persistAnalysis({
      target,
      user: input.user,
      analysisInput,
      analysisHash,
      analysisModel: aiProvider.model,
      source,
      analysis,
    });

    logInfo("Change Passport AI analysis completed", {
      requestId: input.requestId,
      passportId: target.passportId,
      aiStage: "decision_complete",
    });
    input.onProgress({ phase: "decision_complete", message: "Decision complete." });
    return { passport: await loadCompletedPassport(input.user, target.passportId), cached: false };
  } catch (error) {
    if (target) {
      await markAnalysisFailed(target, input.user.id, error);
    }
    logError("Change Passport AI analysis failed", {
      requestId: input.requestId,
      passportId: target?.passportId,
      aiStage: "analysis_failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorCode: error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined,
    });
    throw error;
  }
}
