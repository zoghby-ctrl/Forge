import "server-only";

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { ZodError } from "zod";
import { AIAnalysisError, AppError } from "@/server/api/errors";
import { forgeGroqModel, getForgeGroqClient } from "@/server/ai/groq-client";
import type { PassportReviewProvider } from "@/server/ai/review/provider";
import type { PassportReviewRequest, PassportReviewResponse } from "@/server/ai/review/contracts";
import { assertGroundedReviewResponse } from "@/server/ai/review/grounding";
import { passportReviewInstructions, serializePassportReviewRequest } from "@/server/ai/review/prompts";
import { reviewChatResponseSchema, reviewInsightsResponseSchema } from "@/server/ai/review/schema";
import { logError } from "@/server/observability/logger";

type GroqCompatibleClient = Pick<OpenAI, "responses">;
const maxGroqAttempts = 2;
const groqRetryDelayMs = 250;

function stringProperty(value: Record<string, unknown>, property: string) {
  const candidate = value[property];
  return typeof candidate === "string" ? candidate : null;
}

function numberProperty(value: Record<string, unknown>, property: string) {
  const candidate = value[property];
  return typeof candidate === "number" ? candidate : null;
}

function getNumericStatus(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function getStringCode(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const providerError = error as { code?: unknown; error?: unknown };
  if (typeof providerError.code === "string") return providerError.code;
  if (providerError.error && typeof providerError.error === "object") {
    const code = (providerError.error as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

function getGroqErrorText(error: unknown) {
  if (!error || typeof error !== "object") return error instanceof Error ? error.message : String(error);
  const providerError = error as { message?: unknown; error?: unknown; body?: unknown };
  return JSON.stringify({ message: providerError.message, error: providerError.error, body: providerError.body });
}

function isRetryableGroqError(error: unknown) {
  if (error instanceof AIAnalysisError || error instanceof ZodError || error instanceof SyntaxError) return true;

  const status = getNumericStatus(error);
  const code = getStringCode(error);
  const errorText = getGroqErrorText(error);
  if (code === "insufficient_quota" || /insufficient[_ ]quota|billing quota|credits exhausted|no balance/i.test(errorText)) {
    return false;
  }
  if (status === 408 || status === 409 || status === 422 || status === 429 || status === 498 || (status !== null && status >= 500)) {
    return true;
  }
  if (status === 400 && /generated json|failed_generation|structured output|schema mismatch|invalid json/i.test(errorText)) {
    return true;
  }
  if (code && [
    "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH", "EAI_AGAIN",
    "rate_limit_exceeded", "server_error", "internal_server_error", "temporarily_unavailable", "timeout",
  ].includes(code)) return true;

  return error instanceof Error && /timed out|timeout|temporar|network|connection reset/i.test(error.message);
}

function logGroqReviewError(error: unknown, attempt: number) {
  const providerError = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const responseBody = providerError.error ?? providerError.body ?? null;
  logError("Groq Passport review request failed", {
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

function waitForGroqRetry() {
  return new Promise<void>((resolve) => setTimeout(resolve, groqRetryDelayMs));
}

export class GroqPassportReviewProvider implements PassportReviewProvider {
  constructor(private readonly getClient: () => GroqCompatibleClient = getForgeGroqClient) {}

  async generateReview(request: PassportReviewRequest): Promise<PassportReviewResponse> {
    for (let attempt = 1; attempt <= maxGroqAttempts; attempt += 1) {
      try {
        if (request.kind === "chat") {
          const response = await this.getClient().responses.parse({
            model: forgeGroqModel,
            reasoning: { effort: "medium" },
            input: [
              { role: "developer", content: passportReviewInstructions("chat", true) },
              { role: "user", content: serializePassportReviewRequest(request) },
            ],
            text: { format: zodTextFormat(reviewChatResponseSchema, "forge_passport_review_chat") },
          });
          if (!response.output_parsed) throw new AIAnalysisError();
          const result = reviewChatResponseSchema.parse(response.output_parsed);
          const output: PassportReviewResponse = { kind: "chat", result };
          assertGroundedReviewResponse(output, request.source);
          return output;
        }

        const response = await this.getClient().responses.parse({
          model: forgeGroqModel,
          reasoning: { effort: "medium" },
          input: [
            { role: "developer", content: passportReviewInstructions("insights", true) },
            { role: "user", content: serializePassportReviewRequest(request) },
          ],
          text: { format: zodTextFormat(reviewInsightsResponseSchema, "forge_passport_review_insights") },
        });
        if (!response.output_parsed) throw new AIAnalysisError();
        const result = reviewInsightsResponseSchema.parse(response.output_parsed);
        const output: PassportReviewResponse = { kind: "insights", result };
        assertGroundedReviewResponse(output, request.source);
        return output;
      } catch (error) {
        if (attempt < maxGroqAttempts && isRetryableGroqError(error)) {
          if (!(error instanceof AppError)) logGroqReviewError(error, attempt);
          await waitForGroqRetry();
          continue;
        }
        if (error instanceof AppError) throw error;
        logGroqReviewError(error, attempt);
        throw new AIAnalysisError();
      }
    }
    throw new AIAnalysisError();
  }
}
