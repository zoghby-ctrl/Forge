export const githubRepositoryResponse = {
  id: 410001,
  name: "forge-api",
  full_name: "acme/forge-api",
  private: true,
  visibility: "private",
  owner: { login: "acme" },
  description: "The Forge API service.",
  default_branch: "main",
  language: "TypeScript",
  html_url: "https://github.com/acme/forge-api",
  updated_at: "2026-07-17T12:15:00Z",
  pushed_at: "2026-07-17T12:10:00Z",
};

export const githubPullRequestListResponse = [{ number: 42 }];

export const githubPullRequestDetailResponse = {
  id: 808042,
  number: 42,
  title: "Preserve callback state",
  body: "Reject callback requests whose returned OAuth state does not match the stored state.",
  state: "open",
  draft: false,
  user: { login: "sam-engineer" },
  base: { ref: "main", sha: "1111111111111111111111111111111111111111" },
  head: { ref: "fix/callback-state", sha: "2222222222222222222222222222222222222222" },
  changed_files: 2,
  additions: 28,
  deletions: 4,
  commits: 2,
  created_at: "2026-07-16T08:30:00Z",
  updated_at: "2026-07-17T12:00:00Z",
  closed_at: null,
  merged_at: null,
  html_url: "https://github.com/acme/forge-api/pull/42",
};

export const githubPullRequestFilesResponse = [
  {
    sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    filename: "src/auth/callback.ts",
    status: "modified",
    additions: 20,
    deletions: 3,
    changes: 23,
    previous_filename: null,
    blob_url: "https://github.com/acme/forge-api/blob/2222222222222222222222222222222222222222/src/auth/callback.ts",
    patch: "@@ -12,6 +12,16 @@ export async function callback(request: Request) {\n+  if (returnedState !== storedState) {\n+    return Response.json({ error: 'invalid_state' }, { status: 400 });\n+  }\n",
  },
  {
    sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    filename: "src/auth/callback.test.ts",
    status: "added",
    additions: 8,
    deletions: 1,
    changes: 9,
    previous_filename: null,
    blob_url: "https://github.com/acme/forge-api/blob/2222222222222222222222222222222222222222/src/auth/callback.test.ts",
    patch: "@@ -0,0 +1,8 @@\n+it('rejects a callback with mismatched state', async () => {\n+  expect(response.status).toBe(400);\n+});\n",
  },
];

export const githubPullRequestDiffResponse = `diff --git a/src/auth/callback.ts b/src/auth/callback.ts
index 1111111..aaaaaaaa 100644
--- a/src/auth/callback.ts
+++ b/src/auth/callback.ts
@@ -12,6 +12,16 @@ export async function callback(request: Request) {
+  if (returnedState !== storedState) {
+    return Response.json({ error: 'invalid_state' }, { status: 400 });
+  }
 }
diff --git a/src/auth/callback.test.ts b/src/auth/callback.test.ts
new file mode 100644
--- /dev/null
+++ b/src/auth/callback.test.ts
@@ -0,0 +1,8 @@
+it('rejects a callback with mismatched state', async () => {
+  expect(response.status).toBe(400);
+});
`;

export const githubPullRequestCommitsResponse = [
  {
    sha: "cccccccccccccccccccccccccccccccccccccccc",
    html_url: "https://github.com/acme/forge-api/commit/cccccccccccccccccccccccccccccccccccccccc",
    author: { login: "sam-engineer" },
    commit: {
      message: "Validate callback state\n\nReject mismatched authorization state.",
      author: { name: "Sam Engineer", date: "2026-07-16T08:30:00Z" },
      committer: { name: "Sam Engineer", date: "2026-07-16T08:31:00Z" },
    },
  },
  {
    sha: "dddddddddddddddddddddddddddddddddddddddd",
    html_url: "https://github.com/acme/forge-api/commit/dddddddddddddddddddddddddddddddddddddddd",
    author: { login: "sam-engineer" },
    commit: {
      message: "Cover authorization replay",
      author: { name: "Sam Engineer", date: "2026-07-17T11:45:00Z" },
      committer: { name: "Sam Engineer", date: "2026-07-17T11:46:00Z" },
    },
  },
];
