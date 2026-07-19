import "server-only";

import { AIConfigurationError } from "@/server/api/errors";
import { forgeGroqModel } from "@/server/ai/groq-client";
import type { AIProviderName } from "@/server/ai/provider";
import { forgeOpenAIModel } from "@/server/openai/client";
import { GroqPassportReviewProvider } from "@/server/ai/review/groq-review-provider";
import { OpenAIPassportReviewProvider } from "@/server/ai/review/openai-review-provider";
import type { SelectedPassportReviewProvider } from "@/server/ai/review/provider";

const providers: Record<AIProviderName, Omit<SelectedPassportReviewProvider, "name">> = {
  openai: { model: forgeOpenAIModel, provider: new OpenAIPassportReviewProvider() },
  groq: { model: forgeGroqModel, provider: new GroqPassportReviewProvider() },
};

function isAIProviderName(value: string): value is AIProviderName {
  return value === "openai" || value === "groq";
}

export function getSelectedPassportReviewProvider(): SelectedPassportReviewProvider {
  const name = process.env.AI_PROVIDER ?? "openai";
  if (!isAIProviderName(name)) throw new AIConfigurationError();
  return { name, ...providers[name] };
}
