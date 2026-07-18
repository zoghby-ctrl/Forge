# Forge security baseline

## Access

- Supabase Auth uses passwordless magic links and cookie-backed session refresh.
- Every public table has Row Level Security enabled; access derives from `auth.uid()` and project ownership.
- Server routes call `auth.getUser()` before mutating data, and validate request bodies with Zod.
- Browser code uses a Supabase publishable key only. The GitHub ingestion service uses the Supabase service-role key only after it has authenticated and owner-scoped the Forge user.
- GitHub OAuth client secrets, PKCE verifiers, and access tokens are server-side only. Tokens are AES-256-GCM encrypted with authenticated user/record binding before persistence.
- `github_connections` and `github_oauth_states` have RLS enabled, no `authenticated` grants, and no user-readable policies. They are reachable only by the scoped server-side GitHub service.
- OAuth callbacks use PKCE, a signed HTTP-only `SameSite=Lax` cookie, a one-time database state record, ten-minute expiration, timing-safe state comparison, and a clean post-callback redirect with `no-store` and `no-referrer` headers.
- A GitHub `401` marks the local credential revoked and asks the user to reconnect. Disconnect revokes the remote OAuth grant before deleting the encrypted local credential.
- Application sessions use secure HTTP-only cookies.
- Every project query is scoped to its owner in the initial release.

## Source handling

- Do not retain full repository archives after analysis.
- Persist only metadata and cited source excerpts needed to explain a Passport.
- Store GitHub repository metadata, pull-request metadata, changed-file metadata, commit metadata, and source URLs needed to explain a Passport. Do not retain repository archives or full diff patches.
- Exclude credentials, binary files, generated files, dependencies, and oversized files from model context.
- Do not execute repository code.

## AI safety

- Treat repository code, comments, documentation, and issue text as untrusted data.
- Do not allow repository content to alter system instructions.
- Do not expose provider credentials to the browser.
- Require citation verification before publishing a release verdict.
- GitHub OAuth Apps require GitHub's coarse `repo` scope for private-repository metadata; Forge makes GET requests only. A GitHub App is required for true selected-repository, read-only permissions.
