import "server-only";

import { z } from "zod";

const base64EncryptionKeySchema = z.string().min(1).superRefine((value, context) => {
  try {
    if (Buffer.from(value, "base64").length !== 32) {
      context.addIssue({
        code: "custom",
        message: "GITHUB_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.",
      });
    }
  } catch {
    context.addIssue({
      code: "custom",
      message: "GITHUB_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.",
    });
  }
});

export const githubServerEnvironmentSchema = z.object({
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  GITHUB_REDIRECT_URI: z.url(),
  GITHUB_TOKEN_ENCRYPTION_KEY: base64EncryptionKeySchema,
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  GITHUB_API_BASE_URL: z.url().default("https://api.github.com"),
  GITHUB_OAUTH_BASE_URL: z.url().default("https://github.com"),
});

export type GitHubServerEnvironment = z.infer<typeof githubServerEnvironmentSchema>;

export class GitHubConfigurationError extends Error {
  constructor(message = "Forge is missing its server-only GitHub integration configuration.") {
    super(message);
    this.name = "GitHubConfigurationError";
  }
}

function environmentInput() {
  return {
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    GITHUB_REDIRECT_URI: process.env.GITHUB_REDIRECT_URI,
    GITHUB_TOKEN_ENCRYPTION_KEY: process.env.GITHUB_TOKEN_ENCRYPTION_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    GITHUB_API_BASE_URL: process.env.GITHUB_API_BASE_URL,
    GITHUB_OAUTH_BASE_URL: process.env.GITHUB_OAUTH_BASE_URL,
  };
}

function validateProductionRedirectUri(environment: GitHubServerEnvironment) {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  if (new URL(environment.GITHUB_REDIRECT_URI).protocol !== "https:") {
    throw new GitHubConfigurationError("GITHUB_REDIRECT_URI must use HTTPS in production.");
  }
}

function validateProviderEndpoints(environment: GitHubServerEnvironment) {
  const usesNonGitHubEndpoint =
    new URL(environment.GITHUB_API_BASE_URL).origin !== "https://api.github.com" ||
    new URL(environment.GITHUB_OAUTH_BASE_URL).origin !== "https://github.com";

  if (usesNonGitHubEndpoint && process.env.FORGE_E2E_GITHUB_MOCK !== "1") {
    throw new GitHubConfigurationError(
      "GitHub endpoint overrides are permitted only for the explicit Forge E2E mock.",
    );
  }
}

export function isGitHubIntegrationConfigured() {
  const parsed = githubServerEnvironmentSchema.safeParse(environmentInput());
  if (!parsed.success) {
    return false;
  }

  try {
    validateProductionRedirectUri(parsed.data);
    validateProviderEndpoints(parsed.data);
    return true;
  } catch {
    return false;
  }
}

export function getGitHubServerEnvironment(): GitHubServerEnvironment {
  const parsed = githubServerEnvironmentSchema.safeParse(environmentInput());

  if (!parsed.success) {
    throw new GitHubConfigurationError();
  }

  validateProductionRedirectUri(parsed.data);
  validateProviderEndpoints(parsed.data);
  return parsed.data;
}
