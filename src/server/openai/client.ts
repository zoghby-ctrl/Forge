import "server-only";

import OpenAI from "openai";
import { AIConfigurationError } from "@/server/api/errors";

// The documented current flagship alias is intentional here: Forge needs
// high-quality code and evidence reasoning, while deployment can pin a
// snapshot later if reproducibility requirements change.
export const forgeOpenAIModel = "gpt-5.6";

let client: OpenAI | null = null;

export function getForgeOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AIConfigurationError();
  }

  client ??= new OpenAI({ apiKey });
  return client;
}
