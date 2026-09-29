import Link from "next/link";

export function Header() {
  return (
    <header className="mb-8 flex items-baseline justify-between gap-4">
      <Link href="/" className="text-xl font-bold tracking-tight">
        notefeed
      </Link>
      <nav className="flex items-baseline gap-5 text-sm">
        <a href="/feed.xml" className="text-carbon hover:underline">
          Feed
        </a>
        <form method="post" action="/logout">
          <button type="submit" className="text-muted hover:text-ink hover:underline">
            Log out
          </button>
        </form>
      </nav>
    </header>
  );
}
