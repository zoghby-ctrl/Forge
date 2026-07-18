# Forge demo runbook

## Story

Forge establishes a real GitHub connection, reads a repository's recent pull requests, and turns the selected pull request into an inspectable source record. It does not claim a behavioral guarantee until the future reasoning milestone can support that claim.

## Demo flow

1. State the premise: engineering decisions need source custody before they need confidence.
2. Connect GitHub and complete the OAuth authorization.
3. Choose a repository from the real repository picker.
4. Observe “Reading repository history” while Forge stores recent PR, changed-file, and commit metadata.
5. Open a real pull request and inspect its branch SHAs, diff totals, file paths, and commits in the Change Passport.
6. Observe the intentional `insufficient evidence` posture: no behavioral guarantee has been fabricated.
7. Record the human evidence posture or stage a follow-up without writing anything to GitHub.

## Success criteria

- The demo completes in under three minutes.
- The Passport contains real GitHub source records, not generic warnings or seeded data.
- The user action is clearly a recorded engineering decision, not a merge.
- Disconnecting GitHub revokes the OAuth grant and removes the local credential.
