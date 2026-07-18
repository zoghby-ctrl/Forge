import type { GitHubRestClient } from "@/integrations/github/client";
import {
  listGitHubPullRequestCommits,
  listGitHubPullRequestFiles,
  listRecentGitHubPullRequests,
  type GitHubPullRequest,
  type GitHubPullRequestCommitSummary,
  type GitHubPullRequestFileSummary,
} from "@/integrations/github/pullRequests";
import type { GitHubRepositorySummary } from "@/integrations/github/repositories";

export type GitHubPullRequestIngestion = {
  source: GitHubPullRequest;
  files: GitHubPullRequestFileSummary[];
  commits: GitHubPullRequestCommitSummary[];
};

export async function readGitHubRepositoryHistory(
  client: GitHubRestClient,
  repository: Pick<GitHubRepositorySummary, "owner" | "name">,
  limit = 10,
) {
  const recentPullRequests = await listRecentGitHubPullRequests(
    client,
    repository.owner,
    repository.name,
    limit,
  );

  const records: GitHubPullRequestIngestion[] = [];
  for (const pullRequest of recentPullRequests) {
    const [files, commits] = await Promise.all([
      listGitHubPullRequestFiles(client, repository.owner, repository.name, pullRequest.number),
      listGitHubPullRequestCommits(client, repository.owner, repository.name, pullRequest.number),
    ]);
    records.push({ source: pullRequest, files, commits });
  }

  return records;
}
