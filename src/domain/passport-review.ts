import { z } from "zod";

/**
 * Public, persisted representation of source citations used by the Passport
 * review tools. The AI never supplies `sourceUrl`; Forge resolves it from the
 * verified GitHub source after validating the model citation.
 */
export const forgeReviewCitationSchema = z.object({
  sourceKind: z.enum(["pull_request", "changed_file", "diff", "commit"]),
  path: z.string().min(1).max(600).nullable(),
  lineStart: z.number().int().positive().nullable(),
  lineEnd: z.number().int().positive().nullable(),
  commitSha: z.string().min(7).max(64).nullable(),
  note: z.string().min(1).max(800),
  sourceUrl: z.url().nullable(),
});

export const forgeReviewClaimSchema = z.object({
  statement: z.string().min(1).max(1_600),
  rationale: z.string().min(1).max(2_400),
  citations: z.array(forgeReviewCitationSchema).min(1).max(4),
});

export const forgeRiskPostureSchema = z.enum([
  "not_observed",
  "low",
  "medium",
  "high",
  "insufficient_evidence",
]);

export const forgeRiskCategorySchema = z.enum([
  "security",
  "performance",
  "breaking_changes",
  "missing_tests",
  "documentation",
]);

export const forgeRiskFindingSchema = z.object({
  category: forgeRiskCategorySchema,
  posture: forgeRiskPostureSchema,
  finding: forgeReviewClaimSchema,
});

export const forgeRepairSuggestionSchema = z.object({
  id: z.string().uuid(),
  priority: z.enum(["low", "medium", "high"]),
  title: z.string().min(1).max(240),
  targetPaths: z.array(z.string().min(1).max(600)).max(6),
  action: forgeReviewClaimSchema,
  verification: forgeReviewClaimSchema,
});

export const forgeReviewInsightsSchema = z.object({
  sourceHeadSha: z.string().min(7).max(64),
  provider: z.enum(["openai", "groq"]),
  model: z.string().min(1).max(200),
  promptVersion: z.string().min(1).max(200),
  generatedAt: z.string().datetime({ offset: true }),
  risks: z.object({
    security: forgeRiskFindingSchema,
    performance: forgeRiskFindingSchema,
    breakingChanges: forgeRiskFindingSchema,
    missingTests: forgeRiskFindingSchema,
    documentation: forgeRiskFindingSchema,
  }),
  repairs: z.array(forgeRepairSuggestionSchema).max(6),
});

export const forgeReviewUserMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.literal("user"),
  content: z.string().min(1).max(4_000),
  createdAt: z.string().datetime({ offset: true }),
});

export const forgeReviewAssistantMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.literal("assistant"),
  sourceHeadSha: z.string().min(7).max(64),
  answer: forgeReviewClaimSchema,
  createdAt: z.string().datetime({ offset: true }),
});

export const forgeReviewMessageSchema = z.discriminatedUnion("role", [
  forgeReviewUserMessageSchema,
  forgeReviewAssistantMessageSchema,
]);

export const forgePassportReviewSchema = z.object({
  version: z.literal(1),
  messages: z.array(forgeReviewMessageSchema).max(24),
  insights: forgeReviewInsightsSchema.nullable(),
  updatedAt: z.string().datetime({ offset: true }).nullable(),
});

export const forgeReviewQuestionSchema = z.object({
  question: z.string().trim().min(1).max(4_000),
});

export type ForgeReviewCitation = z.infer<typeof forgeReviewCitationSchema>;
export type ForgeReviewClaim = z.infer<typeof forgeReviewClaimSchema>;
export type ForgeRiskFinding = z.infer<typeof forgeRiskFindingSchema>;
export type ForgeRepairSuggestion = z.infer<typeof forgeRepairSuggestionSchema>;
export type ForgeReviewInsights = z.infer<typeof forgeReviewInsightsSchema>;
export type ForgeReviewUserMessage = z.infer<typeof forgeReviewUserMessageSchema>;
export type ForgeReviewAssistantMessage = z.infer<typeof forgeReviewAssistantMessageSchema>;
export type ForgeReviewMessage = z.infer<typeof forgeReviewMessageSchema>;
export type ForgePassportReview = z.infer<typeof forgePassportReviewSchema>;

export function createEmptyPassportReview(): ForgePassportReview {
  return {
    version: 1,
    messages: [],
    insights: null,
    updatedAt: null,
  };
}
