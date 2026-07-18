# Forge architecture

## Runtime shape

Forge is a TypeScript modular monolith deployed as a Next.js application. It provides authenticated, user-owned persistence, server-side GitHub OAuth ingestion, and a server-side AI provider pipeline that turns a selected pull request into a Change Passport.

```text
Next.js UI and API
  ├── Supabase Auth (cookie session refresh through Next.js Proxy)
  ├── Supabase PostgreSQL (RLS-enforced public schema)
  ├── Server-side GitHub OAuth (PKCE, one-time state, encrypted token records)
  ├── Typed GitHub REST client (repositories, pull requests, files, diffs, commits)
  ├── Server-side AI provider boundary (OpenAI or Groq Responses API, structured Change Passport output)
  ├── Server-side workspace services and Zod validation
  └── Streamed Passport progress and durable, cached analysis results
```

## Core domain boundaries

- `projects`: repository connection and project lifecycle
- `repositories` and `pull_requests`: persisted provider-ready source records
- `guarantees`: proposed and confirmed System Guarantees
- `passports`: durable Change Passport, evidence, repair state, and human decision
- `decisions`: append-only decision and derived Decision Memory, committed atomically
- `change_passports` analysis metadata: source fingerprint, model, prompt version, status, completed time, error state, and structured output cache

## Trust invariants

- Every Passport binds to exact base and head commit SHAs.
- Every decisive claim must have a verified source citation.
- Forge does not publish a verdict when evidence is insufficient.
- A recorded decision does not merge or deploy code.
- Every public-table read and mutation is constrained by a user-ownership RLS policy.
- Browser code never receives a Supabase secret or bypasses server authorization.
- Browser code never receives a GitHub secret, OAuth code verifier, or access token.
- GitHub credentials are encrypted at rest and cannot be read through the authenticated Data API role.
- Repository text is untrusted data, never model instruction.
- The browser never calls an AI provider or receives `OPENAI_API_KEY` or `GROQ_API_KEY`; Responses API calls are invoked only by server-side provider modules.
- The selected provider receives the PR title, description, changed files, unified diff, and commit metadata through the same Zod-validated structured-output request.
- Analysis output is rejected if a cited path or commit SHA does not match the supplied GitHub source.
- A completed result is reused only when its source fingerprint, model, and prompt version match; a source change causes a new analysis.
- A failed provider request preserves the last source-backed Passport and records a retryable failure instead of replacing it with placeholder data.

## Pull-request reasoning flow

```text
GitHub repository selection
  -> persisted PR source shell
  -> selected pull request
  -> server-side GitHub refresh (title, description, files, diff, commits)
  -> server-side selected-provider Responses API structured output
  -> atomic Change Passport + evidence persistence
  -> existing Change Passport UI
```

The analysis route streams factual progress events to the existing UI: reading the PR, loading changed files, analyzing guarantees, searching contradictions, generating repair, and completing the decision. See [AI reasoning pipeline](ai-reasoning-pipeline.md) for the model, prompt, schema, and cache contract.
