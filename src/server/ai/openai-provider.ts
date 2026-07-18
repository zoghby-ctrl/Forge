import "server-only";

import type { PassportAnalysisInput, PassportAnalysisResult } from "@/server/openai/contracts";
import { analyzePullRequest as analyzeWithOpenAI } from "@/server/openai/passport";
import type { AIProvider } from "@/server/ai/provider";

/** Wraps the existing OpenAI implementation without changing it. */
export class OpenAIProvider implements AIProvider {
  analyzePullRequest(input: PassportAnalysisInput): Promise<PassportAnalysisResult> {
    return analyzeWithOpenAI(input);
  }
}
