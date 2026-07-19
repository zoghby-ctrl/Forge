import "server-only";

import {
  createEmptyPassportReview,
  forgePassportReviewSchema,
  type ForgePassportReview,
} from "@/domain/passport-review";
import type { PassportAnalysisResult } from "@/server/openai/contracts";

export const passportExtensionsKey = "_forge";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Old Passport payloads have no extension namespace. Treat them as an empty
 * review state so the release is backward compatible with every existing row.
 */
export function getPassportReviewFromPayload(payload: unknown): ForgePassportReview {
  if (!isRecord(payload)) return createEmptyPassportReview();
  const parsed = forgePassportReviewSchema.safeParse(payload[passportExtensionsKey]);
  return parsed.success ? parsed.data : createEmptyPassportReview();
}

/** Preserve all current payload keys while updating the namespaced sidecar. */
export function withPassportReviewPayload(payload: unknown, review: ForgePassportReview) {
  const current = isRecord(payload) ? payload : {};
  return {
    ...current,
    [passportExtensionsKey]: forgePassportReviewSchema.parse(review),
  };
}

/** Attach the retained sidecar to a newly generated top-level Passport result. */
export function withAnalysisReviewPayload(analysis: PassportAnalysisResult, existingPayload: unknown) {
  return withPassportReviewPayload(analysis, getPassportReviewFromPayload(existingPayload));
}

/** Retain only durable review state when a source sync invalidates the analysis. */
export function preserveReviewPayloadOnSourceRefresh(payload: unknown) {
  const review = getPassportReviewFromPayload(payload);
  return review.messages.length > 0 || review.insights !== null
    ? { [passportExtensionsKey]: review }
    : null;
}
