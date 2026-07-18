import { describe, expect, it } from "vitest";
import {
  githubConnectionRowSchema,
  githubOAuthStateRowSchema,
} from "@/server/github/credentials";

const userId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";

describe("GitHub credential database parsing", () => {
  it("accepts the explicit UTC offsets returned by Supabase timestamptz columns", () => {
    const timestamp = "2026-07-17T19:44:31.228+00:00";

    expect(githubOAuthStateRowSchema.safeParse({
      id: connectionId,
      user_id: userId,
      state_hash: "state-hash",
      code_verifier_ciphertext: "v1.iv.tag.ciphertext",
      expires_at: timestamp,
      used_at: timestamp,
    }).success).toBe(true);

    expect(githubConnectionRowSchema.safeParse({
      id: connectionId,
      user_id: userId,
      github_user_id: "1234",
      github_login: "forge-user",
      access_token_ciphertext: "v1.iv.tag.ciphertext",
      token_type: "bearer",
      granted_scopes: ["repo"],
      token_expires_at: null,
      connected_at: timestamp,
      last_validated_at: timestamp,
      revoked_at: null,
    }).success).toBe(true);
  });
});
