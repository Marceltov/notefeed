const input = "min-w-0 flex-1 rounded-sm border border-rule bg-transparent px-3 py-1.5 focus:border-carbon focus:outline-none";

// Shown on a protected feed once unlocked: plain forms to POST /<feed>/access.
export function FeedSettings({ feed, error }: { feed: string; error?: string }) {
  const action = `/${feed}/access`;
  return (
    <details className="mb-10 text-sm" open={error ? true : undefined}>
      <summary className="cursor-pointer select-none text-muted hover:text-ink">Feed password</summary>
      <form method="post" action={action} className="mt-3 max-w-sm">
        <label htmlFor="current-password" className="mb-1 block text-muted">
          Current password
        </label>
        <input id="current-password" name="current" type="password" autoComplete="current-password" required maxLength={256} className={`${input} mb-2 w-full`} />
        <label htmlFor="new-password" className="mb-1 block text-muted">
          New password
        </label>
        <div className="flex gap-2">
          <input id="new-password" name="next" type="password" autoComplete="new-password" required maxLength={256} aria-describedby="settings-error" className={input} />
          <button type="submit" name="action" value="change" className="rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon">
            Change
          </button>
        </div>
        <p id="settings-error" role="alert" className="mt-2 text-error">
          {error}
        </p>
        <button type="submit" name="action" value="remove" formNoValidate className="mt-1 text-muted hover:text-ink hover:underline">
          Remove password
        </button>
        <span className="ml-1 text-muted">(needs the current password)</span>
      </form>
      <form method="post" action={action} className="mt-3">
        <button type="submit" name="action" value="lock" className="text-muted hover:text-ink hover:underline">
          Lock
        </button>
      </form>
    </details>
  );
}
