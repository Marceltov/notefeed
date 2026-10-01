"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { errorMessage } from "@/app/_lib/messages";
import { extractTitle, idStamp, slugify } from "@/shared/notes";

// A plain multipart form to POST /<feed>, the same endpoint scripts use. Without JavaScript the browser
// follows the 303 back to the feed page; with it, fetch() asks for JSON and errors show inline.
export function Compose({ action, error: initialError }: { action: string; error?: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState(initialError);
  const [pending, setPending] = useState(false);
  const filename = `${idStamp(new Date())}-${slugify(extractTitle(text))}.md`;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    try {
      const res = await fetch(action, { method: "POST", body: new FormData(e.currentTarget), headers: { Accept: "application/json" } });
      const body = await res.json().catch(() => ({}));
      if (res.ok) return router.push(`${action}?posted=${body.id}`); // the page remounts this box empty
      if (res.status === 401) return router.push(`/login?next=${encodeURIComponent(action)}`);
      setError(errorMessage(body.code ?? "unknown", res.headers.get("retry-after")));
    } catch {
      setError("Could not reach notefeed. Check your connection and try again.");
    }
    setPending(false);
  }

  return (
    <form method="post" action={action} encType="multipart/form-data" onSubmit={submit} className="mb-12">
      <label htmlFor="markdown" className="sr-only">
        Note in markdown
      </label>
      <textarea
        id="markdown"
        name="markdown"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
        }}
        rows={5}
        placeholder="# Write a note in markdown"
        aria-describedby="compose-hint compose-error"
        className="block w-full resize-y rounded-sm border border-rule bg-transparent p-3 text-ink placeholder:text-muted focus:border-carbon focus:outline-none"
      />
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <p id="compose-hint" className="min-w-0 break-all text-sm text-muted">
          {text.trim() && (
            <>
              Saves as <span className="font-mono text-carbon">{filename}</span>
            </>
          )}
        </p>
        <button
          type="submit"
          disabled={pending}
          className="rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon disabled:opacity-60"
        >
          {pending ? "Posting…" : "Post note"}
        </button>
      </div>
      <p id="compose-error" role="alert" className="mt-2 text-sm text-error">
        {error}
      </p>
    </form>
  );
}
