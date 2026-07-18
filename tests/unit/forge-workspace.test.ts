import { describe, expect, it } from "vitest";
import {
  forgeIdSchema,
  forgeWorkspaceSchema,
  recordDecisionSchema,
  stageRepairPathSchema,
  workspaceStageSchema,
} from "../../src/domain/forge-workspace";
import { safeNextPath } from "../../src/lib/navigation";

describe("Forge workspace contracts", () => {
  it("permits a human decision that matches a source Passport's verdict", () => {
    expect(recordDecisionSchema.safeParse({ action: "hold" }).success).toBe(true);
    expect(recordDecisionSchema.safeParse({ action: "insufficient_evidence" }).success).toBe(true);
    expect(recordDecisionSchema.safeParse({ action: "invented" }).success).toBe(false);
  });

  it("validates a repair path mutation without accepting extra state", () => {
    expect(stageRepairPathSchema.safeParse({ repairStaged: true }).success).toBe(true);
    expect(stageRepairPathSchema.safeParse({ repairStaged: "true" }).success).toBe(false);
  });

  it("allows only known client presentation stages", () => {
    expect(workspaceStageSchema.safeParse("passport").success).toBe(true);
    expect(workspaceStageSchema.safeParse("admin").success).toBe(false);
  });

  it("rejects malformed resource identifiers at the API boundary", () => {
    expect(forgeIdSchema.safeParse("c0a80101-0000-4000-8000-000000000001").success).toBe(true);
    expect(forgeIdSchema.safeParse("not-a-passport-id").success).toBe(false);
  });

  it("accepts explicit UTC offsets returned by Supabase timestamptz columns", () => {
    const timestamp = "2026-07-17T19:44:31.228+00:00";
    const result = forgeWorkspaceSchema.safeParse({
      project: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Forge",
        slug: "forge",
        status: "ready",
      },
      github: { status: "connected", login: "forge-user" },
      repositories: [{
        id: "22222222-2222-4222-8222-222222222222",
        projectId: "11111111-1111-4111-8111-111111111111",
        fullName: "forge/example",
        description: null,
        branch: "main",
        language: "TypeScript",
        openPullRequests: 0,
        owner: "forge",
        visibility: "private",
        lastActivityAt: timestamp,
        lastActivityLabel: "1d ago",
        htmlUrl: "https://github.com/forge/example",
      }],
      pullRequests: [],
      guarantees: [],
      passports: [],
    });

    expect(result.success).toBe(true);
  });
});

describe("safeNextPath", () => {
  it("allows internal destinations and rejects open redirects", () => {
    expect(safeNextPath("/?stage=oauth")).toBe("/?stage=oauth");
    expect(safeNextPath("//evil.example")).toBe("/?stage=oauth");
    expect(safeNextPath("/\\evil.example")).toBe("/?stage=oauth");
    expect(safeNextPath("https://evil.example")).toBe("/?stage=oauth");
  });
});
