import "server-only";

import OpenAI from "openai";
import { AIConfigurationError } from "@/server/api/errors";

export const forgeGroqModel = "openai/gpt-oss-120b";
export const groqOpenAICompatibleBaseUrl = "https://api.groq.com/openai/v1";

let client: OpenAI | null = null;

export function getForgeGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new AIConfigurationError();
  }

  client ??= new OpenAI({ apiKey, baseURL: groqOpenAICompatibleBaseUrl });
  return client;
}
