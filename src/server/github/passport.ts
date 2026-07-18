import type {
  GitHubPullRequest,
  GitHubPullRequestCommitSummary,
  GitHubPullRequestFileSummary,
} from "@/integrations/github/pullRequests";

export type GitHubSourceEvidence = {
  ordinal: number;
  kind: "intent" | "path";
  tone: "default";
  label: string;
  title: string;
  detail: string;
  sourceLabel: string;
  sourcePath: string | null;
  commitSha: string;
  sourceUrl: string;
  providerObjectId: string;
};

export type GitHubSourcePassport = {
  verdict: "insufficient_evidence";
  summary: string;
  requiredCondition: string;
  confidenceLabel: string;
  reviewState: "ready_for_decision";
  evidence: GitHubSourceEvidence[];
};

function shortSha(sha: string) {
  return sha.slice(0, 12);
}

/**
 * Produces the factual source shell shown before a user selects a pull request
 * for AI analysis. Every field is derived from GitHub responses.
 */
export function createGitHubSourcePassport(input: {
  repositoryFullName: string;
  pullRequest: GitHubPullRequest;
  files: GitHubPullRequestFileSummary[];
  commits: GitHubPullRequestCommitSummary[];
}): GitHubSourcePassport {
  const { repositoryFullName, pullRequest, files, commits } = input;
  const firstFile = files[0] ?? null;
  const firstCommit = commits[0] ?? null;
  const listedFilePaths = files.slice(0, 3).map((file) => file.path).join(", ");

  return {
    verdict: "insufficient_evidence",
    summary: `Source record for ${repositoryFullName} pull request #${pullRequest.number}. Forge captured ${pullRequest.changedFiles} changed files and ${pullRequest.commitsCount} commits from GitHub; select this pull request to generate its evidence-grounded Change Passport.`,
    requiredCondition: "Run the Change Passport analysis before making a merge decision.",
    confidenceLabel: "GitHub source metadata",
    reviewState: "ready_for_decision",
    evidence: [
      {
        ordinal: 1,
        kind: "intent",
        tone: "default",
        label: "Pull request",
        title: `#${pullRequest.number} · ${pullRequest.title}`,
        detail: `${pullRequest.authorDisplayName} opened this pull request from ${pullRequest.headRef} into ${pullRequest.baseRef}.`,
        sourceLabel: `GitHub pull request #${pullRequest.number}`,
        sourcePath: null,
        commitSha: pullRequest.headSha,
        sourceUrl: pullRequest.htmlUrl,
        providerObjectId: pullRequest.id,
      },
      {
        ordinal: 2,
        kind: "path",
        tone: "default",
        label: "Diff metadata",
        title: `${pullRequest.changedFiles} files · +${pullRequest.additions} / -${pullRequest.deletions}`,
        detail: firstFile
          ? `Changed files captured from GitHub include ${listedFilePaths}.`
          : "GitHub reported the changed-file and line-change totals for this pull request.",
        sourceLabel: firstFile ? `GitHub file · ${firstFile.path}` : `GitHub diff · PR #${pullRequest.number}`,
        sourcePath: firstFile?.path ?? null,
        commitSha: pullRequest.headSha,
        sourceUrl: firstFile?.htmlUrl ?? pullRequest.htmlUrl,
        providerObjectId: firstFile?.sha ?? pullRequest.id,
      },
      {
        ordinal: 3,
        kind: "path",
        tone: "default",
        label: "Commit metadata",
        title: `${pullRequest.commitsCount} commits captured`,
        detail: firstCommit
          ? `${shortSha(firstCommit.sha)} · ${firstCommit.subject}`
          : `GitHub reported ${pullRequest.commitsCount} commits for this pull request.`,
        sourceLabel: firstCommit ? `GitHub commit · ${shortSha(firstCommit.sha)}` : `GitHub head · ${shortSha(pullRequest.headSha)}`,
        sourcePath: null,
        commitSha: firstCommit?.sha ?? pullRequest.headSha,
        sourceUrl: firstCommit?.htmlUrl ?? pullRequest.htmlUrl,
        providerObjectId: firstCommit?.sha ?? pullRequest.headSha,
      },
    ],
  };
}
