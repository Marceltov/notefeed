"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/actions";

export function LoginForm({ next }: { next: string }) {
  const [error, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="max-w-sm">
      <input type="hidden" name="next" value={next} />
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
          className="min-w-0 flex-1 rounded-sm border border-rule bg-transparent px-3 py-1.5 focus:border-carbon focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon disabled:opacity-60"
        >
          Log in
        </button>
      </div>
      <p id="login-error" role="alert" className="mt-2 text-sm text-error">
        {error}
      </p>
    </form>
  );
}
