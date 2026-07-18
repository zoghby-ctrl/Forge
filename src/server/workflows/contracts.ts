export type ReviewStage = "queued" | "reading_change" | "checking_guarantees" | "verifying_evidence" | "preparing_decision" | "complete" | "failed";

export interface ReviewRun {
  id: string;
  projectId: string;
  changeId: string;
  stage: ReviewStage;
}
