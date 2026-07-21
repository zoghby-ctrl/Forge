import { z } from "zod";

export const magicLinkSchema = z.object({
  email: z.string().trim().email(),
  next: z.string().optional(),
});

export type MagicLinkState = {
  status: "idle" | "sent" | "error";
  message?: string;
};

export const initialMagicLinkState: MagicLinkState = { status: "idle" };

export type PasswordAuthIntent = "sign-in" | "sign-up";

export const passwordAuthSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(128),
  intent: z.enum(["sign-in", "sign-up"]),
  next: z.string().optional(),
});

export type PasswordAuthState = {
  status: "idle" | "success" | "error";
  message?: string;
};

export const initialPasswordAuthState: PasswordAuthState = { status: "idle" };

type SupabaseAuthErrorDetails = {
  code?: string;
  status?: number;
};

export function passwordAuthErrorMessage(
  error: SupabaseAuthErrorDetails,
  intent: PasswordAuthIntent,
) {
  if (error.code === "invalid_credentials") {
    return "That email or password is incorrect. Check both fields and try again.";
  }

  if (error.code === "email_not_confirmed") {
    return "This account is waiting for email confirmation. Use a confirmed demo account or ask an administrator to confirm it.";
  }

  if (
    error.status === 429
    || error.code === "over_email_send_rate_limit"
    || error.code === "over_request_rate_limit"
  ) {
    return "Too many authentication attempts were made. Wait a few minutes, then try again.";
  }

  if (error.code === "weak_password") {
    return "Choose a stronger password and try creating the account again.";
  }

  if (error.code === "email_provider_disabled" || error.code === "signup_disabled") {
    return "Password account creation is not enabled. Sign in with an existing confirmed demo account instead.";
  }

  if (error.code === "email_address_invalid") {
    return "Enter a valid email address that can be used for this account.";
  }

  if (error.code === "email_address_not_authorized") {
    return "The account could not be created because confirmation email delivery is unavailable. Use a confirmed demo account or ask an administrator for help.";
  }

  return intent === "sign-up"
    ? "Forge could not create that password account. Please try again or use a confirmed demo account."
    : "Forge could not sign in with that password. Please try again.";
}

export function magicLinkErrorMessage(error: SupabaseAuthErrorDetails) {
  if (
    error.status === 429
    || error.code === "over_email_send_rate_limit"
    || error.code === "over_request_rate_limit"
  ) {
    return "Too many sign-in emails were requested. Wait a few minutes, then try again or use password sign-in.";
  }

  return "Forge could not send that magic-link email. Try again or use password sign-in.";
}
