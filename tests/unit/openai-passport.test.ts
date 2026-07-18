import { describe, expect, it } from "vitest";
import { GitHubRestClient } from "../../src/integrations/github/client";
import { readGitHubPullRequestAnalysisContext } from "../../src/integrations/github/pullRequests";
import {
  createPassportAnalysisInput,
  getPassportAnalysisInputHash,
} from "../../src/server/openai/passport";
import { passportAnalysisSchema } from "../../src/server/openai/schema";
import { createMockGitHubFetch } from "../fixtures/github/mock-github";

describe("OpenAI Change Passport contract", () => {
  it("builds a stable, source-complete input from GitHub and fingerprints it for cache invalidation", async () => {
    const client = new GitHubRestClient("never-returned-to-browser", "https://github.test", createMockGitHubFetch());
    const source = await readGitHubPullRequestAnalysisContext(client, "acme", "forge-api", 42);
    const input = createPassportAnalysisInput({ repositoryFullName: "acme/forge-api", source });

    expect(input.pullRequest.description).toContain("OAuth state");
    expect(input.files[0]?.patch).toContain("returnedState");
    expect(input.commits).toHaveLength(2);
    expect(input.diff).toContain("diff --git a/src/auth/callback.ts");
    expect(getPassportAnalysisInputHash(input)).toBe(getPassportAnalysisInputHash(input));
    expect(getPassportAnalysisInputHash({ ...input, pullRequest: { ...input.pullRequest, title: "Changed title" } }))
      .not.toBe(getPassportAnalysisInputHash(input));
  });

  it("requires the complete strongly typed Change Passport shape", () => {
    const source = {
      sourceKind: "changed_file" as const,
      path: "src/auth/callback.ts",
      lineStart: 12,
      lineEnd: 15,
      commitSha: "2222222222222222222222222222222222222222",
      note: "Rejects a mismatched returned state.",
    };
    const claim = {
      statement: "Callback state mismatch is rejected.",
      rationale: "The diff returns a 400 response when states differ.",
      citations: [source],
    };

    expect(passportAnalysisSchema.parse({
      summary: "The pull request adds callback-state validation and a focused test.",
      intent: claim,
      guarantees: [claim],
      evidence: [claim],
      contradictions: [],
      blastRadius: [claim],
      repairPlan: [claim],
      verdict: "ship_with_conditions",
      confidence: { score: 86, rationale: "The diff and test directly support the change." },
    })).toMatchObject({
      verdict: "ship_with_conditions",
      confidence: { score: 86 },
    });
  });
});
