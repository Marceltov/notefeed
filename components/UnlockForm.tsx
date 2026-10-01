// The feed password screen: a plain form, POST /<feed>/access sets the unlock cookie and returns to the feed.
export function UnlockForm({ feed, error }: { feed: string; error?: string }) {
  return (
    <main className="mt-[12vh]">
      <form method="post" action={`/${feed}/access`} className="max-w-sm">
        <input type="hidden" name="action" value="unlock" />
        <label htmlFor="feed-password" className="mb-1 block text-sm text-muted">
          Feed password
        </label>
        <div className="flex gap-2">
          <input
            id="feed-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            maxLength={256}
            aria-describedby="unlock-error"
            aria-invalid={error ? true : undefined}
            className="min-w-0 flex-1 rounded-sm border border-rule bg-transparent px-3 py-1.5 focus:border-carbon focus:outline-none"
          />
          <button type="submit" className="rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon">
            Unlock
          </button>
        </div>
        <p id="unlock-error" role="alert" className="mt-2 text-sm text-error">
          {error}
        </p>
      </form>
    </main>
  );
}
