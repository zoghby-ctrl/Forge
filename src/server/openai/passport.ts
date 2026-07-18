import "server-only";

import { createHash } from "node:crypto";
import { zodTextFormat } from "openai/helpers/zod";
import type {
  GitHubPullRequestAnalysisContext,
} from "@/integrations/github/pullRequests";
import { AIAnalysisError, AppError } from "@/server/api/errors";
import { logError } from "@/server/observability/logger";
import { forgeOpenAIModel, getForgeOpenAIClient } from "@/server/openai/client";
import type { PassportAnalysisInput, PassportAnalysisResult } from "@/server/openai/contracts";
import {
  passportAnalysisInstructions,
  passportPromptVersion,
  serializePassportAnalysisInput,
} from "@/server/openai/prompts";
import { passportAnalysisSchema, type PassportCitation } from "@/server/openai/schema";

const maxDiffCharacters = 180_000;
const maxPatchCharacters = 24_000;

function truncate(value: string, maximum: number) {
  if (value.length <= maximum) {
    return { value, truncated: false };
  }

  return {
    value: `${value.slice(0, maximum)}\n\n[Forge truncated this source for the model input.]`,
    truncated: true,
  };
}

export function createPassportAnalysisInput(input: {
  repositoryFullName: string;
  source: GitHubPullRequestAnalysisContext;
}): PassportAnalysisInput {
  const diff = truncate(input.source.diff, maxDiffCharacters);

  return {
    repositoryFullName: input.repositoryFullName,
    pullRequest: {
      number: input.source.pullRequest.number,
      title: input.source.pullRequest.title,
      description: input.source.pullRequest.description,
      author: input.source.pullRequest.authorDisplayName,
      baseRef: input.source.pullRequest.baseRef,
      headRef: input.source.pullRequest.headRef,
      baseSha: input.source.pullRequest.baseSha,
      headSha: input.source.pullRequest.headSha,
      htmlUrl: input.source.pullRequest.htmlUrl,
    },
    files: input.source.files.map((file) => ({
      sha: file.sha,
      path: file.path,
      previousPath: file.previousPath,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch ? truncate(file.patch, maxPatchCharacters).value : null,
      htmlUrl: file.htmlUrl,
    })),
    commits: input.source.commits.map((commit) => ({
      sha: commit.sha,
      subject: commit.subject,
      author: commit.authorName ?? commit.authorLogin,
      authoredAt: commit.authoredAt,
      committedAt: commit.committedAt,
      htmlUrl: commit.htmlUrl,
    })),
    diff: diff.value,
    diffTruncated: diff.truncated,
  };
}

export function getPassportAnalysisInputHash(input: PassportAnalysisInput) {
  return createHash("sha256")
    .update(forgeOpenAIModel)
    .update("\n")
    .update(passportPromptVersion)
    .update("\n")
    .update(serializePassportAnalysisInput(input))
    .digest("hex");
}

function assertGroundedCitation(citation: PassportCitation, input: PassportAnalysisInput) {
  const knownPaths = new Set(input.files.map((file) => file.path));
  const knownShas = new Set([
    input.pullRequest.headSha,
    input.pullRequest.baseSha,
    ...input.commits.map((commit) => commit.sha),
  ]);

  if (citation.path && !knownPaths.has(citation.path)) {
    throw new AIAnalysisError();
  }
  if (citation.commitSha && !knownShas.has(citation.commitSha)) {
    throw new AIAnalysisError();
  }
  if (citation.lineStart && citation.lineEnd && citation.lineEnd < citation.lineStart) {
    throw new AIAnalysisError();
  }
  if ((citation.sourceKind === "changed_file" || citation.sourceKind === "diff") && !citation.path) {
    throw new AIAnalysisError();
  }
  if (citation.sourceKind === "commit" && !citation.commitSha) {
    throw new AIAnalysisError();
  }
}

function assertGroundedOutput(output: PassportAnalysisResult, input: PassportAnalysisInput) {
  const claims = [
    output.intent,
    ...output.guarantees,
    ...output.evidence,
    ...output.contradictions,
    ...output.blastRadius,
    ...output.repairPlan,
  ];

  for (const claim of claims) {
    for (const citation of claim.citations) {
      assertGroundedCitation(citation, input);
    }
  }
}

function stringProperty(value: Record<string, unknown>, property: string) {
  const candidate = value[property];
  return typeof candidate === "string" ? candidate : null;
}

function numberProperty(value: Record<string, unknown>, property: string) {
  const candidate = value[property];
  return typeof candidate === "number" ? candidate : null;
}

function logOpenAIError(error: unknown) {
  const providerError = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const responseBody = providerError.error ?? providerError.body ?? null;

  logError("OpenAI Responses API request failed", {
    integration: "openai",
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorCode: stringProperty(providerError, "code") ?? undefined,
    openaiHttpStatus: numberProperty(providerError, "status"),
    openaiRequestId: stringProperty(providerError, "requestID") ?? stringProperty(providerError, "requestId"),
    openaiErrorType: stringProperty(providerError, "type"),
    openaiErrorCode: stringProperty(providerError, "code"),
    openaiErrorMessage: error instanceof Error ? error.message : String(error),
    openaiResponseBody: responseBody,
  });
}

export async function analyzePullRequest(input: PassportAnalysisInput): Promise<PassportAnalysisResult> {
  try {
    const response = await getForgeOpenAIClient().responses.parse({
      model: forgeOpenAIModel,
      store: false,
      reasoning: { effort: "medium" },
      input: [
        { role: "developer", content: passportAnalysisInstructions },
        { role: "user", content: serializePassportAnalysisInput(input) },
      ],
      text: {
        format: zodTextFormat(passportAnalysisSchema, "forge_change_passport"),
      },
    });

    if (!response.output_parsed) {
      throw new AIAnalysisError();
    }

    const output = passportAnalysisSchema.parse(response.output_parsed);
    assertGroundedOutput(output, input);
    return output;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    logOpenAIError(error);
    throw new AIAnalysisError();
  }
}
