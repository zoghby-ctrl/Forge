import { z } from "zod";

export const githubApiVersion = "2022-11-28";

export class GitHubApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: "unauthorized" | "forbidden" | "rate_limited" | "invalid_response" | "request_failed",
    public readonly responseBody: string | null = null,
  ) {
    super("GitHub could not complete this repository request.");
    this.name = "GitHubApiError";
  }
}

export type GitHubApiResponse<T> = {
  data: T;
  headers: Headers;
};

export class GitHubRestClient {
  private readonly baseUrl: URL;

  constructor(
    private readonly accessToken: string,
    baseUrl = "https://api.github.com",
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.baseUrl = new URL(baseUrl);
  }

  private async request(path: string, accept: string): Promise<Response> {
    const requestUrl = new URL(path, this.baseUrl);
    if (requestUrl.origin !== this.baseUrl.origin) {
      throw new GitHubApiError(400, "request_failed");
    }

    let response: Response;
    try {
      response = await this.fetcher(requestUrl, {
        method: "GET",
        headers: {
          Accept: accept,
          Authorization: `Bearer ${this.accessToken}`,
          "X-GitHub-Api-Version": githubApiVersion,
          "User-Agent": "Forge-GitHub-Integration",
        },
        cache: "no-store",
      });
    } catch {
      throw new GitHubApiError(502, "request_failed");
    }

    if (!response.ok) {
      const responseBody = await response.text().catch(() => null);
      const remaining = response.headers.get("x-ratelimit-remaining");
      if (response.status === 401) {
        throw new GitHubApiError(response.status, "unauthorized", responseBody);
      }
      if (response.status === 403 && remaining === "0") {
        throw new GitHubApiError(response.status, "rate_limited", responseBody);
      }
      if (response.status === 403) {
        throw new GitHubApiError(response.status, "forbidden", responseBody);
      }
      throw new GitHubApiError(response.status, "request_failed", responseBody);
    }

    return response;
  }

  async get<T>(path: string, schema: z.ZodType<T>): Promise<GitHubApiResponse<T>> {
    const response = await this.request(path, "application/vnd.github+json");

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new GitHubApiError(response.status, "invalid_response");
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new GitHubApiError(response.status, "invalid_response");
    }

    return { data: parsed.data, headers: response.headers };
  }

  async getText(path: string, accept = "application/vnd.github.diff"): Promise<GitHubApiResponse<string>> {
    const response = await this.request(path, accept);

    let payload: string;
    try {
      payload = await response.text();
    } catch {
      throw new GitHubApiError(response.status, "invalid_response");
    }

    return { data: payload, headers: response.headers };
  }
}
