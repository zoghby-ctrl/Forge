import { describe, expect, it } from "vitest";
import { GitHubRestClient } from "../../src/integrations/github/client";
import { getGitHubRepository, listGitHubRepositories } from "../../src/integrations/github/repositories";
import { readGitHubRepositoryHistory } from "../../src/server/github/ingestion";
import { readGitHubPullRequestAnalysisContext } from "../../src/integrations/github/pullRequests";
import { createGitHubSourcePassport } from "../../src/server/github/passport";
import { createMockGitHubFetch } from "../fixtures/github/mock-github";

describe("mocked GitHub repository selection flow", () => {
  it("revalidates the selected repository and builds a real-source Passport", async () => {
    const client = new GitHubRestClient("never-returned-to-browser", "https://github.test", createMockGitHubFetch());
    const picker = await listGitHubRepositories(client);
    const picked = picker.find((repository) => repository.id === "410001");

    expect(picked).toBeDefined();
    const repository = await getGitHubRepository(client, picked!.owner, picked!.name);
    const history = await readGitHubRepositoryHistory(client, repository);

    expect(history).toHaveLength(1);
    expect(history[0]?.source).toMatchObject({
      number: 42,
      changedFiles: 2,
      additions: 28,
      deletions: 4,
      commitsCount: 2,
    });

    const passport = createGitHubSourcePassport({
      repositoryFullName: repository.fullName,
      pullRequest: history[0]!.source,
      files: history[0]!.files,
      commits: history[0]!.commits,
    });

    expect(passport.evidence.map((entry) => entry.sourceUrl)).toEqual(expect.arrayContaining([
      "https://github.com/acme/forge-api/pull/42",
      "https://github.com/acme/forge-api/blob/2222222222222222222222222222222222222222/src/auth/callback.ts",
    ]));
  });

  it("loads the selected pull request's description, changed-file patches, commits, and unified diff", async () => {
    const client = new GitHubRestClient("never-returned-to-browser", "https://github.test", createMockGitHubFetch());
    const context = await readGitHubPullRequestAnalysisContext(client, "acme", "forge-api", 42);

    expect(context.pullRequest.description).toContain("OAuth state");
    expect(context.files[0]?.patch).toContain("returnedState");
    expect(context.commits).toHaveLength(2);
    expect(context.diff).toContain("diff --git a/src/auth/callback.ts");
  });
});
