import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

// Match Next.js local development behavior so this command validates .env.local
// rather than only values exported by the invoking shell.
loadEnvConfig(process.cwd());

const requiredForLocalApp = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
];
const githubCore = [
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_REDIRECT_URI",
  "GITHUB_TOKEN_ENCRYPTION_KEY",
];

function hasValidEncryptionKey(value) {
  try {
    return Buffer.from(value ?? "", "base64").length === 32;
  } catch {
    return false;
  }
}

const missingRequired = requiredForLocalApp.filter((key) => !process.env[key]);
const githubConfiguredPartially = githubCore.some((key) => process.env[key]);

if (missingRequired.length > 0) {
  console.error(`Missing required environment values: ${missingRequired.join(", ")}`);
  process.exit(1);
}

console.log("Required environment configuration is present.");

if (githubConfiguredPartially) {
  const missingGitHub = [...githubCore, "SUPABASE_SERVICE_ROLE_KEY"].filter((key) => !process.env[key]);
  if (missingGitHub.length > 0) {
    console.error(`GitHub integration is partially configured. Missing: ${missingGitHub.join(", ")}`);
    process.exit(1);
  }

  try {
    new URL(process.env.GITHUB_REDIRECT_URI);
  } catch {
    console.error("GITHUB_REDIRECT_URI must be a valid absolute URL.");
    process.exit(1);
  }

  if (!hasValidEncryptionKey(process.env.GITHUB_TOKEN_ENCRYPTION_KEY)) {
    console.error("GITHUB_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
    process.exit(1);
  }

  console.log("GitHub server-side integration configuration is present.");
} else {
  console.log("GitHub integration values are not configured; Forge will show its intentional connection state.");
}

const aiProvider = process.env.AI_PROVIDER ?? "openai";
if (aiProvider !== "openai" && aiProvider !== "groq") {
  console.error("AI_PROVIDER must be either openai or groq.");
  process.exit(1);
}

const aiApiKey = aiProvider === "groq" ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY;
if (aiApiKey) {
  console.log(`${aiProvider} server-side analysis configuration is present.`);
} else {
  console.log(`${aiProvider} analysis is not configured; selected pull requests will remain retryable source records.`);
}
