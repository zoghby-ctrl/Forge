# Development guide

## Prerequisites

- Node.js 22+
- npm 11+
- A Vercel project for deployment
- Service credentials only when activating the corresponding roadmap milestone

## Local workflow

1. Copy `.env.example` to `.env.local`.
2. Run `npm install`.
3. Run `npm run dev`.
4. Visit `http://localhost:3000`.
5. Before committing, run `npm run check`.

## Quality expectations

- Strict TypeScript with no unchecked application boundary.
- Zod contracts for API and model-facing data.
- Unit tests for domain rules.
- Playwright coverage for the frozen primary journey.
- No business logic in page components.

## Environment policy

- `.env.local` is never committed.
- `.env.example` contains names only, never credentials.
- Secrets are read only on the server.
- `AI_PROVIDER` selects `openai` (default, requiring `OPENAI_API_KEY`) or `groq` (requiring `GROQ_API_KEY`). Provider keys are read only by their respective server-side Responses API clients.
- Run `npm run env:check` before a local GitHub-to-Passport flow; it reports whether the selected provider is configured without printing any secret.
