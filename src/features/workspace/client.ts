"use client";

import type {
  ForgeDecision,
  ForgePassport,
  ForgeWorkspace,
  RecordDecisionInput,
  StageRepairPathInput,
} from "@/domain/forge-workspace";
import type { ForgePassportReview } from "@/domain/passport-review";
import type { GitHubRepositorySummary } from "@/integrations/github/repositories";
import type { ApiResponse } from "@/server/api/response";

async function request<T>(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  const payload = await response.json() as ApiResponse<T>;

  if (!response.ok || !payload.ok) {
    throw new Error(payload.ok ? "Forge could not complete that request." : payload.error.message);
  }

  return payload.data;
}

export function persistRepairPath(passportId: string, input: StageRepairPathInput) {
  return request<{ passportId: string; repairStaged: boolean }>(
    `/api/passports/${passportId}/repair`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function persistPassportDecision(passportId: string, input: RecordDecisionInput) {
  return request<{ passportId: string; decision: ForgeDecision }>(
    `/api/passports/${passportId}/decisions`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function fetchGitHubRepositories() {
  return request<{ repositories: GitHubRepositorySummary[] }>(
    "/api/github/repositories",
    { method: "GET" },
  );
}

export function selectGitHubRepository(repositoryId: string) {
  return request<{ repositoryId: string; workspace: ForgeWorkspace }>(
    `/api/github/repositories/${repositoryId}/select`,
    { method: "POST" },
  );
}

export function disconnectGitHub() {
  return request<{ status: "disconnected" }>(
    "/api/github/disconnect",
    { method: "POST" },
  );
}

export type PassportAnalysisProgress = {
  phase: string;
  message: string;
};

export type PassportReviewProgress = {
  phase: string;
  message: string;
};

type PassportReviewComplete = {
  review: ForgePassportReview;
  cached?: boolean;
};

type PassportAnalysisComplete = {
  passport: ForgePassport;
  cached: boolean;
};

function parseStreamEvent(block: string) {
  const lines = block.replace(/\r/g, "").split("\n");
  const name = lines.find((line) => line.startsWith("event:"))?.slice("event:".length).trim();
  const data = lines.find((line) => line.startsWith("data:"))?.slice("data:".length).trim();
  if (!name || !data) return null;

  return { name, data: JSON.parse(data) as unknown };
}

export async function analyzePassport(
  passportId: string,
  onProgress: (progress: PassportAnalysisProgress) => void,
): Promise<PassportAnalysisComplete> {
  const response = await fetch(`/api/passports/${passportId}/analysis`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null) as ApiResponse<never> | null;
    throw new Error(payload && !payload.ok ? payload.error.message : "Forge could not start this AI analysis.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consume = (block: string): PassportAnalysisComplete | null => {
    const parsed = parseStreamEvent(block);
    if (!parsed) return null;

    if (parsed.name === "progress") {
      onProgress(parsed.data as PassportAnalysisProgress);
      return null;
    }
    if (parsed.name === "error") {
      const message = (parsed.data as { message?: unknown }).message;
      throw new Error(typeof message === "string" ? message : "Forge could not complete this AI analysis.");
    }
    if (parsed.name === "complete") {
      return parsed.data as PassportAnalysisComplete;
    }
    return null;
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const completed = consume(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      if (completed) return completed;
      boundary = buffer.indexOf("\n\n");
    }

    if (done) break;
  }

  const completed = consume(buffer);
  if (completed) return completed;
  throw new Error("Forge ended the AI analysis before returning a Passport.");
}

async function consumePassportReviewStream(input: {
  url: string;
  body: Record<string, unknown>;
  fallback: string;
  onProgress: (progress: PassportReviewProgress) => void;
}): Promise<PassportReviewComplete> {
  const response = await fetch(input.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input.body),
    cache: "no-store",
  });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null) as ApiResponse<never> | null;
    throw new Error(payload && !payload.ok ? payload.error.message : input.fallback);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const consume = (block: string): PassportReviewComplete | null => {
    const parsed = parseStreamEvent(block);
    if (!parsed) return null;
    if (parsed.name === "progress") {
      input.onProgress(parsed.data as PassportReviewProgress);
      return null;
    }
    if (parsed.name === "error") {
      const message = (parsed.data as { message?: unknown }).message;
      throw new Error(typeof message === "string" ? message : input.fallback);
    }
    return parsed.name === "complete" ? parsed.data as PassportReviewComplete : null;
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const complete = consume(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      if (complete) return complete;
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
  const complete = consume(buffer);
  if (complete) return complete;
  throw new Error(input.fallback);
}

export function askPassportReview(
  passportId: string,
  question: string,
  onProgress: (progress: PassportReviewProgress) => void,
) {
  return consumePassportReviewStream({
    url: `/api/passports/${passportId}/review`,
    body: { question },
    fallback: "Forge could not complete this AI review.",
    onProgress,
  });
}

export function generatePassportInsights(
  passportId: string,
  onProgress: (progress: PassportReviewProgress) => void,
) {
  return consumePassportReviewStream({
    url: `/api/passports/${passportId}/insights`,
    body: {},
    fallback: "Forge could not complete this enhanced review.",
    onProgress,
  });
}

export type PassportExportFormat = "markdown" | "pdf";

export async function preparePassportExport(passportId: string, format: PassportExportFormat) {
  const response = await fetch(`/api/passports/${passportId}/export?format=${format}`, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as ApiResponse<never> | null;
    throw new Error(payload && !payload.ok ? payload.error.message : "Forge could not prepare this export.");
  }

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1]
    ?? `forge-change-passport.${format === "markdown" ? "md" : "pdf"}`;

  return {
    blob: await response.blob(),
    filename,
  };
}
