import { z } from "zod";

export const forgeVerdictSchema = z.enum([
  "ship",
  "ship_with_conditions",
  "hold",
  "insufficient_evidence",
]);

export const forgeEvidenceKindSchema = z.enum([
  "intent",
  "guarantee",
  "path",
  "contradiction",
  "repair",
]);

export const forgeEvidenceToneSchema = z.enum(["default", "alert", "repair"]);

export const forgePassportAnalysisStatusSchema = z.enum([
  "pending",
  "running",
  "complete",
  "failed",
]);

export const forgeIdSchema = z.string().uuid();

// Supabase serializes `timestamptz` columns with an explicit UTC offset
// (for example, `2026-07-17T19:44:31.228+00:00`). Workspace records are
// sourced from those columns, so accept both that representation and `Z`.
const forgeDatabaseTimestampSchema = z.string().datetime({ offset: true });

export const forgeProjectSchema = z.object({
  id: forgeIdSchema,
  name: z.string(),
  slug: z.string(),
  status: z.enum(["draft", "ready", "archived"]),
});

export const forgeGitHubConnectionSchema = z.object({
  status: z.enum(["connected", "disconnected", "expired", "not_configured"]),
  login: z.string().nullable(),
});

export const forgeRepositorySchema = z.object({
  id: forgeIdSchema,
  projectId: forgeIdSchema,
  fullName: z.string(),
  description: z.string().nullable(),
  branch: z.string(),
  language: z.string().nullable(),
  openPullRequests: z.number().int().nonnegative(),
  owner: z.string().nullable(),
  visibility: z.enum(["public", "private", "internal"]),
  lastActivityAt: forgeDatabaseTimestampSchema.nullable(),
  lastActivityLabel: z.string(),
  htmlUrl: z.url().nullable(),
});

export const forgePullRequestSchema = z.object({
  id: forgeIdSchema,
  repositoryId: forgeIdSchema,
  number: z.number().int().positive(),
  title: z.string(),
  author: z.string(),
  branch: z.string(),
  base: z.string(),
  head: z.string(),
  filesChanged: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  commitsCount: z.number().int().nonnegative(),
  createdAt: forgeDatabaseTimestampSchema.nullable(),
  mergedAt: forgeDatabaseTimestampSchema.nullable(),
  htmlUrl: z.url().nullable(),
  status: z.enum(["needs_decision", "ready", "in_review", "closed"]),
  statusLabel: z.string(),
  updatedLabel: z.string(),
});

export const forgeGuaranteeSchema = z.object({
  id: forgeIdSchema,
  projectId: forgeIdSchema,
  statement: z.string(),
  detail: z.string(),
  status: z.enum(["proposed", "confirmed", "revised", "retired"]),
  confidence: z.string(),
});

export const forgeEvidenceSchema = z.object({
  id: forgeIdSchema,
  passportId: forgeIdSchema,
  guaranteeId: forgeIdSchema.nullable(),
  ordinal: z.number().int().positive(),
  kind: forgeEvidenceKindSchema,
  tone: forgeEvidenceToneSchema,
  label: z.string(),
  title: z.string(),
  detail: z.string(),
  source: z.string(),
  sourcePath: z.string().nullable(),
  commitSha: z.string().nullable(),
  sourceUrl: z.url().nullable(),
});

export const forgeDecisionSchema = z.object({
  id: forgeIdSchema,
  action: forgeVerdictSchema,
  recordedAt: forgeDatabaseTimestampSchema,
});

export const forgePassportSchema = z.object({
  id: forgeIdSchema,
  projectId: forgeIdSchema,
  repositoryId: forgeIdSchema,
  pullRequestId: forgeIdSchema,
  verdict: forgeVerdictSchema,
  summary: z.string(),
  condition: z.string(),
  confidence: z.string(),
  reviewState: z.string(),
  analysisStatus: forgePassportAnalysisStatusSchema,
  analysisError: z.string().nullable(),
  repairStaged: z.boolean(),
  evidence: z.array(forgeEvidenceSchema),
  decision: forgeDecisionSchema.nullable(),
});

export const forgeWorkspaceSchema = z.object({
  project: forgeProjectSchema,
  github: forgeGitHubConnectionSchema,
  repositories: z.array(forgeRepositorySchema),
  pullRequests: z.array(forgePullRequestSchema),
  guarantees: z.array(forgeGuaranteeSchema),
  passports: z.array(forgePassportSchema),
});

export type ForgeProject = z.infer<typeof forgeProjectSchema>;
export type ForgeGitHubConnection = z.infer<typeof forgeGitHubConnectionSchema>;
export type ForgeRepository = z.infer<typeof forgeRepositorySchema>;
export type ForgePullRequest = z.infer<typeof forgePullRequestSchema>;
export type ForgeGuarantee = z.infer<typeof forgeGuaranteeSchema>;
export type ForgeEvidence = z.infer<typeof forgeEvidenceSchema>;
export type ForgeDecision = z.infer<typeof forgeDecisionSchema>;
export type ForgePassportAnalysisStatus = z.infer<typeof forgePassportAnalysisStatusSchema>;
export type ForgePassport = z.infer<typeof forgePassportSchema>;
export type ForgeWorkspace = z.infer<typeof forgeWorkspaceSchema>;

export const stageRepairPathSchema = z.object({
  repairStaged: z.boolean(),
});

export const recordDecisionSchema = z.object({
  action: forgeVerdictSchema,
  idempotencyKey: z.string().uuid().optional(),
});

export type StageRepairPathInput = z.infer<typeof stageRepairPathSchema>;
export type RecordDecisionInput = z.infer<typeof recordDecisionSchema>;

export const workspaceStageSchema = z.enum([
  "landing",
  "oauth",
  "repositories",
  "scanning",
  "guarantees",
  "pull-requests",
  "passport",
]);

export type WorkspaceStage = z.infer<typeof workspaceStageSchema>;
