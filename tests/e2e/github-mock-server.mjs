import { createServer } from "node:http";

const port = Number(process.env.FORGE_E2E_GITHUB_MOCK_PORT ?? 4010);
const origin = `http://127.0.0.1:${port}`;

const repository = {
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

const pullRequest = {
  id: 808042,
  number: 42,
  title: "Preserve callback state",
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

const changedFiles = [
  {
    sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    filename: "src/auth/callback.ts",
    status: "modified",
    additions: 20,
    deletions: 3,
    changes: 23,
    previous_filename: null,
    blob_url: "https://github.com/acme/forge-api/blob/2222222222222222222222222222222222222222/src/auth/callback.ts",
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
  },
];

const commits = [
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

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", origin);
  const path = url.pathname;

  if (path === "/health") {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("ok");
    return;
  }

  if (request.method === "GET" && path === "/login/oauth/authorize") {
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state");
    if (!redirectUri || !state) {
      json(response, 400, { error: "invalid_request" });
      return;
    }
    const callback = new URL(redirectUri);
    callback.searchParams.set("code", "forge-e2e-authorization-code");
    callback.searchParams.set("state", state);
    response.writeHead(302, { Location: callback.toString() });
    response.end();
    return;
  }

  if (request.method === "POST" && path === "/login/oauth/access_token") {
    json(response, 200, { access_token: "gho_forge_e2e_server_only", token_type: "bearer", scope: "repo" });
    return;
  }

  if (request.method === "DELETE" && /^\/applications\/[^/]+\/grant$/.test(path)) {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && path === "/user") {
    json(response, 200, { id: 9001, login: "forge-e2e" });
    return;
  }
  if (request.method === "GET" && path === "/user/repos") {
    json(response, 200, [repository]);
    return;
  }
  if (request.method === "GET" && path === "/repos/acme/forge-api") {
    json(response, 200, repository);
    return;
  }
  if (request.method === "GET" && path === "/repos/acme/forge-api/pulls") {
    json(response, 200, [{ number: 42 }]);
    return;
  }
  if (request.method === "GET" && path === "/repos/acme/forge-api/pulls/42") {
    json(response, 200, pullRequest);
    return;
  }
  if (request.method === "GET" && path === "/repos/acme/forge-api/pulls/42/files") {
    json(response, 200, changedFiles);
    return;
  }
  if (request.method === "GET" && path === "/repos/acme/forge-api/pulls/42/commits") {
    json(response, 200, commits);
    return;
  }

  json(response, 404, { message: "Not Found" });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Forge E2E GitHub mock listening on ${origin}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
