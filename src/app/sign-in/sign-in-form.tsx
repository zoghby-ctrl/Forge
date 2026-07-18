"use client";

import { useActionState } from "react";
import { requestMagicLink } from "@/app/sign-in/actions";
import {
  initialMagicLinkState,
  type MagicLinkState,
} from "@/features/auth/magic-link-contract";

export function SignInForm({ nextPath }: { nextPath: string }) {
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
        {state.message ?? "We use a passwordless sign-in link. No repository access is requested here."}
      </p>
    </form>
  );
}
