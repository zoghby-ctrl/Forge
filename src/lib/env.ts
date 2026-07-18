import { z } from "zod";

const publicEnvironmentSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

export type PublicEnvironment = z.infer<typeof publicEnvironmentSchema>;

export class EnvironmentConfigurationError extends Error {
  constructor(message = "Forge is missing its Supabase environment configuration.") {
    super(message);
    this.name = "EnvironmentConfigurationError";
  }
}

function environmentInput() {
  return {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

export function isSupabaseConfigured() {
  return publicEnvironmentSchema.safeParse(environmentInput()).success;
}

export function getPublicEnvironment(): PublicEnvironment {
  const parsed = publicEnvironmentSchema.safeParse(environmentInput());

  if (!parsed.success) {
    throw new EnvironmentConfigurationError();
  }

  return parsed.data;
}
