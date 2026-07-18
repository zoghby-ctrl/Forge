import { describe, expect, it } from "vitest";
import { GitHubRestClient } from "../../src/integrations/github/client";
import {
  listGitHubRepositories,
  mapGitHubRepository,
} from "../../src/integrations/github/repositories";
import { githubRepositoryResponse } from "../fixtures/github/github-responses";
import { createMockGitHubFetch } from "../fixtures/github/mock-github";

describe("GitHub repository mapping", () => {
  it("preserves owner, visibility, branch, language, and recent activity", () => {
    const mapped = mapGitHubRepository(githubRepositoryResponse);

    expect(mapped).toMatchObject({
      id: "410001",
      fullName: "acme/forge-api",
      owner: "acme",
      visibility: "private",
      defaultBranch: "main",
      language: "TypeScript",
      lastActivityAt: "2026-07-17T12:10:00Z",
    });
  });

  it("parses a real-shaped /user/repos response through the authenticated client", async () => {
    const client = new GitHubRestClient("server-only-token", "https://github.test", createMockGitHubFetch());
    const repositories = await listGitHubRepositories(client);

    expect(repositories).toHaveLength(1);
    expect(repositories[0]?.fullName).toBe("acme/forge-api");
  });

  it("retains the GitHub error response body for server-side logging", async () => {
    const client = new GitHubRestClient(
      "server-only-token",
      "https://github.test",
      async () => Response.json({ message: "Bad credentials", documentation_url: "https://docs.github.com/rest" }, { status: 401 }),
    );

    await expect(listGitHubRepositories(client)).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
      responseBody: JSON.stringify({ message: "Bad credentials", documentation_url: "https://docs.github.com/rest" }),
    });
  });
});
