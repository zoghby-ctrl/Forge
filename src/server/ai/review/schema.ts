import { z } from "zod";
import { passportCitationSchema } from "@/server/openai/schema";

const reviewGroundedClaimSchema = z.object({
  statement: z.string().min(1).max(1_600),
  rationale: z.string().min(1).max(2_400),
  citations: z.array(passportCitationSchema).min(1).max(4),
});

const reviewRiskPostureSchema = z.enum([
  "not_observed",
  "low",
  "medium",
  "high",
  "insufficient_evidence",
]);

const reviewRiskFindingSchema = z.object({
  posture: reviewRiskPostureSchema,
  finding: reviewGroundedClaimSchema,
});

const reviewRepairSuggestionSchema = z.object({
  priority: z.enum(["low", "medium", "high"]),
  title: z.string().min(1).max(240),
  targetPaths: z.array(z.string().min(1).max(600)).max(6),
  action: reviewGroundedClaimSchema,
  verification: reviewGroundedClaimSchema,
});

export const reviewChatResponseSchema = z.object({
  answer: reviewGroundedClaimSchema,
});

export const reviewInsightsResponseSchema = z.object({
  risks: z.object({
    security: reviewRiskFindingSchema,
    performance: reviewRiskFindingSchema,
    breakingChanges: reviewRiskFindingSchema,
    missingTests: reviewRiskFindingSchema,
    documentation: reviewRiskFindingSchema,
  }),
  repairs: z.array(reviewRepairSuggestionSchema).max(6),
});

export type ReviewGroundedClaim = z.infer<typeof reviewGroundedClaimSchema>;
export type ReviewChatResponse = z.infer<typeof reviewChatResponseSchema>;
export type ReviewInsightsResponse = z.infer<typeof reviewInsightsResponseSchema>;
