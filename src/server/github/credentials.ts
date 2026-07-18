import "server-only";

import { z } from "zod";
import { createGitHubAdminSupabaseClient } from "@/lib/supabase/github-admin";
import {
  decryptGitHubSecret,
  encryptGitHubSecret,
  hashGitHubOAuthState,
} from "@/server/github/crypto";
import { DataAccessError } from "@/server/api/errors";
import type { GitHubOAuthState } from "@/integrations/github/oauth";

// PostgREST serializes `timestamptz` values with an explicit UTC offset (for
// example `2026-07-17T19:44:31.228+00:00`). Accept that canonical database
// format as well as the `Z` form emitted by browser/server JavaScript.
const postgresTimestampSchema = z.string().datetime({ offset: true });

export const githubConnectionRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  github_user_id: z.string().min(1),
  github_login: z.string().min(1),
  access_token_ciphertext: z.string().min(1),
  token_type: z.string().min(1),
  granted_scopes: z.array(z.string()).default([]),
  token_expires_at: postgresTimestampSchema.nullable(),
  connected_at: postgresTimestampSchema,
  last_validated_at: postgresTimestampSchema,
  revoked_at: postgresTimestampSchema.nullable(),
});

export const githubOAuthStateRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  state_hash: z.string().min(1),
  code_verifier_ciphertext: z.string().min(1),
  expires_at: postgresTimestampSchema,
  used_at: postgresTimestampSchema.nullable(),
});

export type StoredGitHubConnection = z.infer<typeof githubConnectionRowSchema>;

function connectionAad(userId: string, connectionId: string) {
  return `forge:github-connection:${userId}:${connectionId}`;
}

function oauthStateAad(userId: string, stateId: string) {
  return `forge:github-oauth-state:${userId}:${stateId}`;
}

function throwForCredentialError(operation: string, error: { code?: string; message?: string } | null) {
  if (error) {
    throw new DataAccessError(operation);
  }
}

export async function persistGitHubOAuthState(state: GitHubOAuthState) {
  const supabase = createGitHubAdminSupabaseClient();
  const { error } = await supabase.from("github_oauth_states").insert({
    id: state.id,
    user_id: state.userId,
    state_hash: hashGitHubOAuthState(state.state),
    code_verifier_ciphertext: encryptGitHubSecret(state.codeVerifier, oauthStateAad(state.userId, state.id)),
    expires_at: state.expiresAt.toISOString(),
  });
  throwForCredentialError("start GitHub authorization", error);
}

export async function consumeGitHubOAuthState(input: {
  id: string;
  userId: string;
  state: string;
}) {
  const supabase = createGitHubAdminSupabaseClient();
  const { data, error } = await supabase
    .from("github_oauth_states")
    .update({ used_at: new Date().toISOString() })
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .eq("state_hash", hashGitHubOAuthState(input.state))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id, user_id, state_hash, code_verifier_ciphertext, expires_at, used_at")
    .maybeSingle();
  throwForCredentialError("validate GitHub authorization", error);

  if (!data) {
    return null;
  }

  return githubOAuthStateRowSchema.parse(data);
}

export function readGitHubOAuthCodeVerifier(state: z.infer<typeof githubOAuthStateRowSchema>) {
  return decryptGitHubSecret(
    state.code_verifier_ciphertext,
    oauthStateAad(state.user_id, state.id),
  );
}

export async function getGitHubConnectionForUser(userId: string) {
  const supabase = createGitHubAdminSupabaseClient();
  const { data, error } = await supabase
    .from("github_connections")
    .select("id, user_id, github_user_id, github_login, access_token_ciphertext, token_type, granted_scopes, token_expires_at, connected_at, last_validated_at, revoked_at")
    .eq("user_id", userId)
    .maybeSingle();
  throwForCredentialError("load your GitHub connection", error);

  return data ? githubConnectionRowSchema.parse(data) : null;
}

export async function saveGitHubConnection(input: {
  userId: string;
  githubUserId: string;
  githubLogin: string;
  accessToken: string;
  tokenType: string;
  scopes: string[];
  tokenExpiresAt?: string | null;
}) {
  const existing = await getGitHubConnectionForUser(input.userId);
  const id = existing?.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const supabase = createGitHubAdminSupabaseClient();
  const { error } = await supabase.from("github_connections").upsert(
    {
      id,
      user_id: input.userId,
      github_user_id: input.githubUserId,
      github_login: input.githubLogin,
      access_token_ciphertext: encryptGitHubSecret(input.accessToken, connectionAad(input.userId, id)),
      token_type: input.tokenType,
      granted_scopes: input.scopes,
      token_expires_at: input.tokenExpiresAt ?? null,
      connected_at: now,
      last_validated_at: now,
      revoked_at: null,
    },
    { onConflict: "user_id" },
  );
  throwForCredentialError("store your GitHub connection", error);
}

export function readGitHubAccessToken(connection: StoredGitHubConnection) {
  return decryptGitHubSecret(
    connection.access_token_ciphertext,
    connectionAad(connection.user_id, connection.id),
  );
}

export async function markGitHubConnectionRevoked(userId: string) {
  const supabase = createGitHubAdminSupabaseClient();
  const { error } = await supabase
    .from("github_connections")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId);
  throwForCredentialError("update your GitHub connection", error);
}

export async function deleteGitHubConnection(userId: string) {
  const supabase = createGitHubAdminSupabaseClient();
  const { error } = await supabase.from("github_connections").delete().eq("user_id", userId);
  throwForCredentialError("disconnect GitHub", error);
}
