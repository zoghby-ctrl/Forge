import { z } from "zod";
import { forgeVerdictSchema } from "@/domain/forge-workspace";

const sourceKindSchema = z.enum(["pull_request", "changed_file", "diff", "commit"]);

export const passportCitationSchema = z.object({
  sourceKind: sourceKindSchema,
  path: z.string().min(1).max(600).nullable(),
  lineStart: z.number().int().positive().nullable(),
  lineEnd: z.number().int().positive().nullable(),
  commitSha: z.string().min(7).max(64).nullable(),
  note: z.string().min(1).max(800),
});

const groundedClaimSchema = z.object({
  statement: z.string().min(1).max(1_600),
  rationale: z.string().min(1).max(2_400),
  citations: z.array(passportCitationSchema).min(1).max(4),
});

export const passportAnalysisSchema = z.object({
  summary: z.string().min(1).max(4_000),
  intent: groundedClaimSchema,
  guarantees: z.array(groundedClaimSchema).max(6),
  evidence: z.array(groundedClaimSchema).max(8),
  contradictions: z.array(groundedClaimSchema).max(6),
  blastRadius: z.array(groundedClaimSchema).max(6),
  repairPlan: z.array(groundedClaimSchema).min(1).max(6),
  verdict: forgeVerdictSchema,
  confidence: z.object({
    score: z.number().int().min(0).max(100),
    rationale: z.string().min(1).max(1_000),
  }),
});

export type PassportCitation = z.infer<typeof passportCitationSchema>;
export type PassportGroundedClaim = z.infer<typeof groundedClaimSchema>;
export type PassportAnalysis = z.infer<typeof passportAnalysisSchema>;
