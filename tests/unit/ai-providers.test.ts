import { afterEach, describe, expect, it, vi } from "vitest";
import { getAIAnalysisInputHash, getSelectedAIProvider } from "../../src/server/ai";
import { forgeGroqModel } from "../../src/server/ai/groq-client";
import { GroqProvider } from "../../src/server/ai/groq-provider";
import { AIConfigurationError } from "../../src/server/api/errors";
import type { PassportAnalysisInput, PassportAnalysisResult } from "../../src/server/openai/contracts";
import { getPassportAnalysisInputHash } from "../../src/server/openai/passport";

const inheritedProvider = process.env.AI_PROVIDER;

const input: PassportAnalysisInput = {
  repositoryFullName: "acme/forge-api",
  pullRequest: {
    number: 42,
    title: "Validate callback state",
    description: "Reject invalid OAuth state.",
    author: "octavia",
    baseRef: "main",
    headRef: "fix/callback-state",
    baseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    htmlUrl: "https://github.test/acme/forge-api/pull/42",
  },
  files: [{
    sha: "cccccccccccccccccccccccccccccccccccccccc",
    path: "src/auth/callback.ts",
    previousPath: null,
    status: "modified",
    additions: 12,
    deletions: 2,
    changes: 14,
    patch: "@@ -1,2 +1,12 @@",
    htmlUrl: "https://github.test/acme/forge-api/blob/head/src/auth/callback.ts",
  }],
  commits: [{
    sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    subject: "Validate callback state",
    author: "octavia",
    authoredAt: "2026-07-18T00:00:00Z",
    committedAt: "2026-07-18T00:00:00Z",
    htmlUrl: "https://github.test/acme/forge-api/commit/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  }],
  diff: "diff --git a/src/auth/callback.ts b/src/auth/callback.ts",
  diffTruncated: false,
};

const citation = {
  sourceKind: "changed_file" as const,
  path: "src/auth/callback.ts",
  lineStart: 1,
  lineEnd: 2,
  commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  note: "The callback rejects a mismatched state value.",
};

const output: PassportAnalysisResult = {
  summary: "The pull request adds OAuth callback-state validation.",
  intent: {
    statement: "Reject invalid OAuth callback state.",
    rationale: "The changed callback verifies the returned state.",
    citations: [citation],
  },
  guarantees: [],
  evidence: [],
  contradictions: [],
  blastRadius: [],
  repairPlan: [{
    statement: "Verify mismatched state is rejected.",
    rationale: "The change introduces a validation branch.",
    citations: [citation],
  }],
  verdict: "ship_with_conditions",
  confidence: { score: 85, rationale: "The changed callback directly supports the conclusion." },
};

afterEach(() => {
  if (inheritedProvider === undefined) {
    delete process.env.AI_PROVIDER;
  } else {
    process.env.AI_PROVIDER = inheritedProvider;
  }
});

describe("AI provider selection", () => {
  it("keeps OpenAI as the default and preserves its established cache fingerprint", () => {
    delete process.env.AI_PROVIDER;

    const provider = getSelectedAIProvider();

    expect(provider.name).toBe("openai");
    expect(getAIAnalysisInputHash(input, provider)).toBe(getPassportAnalysisInputHash(input));
  });

  it("selects Groq entirely through AI_PROVIDER and creates a provider-specific cache fingerprint", () => {
    process.env.AI_PROVIDER = "groq";

    const provider = getSelectedAIProvider();

    expect(provider.name).toBe("groq");
    expect(provider.model).toBe(forgeGroqModel);
    expect(getAIAnalysisInputHash(input, provider)).not.toBe(getPassportAnalysisInputHash(input));
  });

  it("rejects unsupported provider values without falling back silently", () => {
    process.env.AI_PROVIDER = "unsupported";

    expect(() => getSelectedAIProvider()).toThrow(AIConfigurationError);
  });
});

describe("GroqProvider", () => {
  it("uses the OpenAI-compatible Responses API with Forge's existing structured output", async () => {
    const parse = vi.fn().mockResolvedValue({ output_parsed: output });
    const provider = new GroqProvider(() => ({ responses: { parse } } as never));

    await expect(provider.analyzePullRequest(input)).resolves.toEqual(output);

    const request = parse.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(request).toMatchObject({
      model: forgeGroqModel,
      reasoning: { effort: "medium" },
    });
    expect(request).not.toHaveProperty("store");
    expect(request.text).toMatchObject({
      format: {
        type: "json_schema",
        name: "forge_change_passport",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: expect.arrayContaining([
            "summary",
            "intent",
            "guarantees",
            "evidence",
            "contradictions",
            "blastRadius",
            "repairPlan",
            "verdict",
            "confidence",
          ]),
        },
      },
    });

    const developerInstructions = (request.input as Array<{ role: string; content: string }>)[0]?.content;
    expect(developerInstructions).toContain("Return exactly one JSON object");
    expect(developerInstructions).toContain("Never return an array");
  });

  it("retries once after structured output validation fails", async () => {
    const parse = vi.fn()
      .mockResolvedValueOnce({ output_parsed: [] })
      .mockResolvedValueOnce({ output_parsed: output });
    const provider = new GroqProvider(() => ({ responses: { parse } } as never));

    await expect(provider.analyzePullRequest(input)).resolves.toEqual(output);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("retries once for a transient provider response and preserves the final failure behavior", async () => {
    const transientError = Object.assign(new Error("Groq temporarily unavailable"), { status: 503 });
    const parse = vi.fn()
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce({ output_parsed: output });
    const provider = new GroqProvider(() => ({ responses: { parse } } as never));

    await expect(provider.analyzePullRequest(input)).resolves.toEqual(output);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("retries Groq's structured-generation error response", async () => {
    const generationError = Object.assign(new Error("Generated JSON does not match the expected schema"), {
      status: 400,
      error: { message: "Generated JSON does not match the expected schema", type: "invalid_request_error" },
    });
    const parse = vi.fn()
      .mockRejectedValueOnce(generationError)
      .mockResolvedValueOnce({ output_parsed: output });
    const provider = new GroqProvider(() => ({ responses: { parse } } as never));

    await expect(provider.analyzePullRequest(input)).resolves.toEqual(output);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("does not retry a permanent provider request error", async () => {
    const permanentError = Object.assign(new Error("Invalid request"), { status: 400 });
    const parse = vi.fn().mockRejectedValue(permanentError);
    const provider = new GroqProvider(() => ({ responses: { parse } } as never));

    await expect(provider.analyzePullRequest(input)).rejects.toMatchObject({
      code: "OPENAI_ANALYSIS_FAILED",
    });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("does not retry quota exhaustion even when Groq returns HTTP 429", async () => {
    const quotaError = Object.assign(new Error("insufficient_quota"), {
      status: 429,
      code: "insufficient_quota",
    });
    const parse = vi.fn().mockRejectedValue(quotaError);
    const provider = new GroqProvider(() => ({ responses: { parse } } as never));

    await expect(provider.analyzePullRequest(input)).rejects.toMatchObject({
      code: "OPENAI_ANALYSIS_FAILED",
    });
    expect(parse).toHaveBeenCalledTimes(1);
  });
});
