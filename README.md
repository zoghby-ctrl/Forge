# Forge

Forge is the decision memory for AI-built software. It turns a meaningful code change into an evidence-backed Change Passport, then turns the human decision into durable project memory.

## Status

Forge connects an authenticated user to GitHub, persists real repository and pull-request source records in Supabase, and analyzes a selected pull request with a server-side AI provider to populate the existing Change Passport.

## Live demo

- Production: https://forge-woad-eight.vercel.app
- OpenAI Build Week category: Developer Tools

## Why Forge

AI coding tools can produce software quickly, but the reasoning, evidence, assumptions, and constraints behind important changes are often lost.

Forge adds an engineering-memory layer to AI-assisted development. It turns repository and pull-request context into an evidence-backed Change Passport so developers can understand what changed, why it changed, what evidence supports the conclusion, and what must remain true.

## Stack

- Next.js and TypeScript
- Supabase Auth and PostgreSQL with Row Level Security
- Zod-validated server routes and React Server Components
- GitHub OAuth App integration with server-side credential storage
- GitHub repository, pull-request, changed-file, diff, and commit ingestion
- OpenAI Responses API with GPT-5.6 family models, or Groq's OpenAI-compatible Responses API, with Zod Structured Outputs for Change Passport reasoning

## Getting started

1. Install Node.js 22 or later.
2. Copy `.env.example` to `.env.local`.
3. Populate `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from your Supabase project.
4. Create a GitHub OAuth App and use `http://localhost:3000/api/github/callback` as its local Authorization callback URL. Set the production callback URL to `https://your-forge-host/api/github/callback`.
5. Populate the server-only GitHub variables below, including a unique 32-byte base64 `GITHUB_TOKEN_ENCRYPTION_KEY` and the Supabase `SUPABASE_SERVICE_ROLE_KEY`.
6. Choose the server-only AI provider. `AI_PROVIDER=openai` is the default and requires `OPENAI_API_KEY`; `AI_PROVIDER=groq` requires `GROQ_API_KEY`.
7. Apply the migrations in `supabase/migrations/` to the linked Supabase project.
8. Run `npm run env:check`, then install dependencies with `npm install` and start Forge with `npm run dev`.

The public landing shell runs without credentials, but authentication and private workspace persistence require the Supabase variables above. Do not put a GitHub client secret, GitHub access token, encryption key, or Supabase service-role key in browser-visible environment variables.

## Supported platforms

Forge is a web application designed for modern desktop browsers. Judges can use the hosted production instance without rebuilding the project locally.

## Testing Forge

Judges can test Forge using the deployed production instance:

1. Open https://forge-woad-eight.vercel.app.
2. Sign in using the credentials supplied in the private Devpost testing instructions, or use the available authentication flow.
3. Connect a GitHub account.
4. Select a repository and pull request.
5. Generate a Change Passport.
6. Review the evidence, guarantees, decision context, and export options.

Any dedicated judging credentials should be shared only through Devpost's private testing instructions and must not be committed to this public repository.

## GitHub OAuth setup

Configure the following values in `.env.local` and in your deployment's server-side secret store:

| Variable | Purpose |
|---|---|
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID. |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App secret; server-side only. |
| `GITHUB_REDIRECT_URI` | Exact GitHub OAuth callback, ending in `/api/github/callback`. |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | Base64-encoded 32-byte AES-256-GCM key used to encrypt access tokens and PKCE verifiers. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key used only by the credential and ingestion service; never expose it to the browser. |
| `AI_PROVIDER` | `openai` by default, or `groq`. Switching requires only this environment value and a server restart. |
| `OPENAI_API_KEY` | Server-only OpenAI key used when `AI_PROVIDER=openai`. |
| `GROQ_API_KEY` | Server-only Groq key used when `AI_PROVIDER=groq`. |

Generate an encryption key with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Forge uses PKCE, a signed HttpOnly `SameSite=Lax` OAuth cookie, and a one-time server-side state record that expires after ten minutes. The OAuth callback validates the signed-in Supabase user, GitHub's returned state, and the GitHub identity before encrypting and storing a token. It never returns the token to the browser.

## AI provider setup

Forge keeps provider selection entirely server-side. The default production path uses OpenAI's Responses API with GPT-5.6 family models:

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=...
```

Forge uses the OpenAI Responses API to analyze repository and pull-request context and generate structured, source-grounded Change Passports.

To use Groq while the OpenAI project is unavailable, set the provider and key in `.env.local` and in the corresponding server-side deployment secrets:

```dotenv
AI_PROVIDER=groq
GROQ_API_KEY=...
```

Groq is called through the installed OpenAI client at its compatible Responses API endpoint with `openai/gpt-oss-120b`. It uses the same Forge prompt, Zod structured-output schema, source-grounding checks, cache behavior, retryable failures, and server-sent Passport progress events. No frontend, API route, or database change is required; restart Forge after changing the environment value.

### GitHub permissions

Forge makes only read requests to GitHub: repository metadata, pull requests, changed-file metadata, and commits.

GitHub OAuth Apps do not support fine-grained, read-only access to selected private repositories. The minimum OAuth scope that permits private repository metadata is GitHub's coarse `repo` scope.

This is a GitHub OAuth App limitation, not a Forge write permission: Forge never sends a GitHub write request.

For true selected-repository and read-only permissions, the integration can later be migrated to a GitHub App with `Metadata`, `Contents`, and `Pull requests` read permissions.

## Built with Codex and GPT-5.6

Forge was built during OpenAI Build Week through continuous collaboration with Codex using the GPT-5.6 family.

I directed the product vision, user workflow, architecture, engineering priorities, and design decisions. Codex accelerated implementation across the full stack, while I reviewed the generated work, tested the product, identified failures, and guided fixes through production deployment.

Codex and GPT-5.6 contributed to:

- Supabase authentication and persistent session handling
- GitHub OAuth, secure token storage, and repository ingestion
- Pull-request, changed-file, diff, and commit processing
- Change Passport generation and structured-output validation
- OpenAI Responses API integration
- Environment validation
- Production debugging
- Testing and deployment

Forge also integrates OpenAI's API directly into the product. The production reasoning pipeline uses the OpenAI Responses API with GPT-5.6 family models to analyze repository and pull-request context and generate structured Change Passports.

GPT-5.6 therefore contributed in two ways:

1. Through Codex, as the model family used to help design, implement, debug, test, and deploy Forge.
2. Inside Forge itself, through the OpenAI Responses API used for Change Passport reasoning.

The final product direction, architecture choices, scope, review, and acceptance of the implementation remained human-directed throughout the project.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the local application. |
| `npm run build` | Create a production build. |
| `npm run lint` | Run linting. |
| `npm run typecheck` | Run TypeScript checks. |
| `npm test` | Run unit tests. |
| `npm run test:e2e` | Run Playwright tests. |
| `npm run check` | Run lint, type checks, and unit tests. |
| `npm run env:check` | Validate non-secret environment configuration. |

The full mocked OAuth, repository-picker, and Passport browser scenario is intentionally enabled only when `FORGE_E2E_GITHUB_MOCK=1`, a dedicated Supabase test project, and the local mock endpoints are configured.

Set `GITHUB_API_BASE_URL` and `GITHUB_OAUTH_BASE_URL` to `http://127.0.0.1:4010`.

Playwright starts `tests/e2e/github-mock-server.mjs` automatically. This keeps normal CI from contacting GitHub or a production Supabase project. The default browser suite verifies the unauthenticated OAuth boundary.

## Product principles

- Proof over personality.
- One accountable decision, not a dashboard of findings.
- Human authority over consequential actions.
- Every material conclusion has inspectable source evidence.
- Every confirmed decision improves future decisions.

## Documentation

- [Product specification](docs/product-spec.md)
- [Technical architecture](docs/architecture.md)
- [AI reasoning pipeline](docs/ai-reasoning-pipeline.md)
- [Development roadmap](docs/roadmap.md)
- [Demo runbook](docs/demo.md)
- [Security baseline](docs/security.md)
- [Development guide](docs/development.md)

## Scope boundary

Forge stores GitHub provenance first, then analyzes only the selected pull request with a server-side, source-grounded Responses API call.

A failed analysis preserves the current Passport and offers retry. Forge never writes to GitHub, merges code, or deploys software.