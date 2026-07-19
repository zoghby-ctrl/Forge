import type { ForgeReviewMessage } from "@/domain/passport-review";
import type { PassportAnalysisInput, PassportAnalysisResult } from "@/server/openai/contracts";
import type { ReviewChatResponse, ReviewInsightsResponse } from "@/server/ai/review/schema";

export type PassportReviewChatRequest = {
  kind: "chat";
  source: PassportAnalysisInput;
  analysis: PassportAnalysisResult;
  history: ForgeReviewMessage[];
  question: string;
};

export type PassportReviewInsightsRequest = {
  kind: "insights";
  source: PassportAnalysisInput;
  analysis: PassportAnalysisResult;
};

export type PassportReviewRequest = PassportReviewChatRequest | PassportReviewInsightsRequest;

export type PassportReviewResponse =
  | { kind: "chat"; result: ReviewChatResponse }
  | { kind: "insights"; result: ReviewInsightsResponse };
