# AI reasoning pipeline

Forge analyzes a pull request only after the user selects it. Repository synchronization remains read-only GitHub ingestion; it never calls an AI provider eagerly.

## Model and API

- Provider selection: `AI_PROVIDER=openai` (default) uses the existing OpenAI Responses implementation; `AI_PROVIDER=groq` uses Groq's OpenAI-compatible Responses endpoint. Selection is server-side only.
- Models: OpenAI uses `gpt-5.6`; Groq uses `openai/gpt-oss-120b`. The selected model, prompt version, and source fingerprint are stored with each completed analysis for cache invalidation and auditability.
- Output mode: both providers use the same Zod-backed Structured Outputs schema via `zodTextFormat(..., "forge_change_passport")`.
- Data handling: OpenAI requests retain `store: false`. Groq does not support that request field, so its provider omits it. `OPENAI_API_KEY` and `GROQ_API_KEY` are read only by their respective server-only clients.

## Source assembly

The selected-PR route refreshes the following data with the encrypted, server-only GitHub token:

1. Pull-request title, description, base/head refs and SHAs.
2. Changed files, per-file patches, change totals, and source URLs.
3. Unified GitHub diff.
4. Commit SHA, subject, author, timestamps, and URLs.

The source is normalized and bounded before it reaches the model. A very large unified diff or per-file patch is explicitly marked as truncated rather than silently omitted.

## Prompt design

The developer instruction treats every GitHub field as untrusted data, never as instructions. It requires source-grounded claims, prohibits invented behavior or repository conventions, and directs the model to select `insufficient_evidence` whenever the supplied source cannot support a conclusion.

After parsing, Forge validates every cited changed-file path and commit SHA against the exact input. An unsupported citation rejects the result rather than allowing it into the Passport.

## Structured output schema

The Responses API returns this strongly typed object:

```ts
{
  summary: string,
  intent: GroundedClaim,
  guarantees: GroundedClaim[],
  evidence: GroundedClaim[],
  contradictions: GroundedClaim[],
  blastRadius: GroundedClaim[],
  repairPlan: GroundedClaim[],
  verdict: "ship" | "ship_with_conditions" | "hold" | "insufficient_evidence",
  confidence: { score: number, rationale: string }
}

type GroundedClaim = {
  statement: string,
  rationale: string,
  citations: Array<{
    sourceKind: "pull_request" | "changed_file" | "diff" | "commit",
    path: string | null,
    lineStart: number | null,
    lineEnd: number | null,
    commitSha: string | null,
    note: string
  }>
}
```

The result maps directly to the existing Passport fields (`summary`, `verdict`, `required_condition`, and `confidence_label`) and normalized evidence rows (`intent`, `guarantee`, `path`, `contradiction`, and `repair`). The existing three factual GitHub evidence entries remain part of the chain of custody.

## Streaming, cache, and failure behavior

`POST /api/passports/:passportId/analysis` responds with server-sent events. The UI keeps the existing Passport visible while it receives:

- `Reading pull request...`
- `Loading changed files...`
- `Analyzing guarantees...`
- `Searching contradictions...`
- `Generating repair...`
- `Decision complete.`

Completed analyses are cached on the Passport using a SHA-256 fingerprint of the normalized PR source plus the selected model and prompt version. A cache hit avoids another provider call. Existing OpenAI cache fingerprints remain valid; Groq adds provider and model information to avoid cross-provider reuse. The successful Passport and its evidence are persisted atomically. If GitHub, an AI provider, or persistence fails, Forge preserves the visible Passport, stores a sanitized retryable analysis error, and exposes the existing retry action.
