import type { PassportAnalysisInput, PassportAnalysisResult } from "@/server/openai/contracts";

export type AIProviderName = "openai" | "groq";

/**
 * The provider boundary deliberately exposes one operation: analyze the
 * normalized pull-request source and return Forge's existing Passport shape.
 */
export interface AIProvider {
  analyzePullRequest(input: PassportAnalysisInput): Promise<PassportAnalysisResult>;
}

export type SelectedAIProvider = {
  name: AIProviderName;
  model: string;
  provider: AIProvider;
};
