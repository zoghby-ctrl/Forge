# Forge development roadmap

## Milestones

| Milestone | Outcome |
|---|---|
| 0. Deployable foundation | Deployed shell, quality checks, and shared contracts. |
| 1. Unforgettable demo surface | Full frozen UX with a deterministic payment-refund fixture. |
| 2. Real persistence | Supabase-backed user workspaces, Passports, evidence, decisions, and Decision Memory. |
| 3. Real GitHub project connection | GitHub OAuth repository connection and source synchronization. |
| 4. GPT-5.6 reasoning pipeline | Evidence-verified AI Passport generation against synchronized source. |
| 5. Real pull request review | Live pull request to durable Change Passport loop. |
| 6. Demo hardening | Security, reliability, tests, and submission quality. |

## Current implementation state

Milestone 3 is implemented. Forge authenticates with Supabase magic links, establishes a PKCE-protected GitHub OAuth connection, encrypts server-side credentials, reads real repositories and recent pull requests, and persists changed-file, commit, and diff metadata under RLS-protected project records. Change Passports are source records with an intentional `insufficient evidence` posture until Milestone 4 supplies approved behavioral-guarantee inference.

## Delivery rule

Every milestone must leave Forge runnable. Demo impact takes priority over infrastructure breadth.

## Scope guardrails

Do not add chat, code generation, PR comments, automatic merges, multi-repository support, team workspaces, vector search, drift scans, or agent avatars before the submission.
