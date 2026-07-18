import "server-only";

import { createHash } from "node:crypto";
import { AIConfigurationError } from "@/server/api/errors";
import { forgeGroqModel } from "@/server/ai/groq-client";
import { GroqProvider } from "@/server/ai/groq-provider";
import { OpenAIProvider } from "@/server/ai/openai-provider";
import type { AIProviderName, SelectedAIProvider } from "@/server/ai/provider";
import { forgeOpenAIModel } from "@/server/openai/client";
import type { PassportAnalysisInput } from "@/server/openai/contracts";
import { getPassportAnalysisInputHash } from "@/server/openai/passport";

const providers: Record<AIProviderName, Omit<SelectedAIProvider, "name">> = {
  openai: {
    model: forgeOpenAIModel,
    provider: new OpenAIProvider(),
  },
  groq: {
    model: forgeGroqModel,
    provider: new GroqProvider(),
  },
};

function isAIProviderName(value: string): value is AIProviderName {
  return value === "openai" || value === "groq";
}

export function getSelectedAIProvider(): SelectedAIProvider {
  const name = process.env.AI_PROVIDER ?? "openai";
  if (!isAIProviderName(name)) {
    throw new AIConfigurationError();
  }

  return { name, ...providers[name] };
}

export function getAIAnalysisInputHash(input: PassportAnalysisInput, provider: SelectedAIProvider) {
  const establishedOpenAIHash = getPassportAnalysisInputHash(input);
  if (provider.name === "openai") {
    return establishedOpenAIHash;
  }

  return createHash("sha256")
    .update(provider.name)
    .update("\n")
    .update(provider.model)
    .update("\n")
    .update(establishedOpenAIHash)
    .digest("hex");
}
