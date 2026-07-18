import "server-only";

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { ZodError } from "zod";
import { AIAnalysisError, AppError } from "@/server/api/errors";
import { getForgeGroqClient, forgeGroqModel } from "@/server/ai/groq-client";
import type { AIProvider } from "@/server/ai/provider";
import { logError } from "@/server/observability/logger";
import type { PassportAnalysisInput, PassportAnalysisResult } from "@/server/openai/contracts";
import {
  passportAnalysisInstructions,
  serializePassportAnalysisInput,
} from "@/server/openai/prompts";
import { passportAnalysisSchema, type PassportCitation } from "@/server/openai/schema";

type GroqCompatibleClient = Pick<OpenAI, "responses">;
const maxGroqAttempts = 2;
const groqRetryDelayMs = 250;

const groqPassportAnalysisInstructions = `${passportAnalysisInstructions}

Strict Groq output contract:
- Return exactly one JSON object as the complete response value.
- The top-level value must be an object beginning with { and ending with }.
- Never return an array, including an array containing one Passport object.
- Never wrap the Passport in a property such as "result", "passport", or "data".
- Return no Markdown fences, commentary, or additional top-level properties.
- Populate exactly the top-level fields represented by the Forge Passport schema: summary, intent, guarantees, evidence, contradictions, blastRadius, repairPlan, verdict, and confidence.`;

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

function logGroqError(error: unknown, attempt: number) {
  const providerError = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const responseBody = providerError.error ?? providerError.body ?? null;

  logError("Groq Responses API request failed", {
    integration: "groq",
    aiAttempt: attempt,
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorCode: stringProperty(providerError, "code") ?? undefined,
    groqHttpStatus: numberProperty(providerError, "status"),
    groqRequestId: stringProperty(providerError, "requestID") ?? stringProperty(providerError, "requestId"),
    groqErrorType: stringProperty(providerError, "type"),
    groqErrorCode: stringProperty(providerError, "code"),
    groqErrorMessage: error instanceof Error ? error.message : String(error),
    groqResponseBody: responseBody,
  });
}

function getNumericStatus(error: unknown) {
  if (!error || typeof error !== "object") {
    return null;
  }

  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function getStringCode(error: unknown) {
  if (!error || typeof error !== "object") {
    return null;
  }

  const providerError = error as { code?: unknown; error?: unknown };
  if (typeof providerError.code === "string") {
    return providerError.code;
  }

  if (providerError.error && typeof providerError.error === "object") {
    const nestedCode = (providerError.error as { code?: unknown }).code;
    return typeof nestedCode === "string" ? nestedCode : null;
  }

  return null;
}

function getGroqErrorText(error: unknown) {
  if (!error || typeof error !== "object") {
    return error instanceof Error ? error.message : String(error);
  }

  const providerError = error as { message?: unknown; error?: unknown; body?: unknown };
  return JSON.stringify({
    message: providerError.message,
    error: providerError.error,
    body: providerError.body,
  });
}

function isRetryableGroqError(error: unknown) {
  if (error instanceof AIAnalysisError || error instanceof ZodError || error instanceof SyntaxError) {
    return true;
  }

  const status = getNumericStatus(error);
  const code = getStringCode(error);
  const errorText = getGroqErrorText(error);
  if (code === "insufficient_quota" || /insufficient[_ ]quota|billing quota|credits exhausted|no balance/i.test(errorText)) {
    return false;
  }

  if (
    status === 408
    || status === 409
    || status === 422
    || status === 429
    || status === 498
    || (status !== null && status >= 500)
  ) {
    return true;
  }

  if (status === 400 && /generated json|failed_generation|structured output|schema mismatch|invalid json/i.test(errorText)) {
    return true;
  }

  if (code && [
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ENETUNREACH",
    "EAI_AGAIN",
    "rate_limit_exceeded",
    "server_error",
    "internal_server_error",
    "temporarily_unavailable",
    "timeout",
  ].includes(code)) {
    return true;
  }

  return error instanceof Error && /timed out|timeout|temporar|network|connection reset/i.test(error.message);
}

function waitForGroqRetry() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, groqRetryDelayMs);
  });
}

export class GroqProvider implements AIProvider {
  constructor(private readonly getClient: () => GroqCompatibleClient = getForgeGroqClient) {}

  async analyzePullRequest(input: PassportAnalysisInput): Promise<PassportAnalysisResult> {
    for (let attempt = 1; attempt <= maxGroqAttempts; attempt += 1) {
      try {
        const response = await this.getClient().responses.parse({
          model: forgeGroqModel,
          // Groq's compatible Responses API does not support the OpenAI `store` field.
          reasoning: { effort: "medium" },
          input: [
            { role: "developer", content: groqPassportAnalysisInstructions },
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
        if (attempt < maxGroqAttempts && isRetryableGroqError(error)) {
          if (!(error instanceof AppError)) {
            logGroqError(error, attempt);
          }
          await waitForGroqRetry();
          continue;
        }

        if (error instanceof AppError) {
          throw error;
        }
        logGroqError(error, attempt);
        throw new AIAnalysisError();
      }
    }

    throw new AIAnalysisError();
  }
}
