import type { PassportReviewRequest, PassportReviewResponse } from "@/server/ai/review/contracts";
import type { AIProviderName } from "@/server/ai/provider";

/** A separate, additive capability keeps the established analysis provider unchanged. */
export interface PassportReviewProvider {
  generateReview(request: PassportReviewRequest): Promise<PassportReviewResponse>;
}

export type SelectedPassportReviewProvider = {
  name: AIProviderName;
  model: string;
  provider: PassportReviewProvider;
};
