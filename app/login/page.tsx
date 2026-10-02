import { redirect } from "next/navigation";
import { SENDER_NOTICE, errorMessage } from "@/app/_lib/messages";
import { identityOn, locked, passwordSet, signInProviders, safeNext } from "@/backend";

export const dynamic = "force-dynamic";

// A plain form: POST /login sets the session cookie and redirects to `next`, or back here with ?error=.
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error, retry } = await searchParams;
  if (!locked()) redirect(safeNext(next)); // an open instance has no password
  return (
    <main className="mt-[18vh]">
      <h1 className="mb-6 text-xl font-bold tracking-tight">notefeed</h1>
      {identityOn() && (
        <div className="mb-6 max-w-sm">
          <a
            href={`/api/oidc/start?next=${encodeURIComponent(safeNext(next))}`}
            className="inline-block rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon"
          >
            Sign in with {signInProviders()[0]?.label ?? ""}
          </a>
          <p className="mt-2 text-sm text-muted">{SENDER_NOTICE}</p>
        </div>
      )}
      {passwordSet() && (
        <form method="post" action="/login" className="max-w-sm">
          <input type="hidden" name="next" value={safeNext(next)} />
          <label htmlFor="password" className="mb-1 block text-sm text-muted">
            Password
          </label>
          <div className="flex gap-2">
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
              aria-describedby="login-error"
              aria-invalid={error ? true : undefined}
              className="min-w-0 flex-1 rounded-sm border border-rule bg-transparent px-3 py-1.5 focus:border-carbon focus:outline-none"
            />
            <button type="submit" className="rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon">
              Log in
            </button>
          </div>
          <p id="login-error" role="alert" className="mt-2 text-sm text-error">
            {errorMessage(error, retry)}
          </p>
        </form>
      )}
      {!passwordSet() && (
        <p id="login-error" role="alert" className="mt-2 text-sm text-error">
          {errorMessage(error, retry)}
        </p>
      )}
    </main>
  );
}
