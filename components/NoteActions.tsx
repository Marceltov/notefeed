"use client";

import { useState, type FormEvent } from "react";
import { deleteNote, editNote } from "@/app/_lib/api";
import { MarkdownInput } from "@/components/MarkdownInput";
import { usePendingImages } from "@/components/usePendingImages";
import { useApiForm } from "@/app/_lib/useApiForm";

const summary = "cursor-pointer select-none text-muted hover:text-ink";

// Edit and delete for a note: plain forms to POST /<feed>/<id>/edit and /delete. With JavaScript they go
// through the generated API client and show refusals inline; without, the browser follows the 303 and the
// note page shows the outcome (`error` is its message).
export function NoteActions({ feed, id, kind, markdown, error: initialError }: { feed: string; id: string; kind: string; markdown: string; error?: string }) {
  const page = `/${feed}`;
  const { run, error, setError, pending, setPending, router } = useApiForm(page, initialError);
  const [text, setText] = useState(markdown);
  const images = usePendingImages(feed);
  const [editing, setEditing] = useState(!!initialError);
  const base = `${page}/${id}`;

  const opts = () => ({ baseUrl: window.location.origin, path: { feed, id } }); // in handlers only: no window while rendering on the server
  async function save(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    const refused = await images.flush();
    if (refused) {
      setError(refused);
      return setPending(false);
    }
    run(undefined, () => editNote({ ...opts(), body: { markdown: images.apply(text) } }), () => {
      setError(undefined);
      setEditing(false);
      setPending(false);
      router.replace(`${base}?edited=1`);
      router.refresh();
    });
  }
  const remove = (e: FormEvent) => run(e, () => deleteNote(opts()), () => router.replace(`${page}?deleted=${id}`), 404); // already gone: the goal is met

  return (
    <section aria-label="Edit or delete this note" className="mt-8 space-y-3 text-sm">
      {kind !== "image" && (
      <details open={editing} onToggle={(e) => setEditing(e.currentTarget.open)}>
        <summary className={summary}>Edit</summary>
        <form method="post" action={`${base}/edit`} encType="multipart/form-data" onSubmit={save} className="mt-3">
          <MarkdownInput
            id="edit-markdown"
            name="markdown"
            label="Note in markdown"
            value={text}
            onChange={setText}
            rows={10}
            describedBy="note-actions-error"
            className="font-mono"
            pending={images.pending}
            onPendingChange={images.setPending}
          />
          <button type="submit" disabled={pending} className="mt-2 rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon disabled:opacity-60">
            {pending ? "Saving…" : "Save"}
          </button>
        </form>
      </details>
      )}
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
