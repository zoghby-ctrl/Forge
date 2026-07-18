import { z } from "zod";
import { GitHubRestClient } from "@/integrations/github/client";

const githubRepositoryApiSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  full_name: z.string().min(1),
  private: z.boolean(),
  visibility: z.string().nullable().optional(),
  owner: z.object({
    login: z.string().min(1),
  }),
  description: z.string().nullable(),
  default_branch: z.string().min(1),
  language: z.string().nullable(),
  html_url: z.url(),
  updated_at: z.string().datetime(),
  pushed_at: z.string().datetime().nullable(),
});

export const githubRepositorySummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  fullName: z.string().min(1),
  owner: z.string().min(1),
  visibility: z.enum(["public", "private", "internal"]),
  description: z.string().nullable(),
  defaultBranch: z.string().min(1),
  language: z.string().nullable(),
  htmlUrl: z.url(),
  updatedAt: z.string().datetime(),
  lastActivityAt: z.string().datetime(),
});

export type GitHubRepositorySummary = z.infer<typeof githubRepositorySummarySchema>;

export function mapGitHubRepository(
  repository: z.infer<typeof githubRepositoryApiSchema>,
): GitHubRepositorySummary {
  const visibility = repository.visibility === "internal"
    ? "internal"
    : repository.private
      ? "private"
      : "public";

  return githubRepositorySummarySchema.parse({
    id: String(repository.id),
    name: repository.name,
    fullName: repository.full_name,
    owner: repository.owner.login,
    visibility,
    description: repository.description,
    defaultBranch: repository.default_branch,
    language: repository.language,
    htmlUrl: repository.html_url,
    updatedAt: repository.updated_at,
    lastActivityAt: repository.pushed_at ?? repository.updated_at,
  });
}

function nextPagePath(linkHeader: string | null) {
  const nextLink = linkHeader?.split(",").find((link) => /rel="next"/.test(link));
  const match = nextLink?.match(/<([^>]+)>/);
  return match?.[1] ?? null;
}

export async function listGitHubRepositories(client: GitHubRestClient) {
  const repositories: GitHubRepositorySummary[] = [];
  let nextPath: string | null = "/user/repos?affiliation=owner%2Ccollaborator%2Corganization_member&sort=updated&direction=desc&per_page=100";
  let page = 0;

  while (nextPath && page < 10) {
    const response = await client.get(nextPath, z.array(githubRepositoryApiSchema));
    repositories.push(...response.data.map(mapGitHubRepository));
    nextPath = nextPagePath(response.headers.get("link"));
    page += 1;
  }

  return repositories;
}

export async function getGitHubRepository(
  client: GitHubRestClient,
  owner: string,
  name: string,
) {
  const response = await client.get(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    githubRepositoryApiSchema,
  );

  return mapGitHubRepository(response.data);
}
