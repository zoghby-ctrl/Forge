import type { PassportAnalysis } from "@/server/openai/schema";

export type PassportAnalysisInput = {
  repositoryFullName: string;
  pullRequest: {
    number: number;
    title: string;
    description: string | null;
    author: string;
    baseRef: string;
    headRef: string;
    baseSha: string;
    headSha: string;
    htmlUrl: string;
  };
  files: Array<{
    sha: string;
    path: string;
    previousPath: string | null;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
    patch: string | null;
    htmlUrl: string | null;
  }>;
  commits: Array<{
    sha: string;
    subject: string;
    author: string | null;
    authoredAt: string | null;
    committedAt: string | null;
    htmlUrl: string;
  }>;
  diff: string;
  diffTruncated: boolean;
};

export type PassportAnalysisResult = PassportAnalysis;
