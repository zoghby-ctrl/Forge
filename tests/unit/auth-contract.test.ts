import { describe, expect, it } from "vitest";
import {
  magicLinkErrorMessage,
  passwordAuthErrorMessage,
  passwordAuthSchema,
} from "../../src/features/auth/magic-link-contract";

describe("password authentication contract", () => {
  it("accepts both password auth intents", () => {
    const base = { email: "demo@forge.test", password: "demo-password", next: "/workspace" };

    expect(passwordAuthSchema.safeParse({ ...base, intent: "sign-in" }).success).toBe(true);
    expect(passwordAuthSchema.safeParse({ ...base, intent: "sign-up" }).success).toBe(true);
  });

  it("returns safe, actionable messages for common Supabase auth errors", () => {
    expect(passwordAuthErrorMessage({ code: "invalid_credentials" }, "sign-in"))
      .toContain("email or password is incorrect");
    expect(passwordAuthErrorMessage({ code: "email_not_confirmed" }, "sign-in"))
      .toContain("waiting for email confirmation");
    expect(passwordAuthErrorMessage({ status: 429 }, "sign-in"))
      .toContain("Too many authentication attempts");
  });

  it("offers password sign-in when magic-link email delivery is rate limited", () => {
    expect(magicLinkErrorMessage({ code: "over_email_send_rate_limit" }))
      .toContain("use password sign-in");
  });
});
