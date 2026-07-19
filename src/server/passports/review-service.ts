import "server-only";

import {
  createEmptyPassportReview,
  forgePassportReviewSchema,
  forgeReviewInsightsSchema,
  type ForgePassportReview,
  type ForgeReviewClaim,
  type ForgeReviewInsights,
  type ForgeReviewMessage,
} from "@/domain/passport-review";
import { getSelectedPassportReviewProvider } from "@/server/ai/review/registry";
import { passportReviewPromptVersion } from "@/server/ai/review/prompts";
import { DataAccessError, ValidationError } from "@/server/api/errors";
import type { ForgeUser } from "@/server/auth/session";
import { createGitHubAdminSupabaseClient } from "@/lib/supabase/github-admin";
import { logError, logInfo } from "@/server/observability/logger";
import {
  getPassportReviewFromPayload,
  withPassportReviewPayload,
} from "@/server/passports/passport-extensions";
import {
  getCitationSourceUrl,
  loadPassportSourceForUser,
  requireCompletedPassportAnalysis,
  type PassportSourceContext,
} from "@/server/passports/passport-source-service";
import type { PassportCitation } from "@/server/openai/schema";
import type { ReviewGroundedClaim, ReviewInsightsResponse } from "@/server/ai/review/schema";

export type PassportReviewProgress = {
  phase: "preparing_evidence" | "reasoning" | "validating_citations" | "saving" | "complete";
  message: string;
};

type ReviewPayloadRow = {
  analysis_status: "pending" | "running" | "complete" | "failed";
  analysis_source_head_sha: string | null;
  analysis_payload: unknown;
  updated_at: string;
};

const maxWriteAttempts = 3;
const maxReviewMessages = 24;

function throwForDataError(operation: string, error: { code?: string; message?: string } | null) {
  if (error) throw new DataAccessError(operation);
}

function resolveCitation(citation: PassportCitation, source: PassportSourceContext["input"]) {
  return {
    ...citation,
    sourceUrl: getCitationSourceUrl(citation, source),
  };
}

function resolveClaim(claim: ReviewGroundedClaim, source: PassportSourceContext["input"]): ForgeReviewClaim {
  return {
    statement: claim.statement,
    rationale: claim.rationale,
    citations: claim.citations.map((citation) => resolveCitation(citation, source)),
  };
}

function resolveInsights(result: ReviewInsightsResponse, source: PassportSourceContext, input: {
  name: "openai" | "groq";
  model: string;
}): ForgeReviewInsights {
  const mapRisk = (
    category: "security" | "performance" | "breaking_changes" | "missing_tests" | "documentation",
    risk: ReviewInsightsResponse["risks"][keyof ReviewInsightsResponse["risks"]],
  ) => ({
    category,
    posture: risk.posture,
    finding: resolveClaim(risk.finding, source.input),
  });

  return forgeReviewInsightsSchema.parse({
    sourceHeadSha: source.input.pullRequest.headSha,
    provider: input.name,
    model: input.model,
    promptVersion: passportReviewPromptVersion,
    generatedAt: new Date().toISOString(),
    risks: {
      security: mapRisk("security", result.risks.security),
      performance: mapRisk("performance", result.risks.performance),
      breakingChanges: mapRisk("breaking_changes", result.risks.breakingChanges),
      missingTests: mapRisk("missing_tests", result.risks.missingTests),
      documentation: mapRisk("documentation", result.risks.documentation),
    },
    repairs: result.repairs.map((repair) => ({
      id: crypto.randomUUID(),
      priority: repair.priority,
      title: repair.title,
      targetPaths: repair.targetPaths,
      action: resolveClaim(repair.action, source.input),
      verification: resolveClaim(repair.verification, source.input),
    })),
  });
}

function capMessages(messages: ForgeReviewMessage[]) {
  return messages.slice(-maxReviewMessages);
}

function assertSameSource(row: ReviewPayloadRow, source: PassportSourceContext) {
  if (row.analysis_status !== "complete" || row.analysis_source_head_sha !== source.input.pullRequest.headSha) {
    throw new ValidationError("This Change Passport changed while Forge was preparing the response. Please retry.");
  }
}

/**
 * Writes only from the server-role client, but only after the caller's RLS
 * read has established ownership. `updated_at` makes concurrent tabs retry
 * instead of silently dropping a chat turn or cached review.
 */
async function updateReviewState(input: {
  user: ForgeUser;
  source: PassportSourceContext;
  update: (current: ForgePassportReview) => ForgePassportReview;
}) {
  const admin = createGitHubAdminSupabaseClient();
  for (let attempt = 0; attempt < maxWriteAttempts; attempt += 1) {
    const { data: payloadData, error: payloadError } = await admin
      .from("change_passports")
      .select("analysis_status, analysis_source_head_sha, analysis_payload, updated_at")
      .eq("id", input.source.passport.id)
      .eq("project_id", input.source.passport.project_id)
      .maybeSingle();
    throwForDataError("load this Change Passport review", payloadError);
    if (!payloadData) throw new DataAccessError("load this Change Passport review");
    const currentPayload = payloadData as ReviewPayloadRow;
    assertSameSource(currentPayload, input.source);

    const next = forgePassportReviewSchema.parse({
      ...input.update(getPassportReviewFromPayload(currentPayload.analysis_payload)),
      updatedAt: new Date().toISOString(),
    });
    const { data: updated, error: updateError } = await admin
      .from("change_passports")
      .update({
        analysis_payload: withPassportReviewPayload(currentPayload.analysis_payload, next),
        updated_by: input.user.id,
      })
      .eq("id", input.source.passport.id)
      .eq("project_id", input.source.passport.project_id)
      .eq("updated_at", currentPayload.updated_at)
      .select("analysis_payload")
      .maybeSingle();
    throwForDataError("save this Change Passport review", updateError);
    if (updated) return getPassportReviewFromPayload((updated as { analysis_payload: unknown }).analysis_payload);
  }
  throw new DataAccessError("save this Change Passport review");
}

function checkInsightsCache(review: ForgePassportReview, source: PassportSourceContext, provider: { name: "openai" | "groq"; model: string }) {
  const insights = review.insights;
  return insights !== null
    && insights.sourceHeadSha === source.input.pullRequest.headSha
    && insights.provider === provider.name
    && insights.model === provider.model
    && insights.promptVersion === passportReviewPromptVersion;
}

export async function askPassportReviewForUser(input: {
  user: ForgeUser;
  passportId: string;
  question: string;
  requestId: string;
  onProgress: (progress: PassportReviewProgress) => void;
}): Promise<{ review: ForgePassportReview }> {
  try {
    input.onProgress({ phase: "preparing_evidence", message: "Preparing verified evidence..." });
    const source = await loadPassportSourceForUser(input.user, input.passportId);
    const analysis = requireCompletedPassportAnalysis(source);
    const provider = getSelectedPassportReviewProvider();
    const currentReview = getPassportReviewFromPayload(source.passport.analysis_payload);

    input.onProgress({ phase: "reasoning", message: "Reasoning from cited repository evidence..." });
    const response = await provider.provider.generateReview({
      kind: "chat",
      source: source.input,
      analysis,
      history: currentReview.messages,
      question: input.question,
    });
    if (response.kind !== "chat") throw new DataAccessError("prepare this AI review");

    input.onProgress({ phase: "validating_citations", message: "Validating every cited claim..." });
    const now = new Date().toISOString();
    const userMessage: ForgeReviewMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.question,
      createdAt: now,
    };
    const assistantMessage: ForgeReviewMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      sourceHeadSha: source.input.pullRequest.headSha,
      answer: resolveClaim(response.result.answer, source.input),
      createdAt: now,
    };

    input.onProgress({ phase: "saving", message: "Saving this cited review..." });
    const review = await updateReviewState({
      user: input.user,
      source,
      update: (current) => ({
        ...current,
        messages: capMessages([...current.messages, userMessage, assistantMessage]),
      }),
    });
    logInfo("Change Passport AI review completed", { requestId: input.requestId, passportId: input.passportId, aiStage: "review_complete" });
    input.onProgress({ phase: "complete", message: "Review complete." });
    return { review };
  } catch (error) {
    logError("Change Passport AI review failed", {
      requestId: input.requestId,
      passportId: input.passportId,
      aiStage: "review_failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorCode: error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined,
    });
    throw error;
  }
}

export async function generatePassportInsightsForUser(input: {
  user: ForgeUser;
  passportId: string;
  requestId: string;
  onProgress: (progress: PassportReviewProgress) => void;
}): Promise<{ review: ForgePassportReview; cached: boolean }> {
  try {
    input.onProgress({ phase: "preparing_evidence", message: "Preparing verified evidence..." });
    const source = await loadPassportSourceForUser(input.user, input.passportId);
    const analysis = requireCompletedPassportAnalysis(source);
    const provider = getSelectedPassportReviewProvider();
    const currentReview = getPassportReviewFromPayload(source.passport.analysis_payload);
    if (checkInsightsCache(currentReview, source, provider)) {
      input.onProgress({ phase: "complete", message: "Enhanced review is current." });
      return { review: currentReview, cached: true };
    }

    input.onProgress({ phase: "reasoning", message: "Analyzing risks and repair options..." });
    const response = await provider.provider.generateReview({ kind: "insights", source: source.input, analysis });
    if (response.kind !== "insights") throw new DataAccessError("prepare this enhanced review");

    input.onProgress({ phase: "validating_citations", message: "Validating every cited risk and repair..." });
    const insights = resolveInsights(response.result, source, provider);
    input.onProgress({ phase: "saving", message: "Saving the enhanced review..." });
    const review = await updateReviewState({
      user: input.user,
      source,
      update: (current) => ({ ...current, insights }),
    });
    logInfo("Change Passport enhanced review completed", { requestId: input.requestId, passportId: input.passportId, aiStage: "insights_complete" });
    input.onProgress({ phase: "complete", message: "Enhanced review complete." });
    return { review, cached: false };
  } catch (error) {
    logError("Change Passport enhanced review failed", {
      requestId: input.requestId,
      passportId: input.passportId,
      aiStage: "insights_failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorCode: error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined,
    });
    throw error;
  }
}

export function createInitialPassportReview() {
  return createEmptyPassportReview();
}
