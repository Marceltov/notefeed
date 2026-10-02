import { KeyRound, Lock } from "lucide-react";
import { heading } from "@/components/styles";
import { PASSWORD_HINT } from "@/app/_lib/messages";
import { PASSWORD_PATTERN } from "@/shared/password";

const input = "min-w-0 flex-1 rounded-sm border border-rule bg-transparent px-3 py-1.5 focus:border-carbon focus:outline-none";

// Shown on a protected feed once unlocked: plain forms to POST /<feed>/access.
export function FeedSettings({ feed, error }: { feed: string; error?: string }) {
  const action = `/${feed}/access`;
  return (
    <section aria-labelledby="access" className="text-sm">
      <h2 id="access" className={heading}>
        <KeyRound aria-hidden className="h-4 w-4" />
        Feed password
      </h2>
      <form method="post" action={action} className="max-w-sm">
        <label htmlFor="current-password" className="mb-1 block text-muted">
          Current password
        </label>
        <input id="current-password" name="current" type="password" autoComplete="current-password" required maxLength={256} className={`${input} mb-2 w-full`} />
        <label htmlFor="new-password" className="mb-1 block text-muted">
          New password
        </label>
        <div className="flex gap-2">
          <input
            id="new-password"
            name="next"
            type="password"
            autoComplete="new-password"
            required
            maxLength={256}
            pattern={PASSWORD_PATTERN}
            title={PASSWORD_HINT}
            aria-describedby="new-password-hint settings-error"
            className={input}
          />
          <button type="submit" name="action" value="change" className="rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon">
            Change
          </button>
        </div>
        <p id="new-password-hint" className="mt-1 text-muted">
          {PASSWORD_HINT}
        </p>
        <p id="settings-error" role="alert" className="mt-2 text-error">
          {error}
        </p>
        <button type="submit" name="action" value="remove" formNoValidate className="mt-1 text-muted hover:text-ink hover:underline">
          Remove password
        </button>
        <span className="ml-1 text-muted">(needs the current password)</span>
      </form>
      <form method="post" action={action} className="mt-3">
        <button type="submit" name="action" value="lock" className="inline-flex items-center gap-1.5 text-muted hover:text-ink hover:underline">
          <Lock aria-hidden className="h-4 w-4" />
          Lock this browser
        </button>
      </form>
    </section>
  );
}
