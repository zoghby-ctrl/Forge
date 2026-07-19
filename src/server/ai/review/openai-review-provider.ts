import "server-only";

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { AIAnalysisError, AppError } from "@/server/api/errors";
import type { PassportReviewProvider } from "@/server/ai/review/provider";
import type { PassportReviewRequest, PassportReviewResponse } from "@/server/ai/review/contracts";
import { assertGroundedReviewResponse } from "@/server/ai/review/grounding";
import { passportReviewInstructions, serializePassportReviewRequest } from "@/server/ai/review/prompts";
import { reviewChatResponseSchema, reviewInsightsResponseSchema } from "@/server/ai/review/schema";
import { forgeOpenAIModel, getForgeOpenAIClient } from "@/server/openai/client";
import { logError } from "@/server/observability/logger";

type OpenAIResponsesClient = Pick<OpenAI, "responses">;

function stringProperty(value: Record<string, unknown>, property: string) {
  const candidate = value[property];
  return typeof candidate === "string" ? candidate : null;
}

function numberProperty(value: Record<string, unknown>, property: string) {
  const candidate = value[property];
  return typeof candidate === "number" ? candidate : null;
}

function logOpenAIReviewError(error: unknown) {
  const providerError = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const responseBody = providerError.error ?? providerError.body ?? null;

  logError("OpenAI Passport review request failed", {
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

export class OpenAIPassportReviewProvider implements PassportReviewProvider {
  constructor(private readonly getClient: () => OpenAIResponsesClient = getForgeOpenAIClient) {}

  async generateReview(request: PassportReviewRequest): Promise<PassportReviewResponse> {
    try {
      if (request.kind === "chat") {
        const response = await this.getClient().responses.parse({
          model: forgeOpenAIModel,
          store: false,
          reasoning: { effort: "medium" },
          input: [
            { role: "developer", content: passportReviewInstructions("chat") },
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
        model: forgeOpenAIModel,
        store: false,
        reasoning: { effort: "medium" },
        input: [
          { role: "developer", content: passportReviewInstructions("insights") },
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
      if (error instanceof AppError) throw error;
      logOpenAIReviewError(error);
      throw new AIAnalysisError();
    }
  }
}
