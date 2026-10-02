import Link from "next/link";
import { cookies } from "next/headers";
import { ChevronRight, Eye, LogOut, Rss, Settings } from "lucide-react";
import { SESSION_COOKIE, feedPath, locked, sessionOk } from "@/backend";

const action = "inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-muted hover:bg-rule/50 hover:text-ink";
const icon = "h-4 w-4 shrink-0";
// The words go on wide screens; the icon alone is enough on a phone, and the link keeps its name for screen readers.
const label = "hidden sm:inline";

// `feed` only on the writable pages; the read-only pages must never show it. `view` and `settingsHref` are the
// writable feed page's links to its read-only view and its settings page (none on the settings page itself).
export async function Header({ feed, rss, image, view, settingsHref }: { feed?: string; rss?: string; image?: string | null; view?: string; settingsHref?: string }) {
  // Readers of /r/** on a locked instance have no session: no "Log out" for them.
  const loggedIn = locked() && sessionOk((await cookies()).get(SESSION_COOKIE)?.value);
  return (
    <header className="mb-8 flex items-center justify-between gap-3">
      {image && (
        // The feed's title image: decorative (the name is next to it), served by our own route.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="h-10 w-auto max-w-24 shrink-0 self-center rounded-sm object-contain" />
      )}
      <nav aria-label="Breadcrumb" className="mr-auto flex min-w-0 items-center gap-1.5 text-xl font-bold tracking-tight">
        <Link href="/" className="inline-flex shrink-0 items-center gap-2" aria-label="notefeed home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="h-7 w-7" />
          <span className={feed ? "sr-only sm:not-sr-only" : undefined}>notefeed</span>
        </Link>
        {feed && (
          <>
            <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-muted" />
            <Link href={feedPath(feed)} className="min-w-0 truncate text-carbon">
              {feed}
            </Link>
          </>
        )}
      </nav>
      <div className="flex shrink-0 items-center gap-1 text-sm">
        {view && (
          <Link href={view} className={action} aria-label="Open read-only view" title="Open read-only view">
            <Eye aria-hidden className={icon} />
            <span className={label}>Read-only</span>
          </Link>
        )}
        {rss && (
          <a href={rss} className={action} aria-label="RSS" title="RSS feed">
            <Rss aria-hidden className={icon} />
            <span className={label}>RSS</span>
          </a>
        )}
        {settingsHref && (
          <Link href={settingsHref} className={action} aria-label="Settings" title="Feed settings">
            <Settings aria-hidden className={icon} />
            <span className={label}>Settings</span>
          </Link>
        )}
        {loggedIn && (
          <form method="post" action="/logout">
            <button type="submit" className={action} aria-label="Log out" title="Log out">
              <LogOut aria-hidden className={icon} />
              <span className={label}>Log out</span>
            </button>
          </form>
        )}
      </div>
    </header>
  );
}
