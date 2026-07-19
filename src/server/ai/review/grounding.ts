import type { PassportAnalysisInput } from "@/server/openai/contracts";
import type { PassportCitation } from "@/server/openai/schema";
import { AIAnalysisError } from "@/server/api/errors";
import type { PassportReviewResponse } from "@/server/ai/review/contracts";
import type { ReviewGroundedClaim } from "@/server/ai/review/schema";

function assertCitation(citation: PassportCitation, input: PassportAnalysisInput) {
  const knownPaths = new Set(input.files.map((file) => file.path));
  const knownShas = new Set([
    input.pullRequest.headSha,
    input.pullRequest.baseSha,
    ...input.commits.map((commit) => commit.sha),
  ]);

  if (citation.path && !knownPaths.has(citation.path)) {
    throw new AIAnalysisError();
  }
  if (citation.commitSha && !knownShas.has(citation.commitSha)) {
    throw new AIAnalysisError();
  }
  if (citation.lineStart && citation.lineEnd && citation.lineEnd < citation.lineStart) {
    throw new AIAnalysisError();
  }
  if ((citation.sourceKind === "changed_file" || citation.sourceKind === "diff") && !citation.path) {
    throw new AIAnalysisError();
  }
  if (citation.sourceKind === "commit" && !citation.commitSha) {
    throw new AIAnalysisError();
  }
}

function assertClaim(claim: ReviewGroundedClaim, input: PassportAnalysisInput) {
  for (const citation of claim.citations) {
    assertCitation(citation, input);
  }
}

export function assertGroundedReviewResponse(response: PassportReviewResponse, input: PassportAnalysisInput) {
  if (response.kind === "chat") {
    assertClaim(response.result.answer, input);
    return;
  }

  const risks = response.result.risks;
  assertClaim(risks.security.finding, input);
  assertClaim(risks.performance.finding, input);
  assertClaim(risks.breakingChanges.finding, input);
  assertClaim(risks.missingTests.finding, input);
  assertClaim(risks.documentation.finding, input);

  for (const repair of response.result.repairs) {
    for (const path of repair.targetPaths) {
      if (!input.files.some((file) => file.path === path)) {
        throw new AIAnalysisError();
      }
    }
    assertClaim(repair.action, input);
    assertClaim(repair.verification, input);
  }
}
