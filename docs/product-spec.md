# Forge product specification

## Product definition

Forge is the decision memory for AI-built software. It protects a project’s System Guarantees by turning every meaningful code change into an evidence-backed Change Passport—and every human decision into durable engineering memory.

## Core job

Before a pull request is merged, Forge answers: **Can this change ship without violating a System Guarantee?**

## Frozen product flow

1. A user lands on Forge and connects one GitHub repository.
2. Forge reads repository metadata and recent pull-request source records from GitHub.
3. The user selects a meaningful change and inspects its changed files, commits, timestamps, and diff metadata.
4. Forge produces a source-backed Change Passport. Until a supported reasoning pipeline exists, its outcome is intentionally insufficient evidence rather than an inferred guarantee.
5. The user records a decision.
6. The confirmed decision becomes project memory for later reviews.

## Non-goals

- Coding assistant or chat interface
- Automated merge, deploy, or code modification
- Agent avatars or prompt theater
- General project-management system
- Enterprise multi-repository platform in the initial release
