import Link from "next/link";
import { safeNextPath } from "@/lib/navigation";
import { SignInForm } from "@/app/sign-in/sign-in-form";
import { ForgeMark } from "@/components/forge/forge-mark";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const nextPath = safeNextPath(next);

  return (
    <main className="sign-in-shell">
      <section className="sign-in-card" aria-labelledby="sign-in-title">
        <Link className="sign-in-brand" href="/" aria-label="Forge home">
          <ForgeMark />
        </Link>
        <p className="eyebrow">Secure workspace access</p>
        <h1 id="sign-in-title">Keep the decision<br /><em>with the evidence.</em></h1>
        <p>Sign in to open your private Forge workspace. Repository connection remains a separate, read-only step.</p>
        <SignInForm nextPath={nextPath} />
      </section>
    </main>
  );
}
