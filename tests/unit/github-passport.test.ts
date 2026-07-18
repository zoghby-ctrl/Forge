import { describe, expect, it } from "vitest";
import { createGitHubSourcePassport } from "../../src/server/github/passport";
import {
  githubPullRequestCommitsResponse,
  githubPullRequestDetailResponse,
  githubPullRequestFilesResponse,
} from "../fixtures/github/github-responses";

describe("GitHub source Passport", () => {
  it("uses real pull-request, changed-file, and commit metadata without inferring a guarantee", () => {
    const passport = createGitHubSourcePassport({
      repositoryFullName: "acme/forge-api",
      pullRequest: {
        id: String(githubPullRequestDetailResponse.id),
        number: githubPullRequestDetailResponse.number,
        title: githubPullRequestDetailResponse.title,
        description: githubPullRequestDetailResponse.body,
        authorLogin: githubPullRequestDetailResponse.user.login,
        authorDisplayName: githubPullRequestDetailResponse.user.login,
        state: "open",
        draft: false,
        baseRef: githubPullRequestDetailResponse.base.ref,
        headRef: githubPullRequestDetailResponse.head.ref,
        baseSha: githubPullRequestDetailResponse.base.sha,
        headSha: githubPullRequestDetailResponse.head.sha,
        changedFiles: githubPullRequestDetailResponse.changed_files,
        additions: githubPullRequestDetailResponse.additions,
        deletions: githubPullRequestDetailResponse.deletions,
        commitsCount: githubPullRequestDetailResponse.commits,
        createdAt: githubPullRequestDetailResponse.created_at,
        updatedAt: githubPullRequestDetailResponse.updated_at,
        closedAt: null,
        mergedAt: null,
        htmlUrl: githubPullRequestDetailResponse.html_url,
      },
      files: [{
        sha: githubPullRequestFilesResponse[0]!.sha,
        path: githubPullRequestFilesResponse[0]!.filename,
        status: githubPullRequestFilesResponse[0]!.status,
        additions: githubPullRequestFilesResponse[0]!.additions,
        deletions: githubPullRequestFilesResponse[0]!.deletions,
        changes: githubPullRequestFilesResponse[0]!.changes,
        previousPath: null,
        htmlUrl: githubPullRequestFilesResponse[0]!.blob_url,
        patch: githubPullRequestFilesResponse[0]!.patch,
      }],
      commits: [{
        sha: githubPullRequestCommitsResponse[0]!.sha,
        subject: "Validate callback state",
        authorLogin: "sam-engineer",
        authorName: "Sam Engineer",
        authoredAt: "2026-07-16T08:30:00Z",
        committedAt: "2026-07-16T08:31:00Z",
        htmlUrl: githubPullRequestCommitsResponse[0]!.html_url,
      }],
    });

    expect(passport.verdict).toBe("insufficient_evidence");
    expect(passport.summary).toContain("acme/forge-api");
    expect(passport.summary).toContain("2 changed files");
    expect(passport.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: "src/auth/callback.ts" }),
      expect.objectContaining({ commitSha: "cccccccccccccccccccccccccccccccccccccccc" }),
    ]));
  });
});
