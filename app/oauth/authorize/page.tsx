import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SENDER_NOTICE, errorMessage } from "@/app/_lib/messages";
import { checkAuthorize, identityOn, locked, passwordSet, providerName } from "@/backend";

export const dynamic = "force-dynamic";

// The OAuth login: the instance password lets an MCP client in. The form posts to /api/oauth/authorize,
// which redirects back to the client with a code, or back here with ?error=.
export default async function AuthorizePage({ searchParams }: PageProps<"/oauth/authorize">) {
  if (!locked()) notFound();
  const { error, retry, ...rest } = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(rest)) for (const one of [v ?? []].flat()) params.append(k, one);
  const checked = checkAuthorize(params, await headers());
  if (checked.kind === "redirect") redirect(checked.location);
  if (checked.kind === "error")
    return (
      <main className="mt-[18vh]">
        <h1 className="mb-6 text-xl font-bold tracking-tight">notefeed</h1>
        <p role="alert" className="text-error">
          {checked.message}
        </p>
      </main>
    );
  return (
    <main className="mt-[18vh]">
      <h1 className="mb-2 text-xl font-bold tracking-tight">Connect {checked.clientName}</h1>
      <p className="mb-6 text-muted">After login you&apos;ll be sent to {checked.redirectHost}.</p>
      {identityOn() && (
        // A form POST, not a link: a cross-site GET must never start an MCP sign-in.
        <form method="post" action="/api/oidc/start" className="mb-6 max-w-sm">
          {Object.entries(checked.fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <button type="submit" className="rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon">
            Sign in with {providerName()}
          </button>
          <p className="mt-2 text-sm text-muted">{SENDER_NOTICE}</p>
        </form>
      )}
      {passwordSet() && (
        <form method="post" action="/api/oauth/authorize" className="max-w-sm">
          {Object.entries(checked.fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
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
              Allow
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
