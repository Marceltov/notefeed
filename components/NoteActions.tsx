"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { deleteNote, editNote } from "@/app/_lib/api";
import { errorMessage } from "@/app/_lib/messages";

const summary = "cursor-pointer select-none text-muted hover:text-ink";

// Edit and delete for a note: plain forms to POST /<feed>/<id>/edit and /delete. With JavaScript they go
// through the generated API client and show refusals inline; without, the browser follows the 303 and the
// note page shows the outcome (`error` is its message).
export function NoteActions({ feed, id, markdown, error: initialError }: { feed: string; id: string; markdown: string; error?: string }) {
  const router = useRouter();
  const [text, setText] = useState(markdown);
  const [editing, setEditing] = useState(!!initialError);
  const [error, setError] = useState(initialError);
  const [pending, setPending] = useState(false);
  const page = `/${feed}`;
  const base = `${page}/${id}`;

  // Runs `call`, which returns the response, and `done` on success; a 401 goes to the feed page, which
  // shows its unlock form (or proxy.ts sends a missing instance login on to /login).
  async function run(e: FormEvent, call: () => Promise<{ error?: { code?: string }; response?: Response }>, done: () => void) {
    e.preventDefault();
    setPending(true);
    try {
      const { error, response } = await call();
      if (!response) throw new Error("no response"); // the client returns a network failure instead of throwing it
      if (response.ok) return done();
      if (response.status === 401) return router.push(page);
      setError(errorMessage(error?.code ?? "unknown", response.headers.get("retry-after")));
    } catch {
      setError("Could not reach notefeed. Check your connection and try again.");
    }
    setPending(false);
  }

  const opts = () => ({ baseUrl: window.location.origin, path: { feed, id } }); // in handlers only: no window while rendering on the server
  const save = (e: FormEvent) =>
    run(e, () => editNote({ ...opts(), body: { markdown: text } }), () => {
      setError(undefined);
      setEditing(false);
      setPending(false);
      router.replace(`${base}?edited=1`);
      router.refresh();
    });
  const remove = (e: FormEvent) => run(e, () => deleteNote(opts()), () => router.push(`${page}?deleted=${id}`));

  return (
    <section aria-label="Edit or delete this note" className="mt-8 space-y-3 text-sm">
      <details open={editing} onToggle={(e) => setEditing(e.currentTarget.open)}>
        <summary className={summary}>Edit</summary>
        <form method="post" action={`${base}/edit`} onSubmit={save} className="mt-3">
          <label htmlFor="edit-markdown" className="sr-only">
            Note in markdown
          </label>
          <textarea
            id="edit-markdown"
            name="markdown"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            aria-describedby="note-actions-error"
            className="block w-full resize-y rounded-sm border border-rule bg-transparent p-3 font-mono text-ink focus:border-carbon focus:outline-none"
          />
          <button type="submit" disabled={pending} className="mt-2 rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon disabled:opacity-60">
            {pending ? "Saving…" : "Save"}
          </button>
        </form>
      </details>
      <details>
        <summary className={summary}>Delete</summary>
        <form method="post" action={`${base}/delete`} onSubmit={remove} className="mt-3">
          <p className="text-muted">Delete this note? This can&apos;t be undone.</p>
          <button type="submit" disabled={pending} className="mt-2 rounded-sm border border-error px-4 py-1.5 font-bold text-error disabled:opacity-60">
            Delete note
          </button>
        </form>
      </details>
      <p id="note-actions-error" role="alert" className="text-error">
        {error}
      </p>
    </section>
  );
}
