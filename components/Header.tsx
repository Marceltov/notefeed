import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE, feedPath, locked, sessionOk } from "@/backend";

// `feed` only on the writable pages; the read-only pages must never show it.
export async function Header({ feed, rss }: { feed?: string; rss?: string }) {
  // Readers of /r/** on a locked instance have no session: no "Log out" for them.
  const loggedIn = locked() && sessionOk((await cookies()).get(SESSION_COOKIE)?.value);
  return (
    <header className="mb-8 flex items-baseline justify-between gap-4">
      <p className="min-w-0 break-all text-xl font-bold tracking-tight">
        <Link href="/">notefeed</Link>
        {feed && (
          <>
            <span className="text-muted"> / </span>
            <Link href={feedPath(feed)} className="text-carbon">
              {feed}
            </Link>
          </>
        )}
      </p>
      <nav className="flex shrink-0 items-baseline gap-5 text-sm">
        {rss && (
          <a href={rss} className="text-carbon hover:underline">
            RSS
          </a>
        )}
        {loggedIn && (
          <form method="post" action="/logout">
            <button type="submit" className="text-muted hover:text-ink hover:underline">
              Log out
            </button>
          </form>
        )}
      </nav>
    </header>
  );
}
