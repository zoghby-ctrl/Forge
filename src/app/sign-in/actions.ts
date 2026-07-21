"use server";

import { redirect } from "next/navigation";
import {
  magicLinkErrorMessage,
  magicLinkSchema,
  passwordAuthErrorMessage,
  passwordAuthSchema,
  type MagicLinkState,
  type PasswordAuthState,
} from "@/features/auth/magic-link-contract";
import { getPublicEnvironment } from "@/lib/env";
import { safeNextPath } from "@/lib/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { logError } from "@/server/observability/logger";

type AuthErrorDetails = {
  name: string;
  message: string;
  code?: string;
  status?: number;
};

function logAuthError(
  stage: "magic_link" | "password_sign_in" | "password_sign_up",
  error: AuthErrorDetails,
) {
  logError("Supabase auth operation failed", {
    authStage: stage,
    authStatus: error.status,
    errorName: error.name,
    errorCode: error.code,
    authErrorMessage: error.message,
  });
}

export async function requestMagicLink(
  _previousState: MagicLinkState,
  formData: FormData,
): Promise<MagicLinkState> {
  const parsed = magicLinkSchema.safeParse({
    email: formData.get("email"),
    next: formData.get("next"),
  });

  if (!parsed.success) {
    return { status: "error", message: "Enter a valid email address." };
  }

  try {
    const environment = getPublicEnvironment();
    const nextPath = safeNextPath(parsed.data.next);
    const callbackUrl = new URL("/auth/callback", environment.NEXT_PUBLIC_APP_URL);
    callbackUrl.searchParams.set("next", nextPath);

    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data.email,
      options: {
        emailRedirectTo: callbackUrl.toString(),
        shouldCreateUser: true,
      },
    });

    if (error) {
      logAuthError("magic_link", error);
      return { status: "error", message: magicLinkErrorMessage(error) };
    }

    return {
      status: "sent",
      message: "Check your email for a secure sign-in link.",
    };
  } catch (error) {
    logError("Supabase magic-link configuration failed", {
      authStage: "magic_link",
      errorName: error instanceof Error ? error.name : "UnknownError",
      authErrorMessage: error instanceof Error ? error.message : "Unknown authentication error",
    });
    return {
      status: "error",
      message: "Forge sign-in is not configured yet. Ask an administrator to complete the Supabase setup.",
    };
  }
}

export async function authenticateWithPassword(
  _previousState: PasswordAuthState,
  formData: FormData,
): Promise<PasswordAuthState> {
  const parsed = passwordAuthSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    intent: formData.get("intent"),
    next: formData.get("next"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Enter a valid email address and a password of no more than 128 characters.",
    };
  }

  const { email, password, intent } = parsed.data;
  const nextPath = safeNextPath(parsed.data.next);
  const authStage = intent === "sign-up" ? "password_sign_up" : "password_sign_in";
  let authenticated = false;

  try {
    const supabase = await createServerSupabaseClient();

    if (intent === "sign-in") {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        logAuthError(authStage, error);
        return { status: "error", message: passwordAuthErrorMessage(error, intent) };
      }

      authenticated = Boolean(data.session);
    } else {
      const environment = getPublicEnvironment();
      const callbackUrl = new URL("/auth/callback", environment.NEXT_PUBLIC_APP_URL);
      callbackUrl.searchParams.set("next", nextPath);
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: callbackUrl.toString() },
      });

      if (error) {
        logAuthError(authStage, error);
        return { status: "error", message: passwordAuthErrorMessage(error, intent) };
      }

      authenticated = Boolean(data.session);

      if (!authenticated) {
        return {
          status: "success",
          message: "The account was created, but this project requires email confirmation before password sign-in. For the demo, use a confirmed account or ask an administrator to confirm this one.",
        };
      }
    }
  } catch (error) {
    logError("Supabase password authentication could not start", {
      authStage,
      errorName: error instanceof Error ? error.name : "UnknownError",
      authErrorMessage: error instanceof Error ? error.message : "Unknown authentication error",
    });
    return {
      status: "error",
      message: "Password authentication is not configured. Ask an administrator to check the Supabase setup.",
    };
  }

  if (authenticated) {
    redirect(nextPath);
  }

  return {
    status: "error",
    message: "Forge did not receive a valid session. Please try again.",
  };
}
