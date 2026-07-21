"use client";

import { useActionState, useState } from "react";
import { authenticateWithPassword, requestMagicLink } from "@/app/sign-in/actions";
import {
  initialMagicLinkState,
  initialPasswordAuthState,
  type MagicLinkState,
  type PasswordAuthIntent,
  type PasswordAuthState,
} from "@/features/auth/magic-link-contract";

export function SignInForm({ nextPath }: { nextPath: string }) {
  const [mode, setMode] = useState<"magic" | PasswordAuthIntent>("magic");

  return (
    <div className="sign-in-auth">
      <div className="sign-in-modes" aria-label="Sign-in method">
        <button type="button" aria-pressed={mode === "magic"} onClick={() => setMode("magic")}>
          Continue with magic link
        </button>
        <button type="button" aria-pressed={mode === "sign-in"} onClick={() => setMode("sign-in")}>
          Continue with password
        </button>
        <button type="button" aria-pressed={mode === "sign-up"} onClick={() => setMode("sign-up")}>
          Create password account
        </button>
      </div>
      {mode === "magic" ? (
        <MagicLinkForm nextPath={nextPath} />
      ) : (
        <PasswordForm key={mode} intent={mode} nextPath={nextPath} />
      )}
    </div>
  );
}

function MagicLinkForm({ nextPath }: { nextPath: string }) {
  const [state, formAction, isPending] = useActionState<MagicLinkState, FormData>(
    requestMagicLink,
    initialMagicLinkState,
  );

  return (
    <form className="sign-in-form" action={formAction}>
      <input type="hidden" name="next" value={nextPath} />
      <label htmlFor="email">Work email</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        placeholder="you@company.com"
      />
      <button className="primary-action" type="submit" disabled={isPending || state.status === "sent"}>
        <span>{state.status === "sent" ? "Link sent" : isPending ? "Sending secure link" : "Continue securely"}</span>
        <span aria-hidden="true">↗</span>
      </button>
      <p className={`sign-in-message status-${state.status}`} aria-live="polite">
        {state.message ?? "We can email a passwordless sign-in link. No repository access is requested here."}
      </p>
    </form>
  );
}

function PasswordForm({
  intent,
  nextPath,
}: {
  intent: PasswordAuthIntent;
  nextPath: string;
}) {
  const [state, formAction, isPending] = useActionState<PasswordAuthState, FormData>(
    authenticateWithPassword,
    initialPasswordAuthState,
  );
  const isSignUp = intent === "sign-up";

  return (
    <form className="sign-in-form" action={formAction}>
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="next" value={nextPath} />
      <label htmlFor={`password-email-${intent}`}>Work email</label>
      <input
        id={`password-email-${intent}`}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        placeholder="you@company.com"
      />
      <label htmlFor={`password-${intent}`}>Password</label>
      <input
        id={`password-${intent}`}
        name="password"
        type="password"
        autoComplete={isSignUp ? "new-password" : "current-password"}
        minLength={isSignUp ? 6 : 1}
        maxLength={128}
        required
        placeholder={isSignUp ? "At least 6 characters" : "Your password"}
      />
      <button className="primary-action" type="submit" disabled={isPending || state.status === "success"}>
        <span>{isPending ? (isSignUp ? "Creating account" : "Signing in") : (isSignUp ? "Create password account" : "Continue with password")}</span>
        <span aria-hidden="true">↗</span>
      </button>
      <p className={`sign-in-message status-${state.status}`} aria-live="polite">
        {state.message ?? (isSignUp
          ? "Create an account for password access. Confirmation depends on the project’s Supabase settings."
          : "Use an existing confirmed account to sign in without waiting for email delivery.")}
      </p>
    </form>
  );
}
