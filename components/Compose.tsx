"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { postNote } from "@/app/_lib/api";
import { errorMessage } from "@/app/_lib/messages";
import { extractTitle, idStamp, slugify } from "@/shared/notes";

// A plain multipart form to POST /<feed>, the same endpoint scripts use: without JavaScript the browser
// follows the 303 back to the feed page. With JavaScript the box posts through the API client generated
// from openapi.json (JSON, the session cookie rides along same-origin) and shows refusals inline.
export function Compose({ feed, action, error: initialError }: { feed: string; action: string; error?: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState(initialError);
  const [pending, setPending] = useState(false);
  const filename = `${idStamp(new Date())}-${slugify(extractTitle(text))}.md`;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    try {
      // baseUrl: this page's origin, not the spec's default server.
      const { data, error, response } = await postNote({ baseUrl: window.location.origin, path: { feed }, body: { markdown: text } });
      // The generated client returns a network failure instead of throwing it: no response at all.
      if (!response) throw new Error("no response");
      if (data) return router.push(`${action}?posted=${data.id}`); // the page remounts this box empty
      if (response?.status === 401) return router.push(`/login?next=${encodeURIComponent(action)}`);
      setError(errorMessage(error?.code ?? "unknown", response?.headers.get("retry-after")));
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
