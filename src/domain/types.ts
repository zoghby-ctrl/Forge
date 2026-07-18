export type Verdict = "ship" | "ship_with_conditions" | "hold" | "insufficient_evidence";
export type GuaranteeStatus = "proposed" | "confirmed" | "revised" | "retired";

export interface SourceCitation {
  path: string;
  commitSha: string;
  lineStart: number;
  lineEnd: number;
  excerpt?: string;
}

export interface SystemGuarantee {
  id: string;
  statement: string;
  status: GuaranteeStatus;
  evidence: SourceCitation[];
}

export interface ChangePassport {
  id: string;
  projectId: string;
  changeId: string;
  verdict: Verdict;
  summary: string;
  conditions: string[];
  evidence: SourceCitation[];
  publishedAt: Date | null;
}
