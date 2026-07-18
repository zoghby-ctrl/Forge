import {
  githubPullRequestCommitsResponse,
  githubPullRequestDiffResponse,
  githubPullRequestDetailResponse,
  githubPullRequestFilesResponse,
  githubPullRequestListResponse,
  githubRepositoryResponse,
} from "./github-responses";

export function createMockGitHubFetch() {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = `${url.pathname}${url.search}`;

    if (path.startsWith("/user/repos")) {
      return Response.json([githubRepositoryResponse]);
    }
    if (path === "/repos/acme/forge-api") {
      return Response.json(githubRepositoryResponse);
    }
    if (path.startsWith("/repos/acme/forge-api/pulls?") && !path.includes("/files") && !path.includes("/commits")) {
      return Response.json(githubPullRequestListResponse);
    }
    if (path === "/repos/acme/forge-api/pulls/42") {
      const accept = new Headers(init?.headers).get("accept");
      if (accept === "application/vnd.github.diff") {
        return new Response(githubPullRequestDiffResponse, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      return Response.json(githubPullRequestDetailResponse);
    }
    if (path.startsWith("/repos/acme/forge-api/pulls/42/files")) {
      return Response.json(githubPullRequestFilesResponse);
    }
    if (path.startsWith("/repos/acme/forge-api/pulls/42/commits")) {
      return Response.json(githubPullRequestCommitsResponse);
    }

    return Response.json({ message: "Not Found" }, { status: 404 });
  };
}
