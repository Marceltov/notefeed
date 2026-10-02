import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE, feedPath, locked, sessionOk } from "@/backend";

// `feed` only on the writable pages; the read-only pages must never show it.
export async function Header({ feed, rss, image }: { feed?: string; rss?: string; image?: string | null }) {
  // Readers of /r/** on a locked instance have no session: no "Log out" for them.
  const loggedIn = locked() && sessionOk((await cookies()).get(SESSION_COOKIE)?.value);
  return (
    <header className="mb-8 flex items-baseline justify-between gap-4">
      {image && (
        // The feed's title image: decorative (the name is next to it), served by our own route.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="h-10 w-auto max-w-24 shrink-0 self-center rounded-sm object-contain" />
      )}
      <p className="mr-auto min-w-0 break-all text-xl font-bold tracking-tight">
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
