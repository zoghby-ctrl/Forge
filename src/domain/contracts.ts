import { z } from "zod";

export const sourceCitationSchema = z.object({
  path: z.string().min(1),
  commitSha: z.string().min(1),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  excerpt: z.string().optional(),
});

export const reviewClaimSchema = z.object({
  discipline: z.enum(["architecture", "reliability", "boundary"]),
  statement: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]),
  evidence: z.array(sourceCitationSchema).min(1),
});

export const passportSchema = z.object({
  verdict: z.enum(["ship", "ship_with_conditions", "hold", "insufficient_evidence"]),
  summary: z.string().min(1),
  conditions: z.array(z.string()),
  evidence: z.array(sourceCitationSchema),
});

export type ReviewClaim = z.infer<typeof reviewClaimSchema>;
export type PassportOutput = z.infer<typeof passportSchema>;
