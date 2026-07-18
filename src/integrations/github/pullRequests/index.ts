import { z } from "zod";
import { GitHubRestClient } from "@/integrations/github/client";

const githubUserSchema = z.object({
  login: z.string().min(1),
});

const githubPullRequestListItemSchema = z.object({
  number: z.number().int().positive(),
});

const githubPullRequestDetailSchema = z.object({
  id: z.number().int().positive(),
  number: z.number().int().positive(),
  title: z.string().min(1),
  body: z.string().nullable().optional().default(null),
  state: z.enum(["open", "closed"]),
  draft: z.boolean().optional().default(false),
  user: githubUserSchema.nullable(),
  base: z.object({
    ref: z.string().min(1),
    sha: z.string().min(1),
  }),
  head: z.object({
    ref: z.string().min(1),
    sha: z.string().min(1),
  }),
  changed_files: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  commits: z.number().int().nonnegative(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  closed_at: z.string().datetime().nullable(),
  merged_at: z.string().datetime().nullable(),
  html_url: z.url(),
});

const githubPullRequestFileSchema = z.object({
  sha: z.string().min(1),
  filename: z.string().min(1),
  status: z.string().min(1),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  changes: z.number().int().nonnegative(),
  previous_filename: z.string().nullable().optional(),
  blob_url: z.url().optional(),
  patch: z.string().nullable().optional(),
});

const githubPullRequestCommitSchema = z.object({
  sha: z.string().min(1),
  html_url: z.url(),
  author: githubUserSchema.nullable(),
  commit: z.object({
    message: z.string().min(1),
    author: z.object({
      name: z.string().nullable(),
      date: z.string().datetime().nullable(),
    }).nullable(),
    committer: z.object({
      name: z.string().nullable(),
      date: z.string().datetime().nullable(),
    }).nullable(),
  }),
});

export const githubPullRequestSchema = z.object({
  id: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string().min(1),
  description: z.string().nullable(),
  authorLogin: z.string().nullable(),
  authorDisplayName: z.string().min(1),
  state: z.enum(["open", "closed"]),
  draft: z.boolean(),
  baseRef: z.string().min(1),
  headRef: z.string().min(1),
  baseSha: z.string().min(1),
  headSha: z.string().min(1),
  changedFiles: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  commitsCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
  mergedAt: z.string().datetime().nullable(),
  htmlUrl: z.url(),
});

export const githubPullRequestFileSummarySchema = z.object({
  sha: z.string().min(1),
  path: z.string().min(1),
  status: z.string().min(1),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  changes: z.number().int().nonnegative(),
  previousPath: z.string().nullable(),
  htmlUrl: z.url().nullable(),
  patch: z.string().nullable(),
});

export const githubPullRequestCommitSummarySchema = z.object({
  sha: z.string().min(1),
  subject: z.string().min(1),
  authorLogin: z.string().nullable(),
  authorName: z.string().nullable(),
  authoredAt: z.string().datetime().nullable(),
  committedAt: z.string().datetime().nullable(),
  htmlUrl: z.url(),
});

export type GitHubPullRequest = z.infer<typeof githubPullRequestSchema>;
export type GitHubPullRequestFileSummary = z.infer<typeof githubPullRequestFileSummarySchema>;
export type GitHubPullRequestCommitSummary = z.infer<typeof githubPullRequestCommitSummarySchema>;

export type GitHubPullRequestAnalysisContext = {
  pullRequest: GitHubPullRequest;
  files: GitHubPullRequestFileSummary[];
  commits: GitHubPullRequestCommitSummary[];
  diff: string;
};

function mapGitHubPullRequest(detail: z.infer<typeof githubPullRequestDetailSchema>): GitHubPullRequest {
  return githubPullRequestSchema.parse({
    id: String(detail.id),
    number: detail.number,
    title: detail.title,
    description: detail.body,
    authorLogin: detail.user?.login ?? null,
    authorDisplayName: detail.user?.login ?? "GitHub user",
    state: detail.state,
    draft: detail.draft,
    baseRef: detail.base.ref,
    headRef: detail.head.ref,
    baseSha: detail.base.sha,
    headSha: detail.head.sha,
    changedFiles: detail.changed_files,
    additions: detail.additions,
    deletions: detail.deletions,
    commitsCount: detail.commits,
    createdAt: detail.created_at,
    updatedAt: detail.updated_at,
    closedAt: detail.closed_at,
    mergedAt: detail.merged_at,
    htmlUrl: detail.html_url,
  });
}

function nextPagePath(linkHeader: string | null) {
  const nextLink = linkHeader?.split(",").find((link) => /rel="next"/.test(link));
  const match = nextLink?.match(/<([^>]+)>/);
  return match?.[1] ?? null;
}

function repositoryPath(owner: string, repository: string) {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
}

export async function getGitHubPullRequest(
  client: GitHubRestClient,
  owner: string,
  repository: string,
  pullRequestNumber: number,
) {
  const response = await client.get(
    `${repositoryPath(owner, repository)}/pulls/${pullRequestNumber}`,
    githubPullRequestDetailSchema,
  );

  return mapGitHubPullRequest(response.data);
}

export async function getGitHubPullRequestDiff(
  client: GitHubRestClient,
  owner: string,
  repository: string,
  pullRequestNumber: number,
) {
  const response = await client.getText(
    `${repositoryPath(owner, repository)}/pulls/${pullRequestNumber}`,
    "application/vnd.github.diff",
  );

  return response.data;
}

export async function listRecentGitHubPullRequests(
  client: GitHubRestClient,
  owner: string,
  repository: string,
  limit = 10,
) {
  const response = await client.get(
    `${repositoryPath(owner, repository)}/pulls?state=all&sort=updated&direction=desc&per_page=${Math.min(limit, 100)}`,
    z.array(githubPullRequestListItemSchema),
  );

  const pullRequests: GitHubPullRequest[] = [];
  for (const item of response.data.slice(0, limit)) {
    pullRequests.push(await getGitHubPullRequest(client, owner, repository, item.number));
  }

  return pullRequests;
}

export async function listGitHubPullRequestFiles(
  client: GitHubRestClient,
  owner: string,
  repository: string,
  pullRequestNumber: number,
) {
  const files: GitHubPullRequestFileSummary[] = [];
  let nextPath: string | null = `${repositoryPath(owner, repository)}/pulls/${pullRequestNumber}/files?per_page=100`;
  let page = 0;

  while (nextPath && page < 10) {
    const response = await client.get(nextPath, z.array(githubPullRequestFileSchema));
    files.push(...response.data.map((file) => githubPullRequestFileSummarySchema.parse({
      sha: file.sha,
      path: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      previousPath: file.previous_filename ?? null,
      htmlUrl: file.blob_url ?? null,
      patch: file.patch ?? null,
    })));
    nextPath = nextPagePath(response.headers.get("link"));
    page += 1;
  }

  return files;
}

export async function listGitHubPullRequestCommits(
  client: GitHubRestClient,
  owner: string,
  repository: string,
  pullRequestNumber: number,
) {
  const commits: GitHubPullRequestCommitSummary[] = [];
  let nextPath: string | null = `${repositoryPath(owner, repository)}/pulls/${pullRequestNumber}/commits?per_page=100`;
  let page = 0;

  while (nextPath && page < 10) {
    const response = await client.get(nextPath, z.array(githubPullRequestCommitSchema));
    commits.push(...response.data.map((commit) => githubPullRequestCommitSummarySchema.parse({
      sha: commit.sha,
      subject: commit.commit.message.split("\n")[0] || commit.sha,
      authorLogin: commit.author?.login ?? null,
      authorName: commit.commit.author?.name ?? null,
      authoredAt: commit.commit.author?.date ?? null,
      committedAt: commit.commit.committer?.date ?? null,
      htmlUrl: commit.html_url,
    })));
    nextPath = nextPagePath(response.headers.get("link"));
    page += 1;
  }

  return commits;
}

export async function readGitHubPullRequestAnalysisContext(
  client: GitHubRestClient,
  owner: string,
  repository: string,
  pullRequestNumber: number,
): Promise<GitHubPullRequestAnalysisContext> {
  const pullRequest = await getGitHubPullRequest(client, owner, repository, pullRequestNumber);
  const [files, commits, diff] = await Promise.all([
    listGitHubPullRequestFiles(client, owner, repository, pullRequestNumber),
    listGitHubPullRequestCommits(client, owner, repository, pullRequestNumber),
    getGitHubPullRequestDiff(client, owner, repository, pullRequestNumber),
  ]);

  return { pullRequest, files, commits, diff };
}
