// A plain GET form: the start page normalizes and checks the name, then redirects to /<name>.
// Works without JavaScript.
export function OpenFeed({ value, error }: { value: string; error?: string }) {
  return (
    <form method="get" action="/" className="mb-12">
      <label htmlFor="feed" className="mb-1 block text-sm text-muted">
        Feed name
      </label>
      <div className="flex gap-2">
        <input
          id="feed"
          name="feed"
          defaultValue={value}
          required
          autoFocus
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="feed-error"
          aria-invalid={error ? true : undefined}
          className="min-w-0 flex-1 rounded-sm border border-rule bg-transparent px-3 py-1.5 font-mono focus:border-carbon focus:outline-none"
        />
        <button type="submit" className="rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon">
          Open
        </button>
      </div>
      <p id="feed-error" role="alert" className="mt-2 text-sm text-error">
        {error}
      </p>
    </form>
  );
}
