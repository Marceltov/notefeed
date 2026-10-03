"use client";

import { useState, type FormEvent } from "react";
import { deleteNote, editNote, patchNote } from "@/app/_lib/api";
import { MarkdownInput } from "@/components/MarkdownInput";
import { usePendingImages } from "@/components/usePendingImages";
import { useApiForm } from "@/app/_lib/useApiForm";

const summary = "cursor-pointer select-none text-muted hover:text-ink";

// Edit and delete for a note: plain forms to POST /<feed>/<id>/edit and /delete. With JavaScript they go
// through the generated API client and show refusals inline; without, the browser follows the 303 and the
// note page shows the outcome (`error` is its message).
export function NoteActions({ feed, id, kind, markdown, title: savedTitle, alt: savedAlt, error: initialError }: { feed: string; id: string; kind: string; markdown: string; title: string; alt: string; error?: string }) {
  const page = `/${feed}`;
  const { run, error, setError, pending, setPending, router } = useApiForm(page, initialError);
  const [text, setText] = useState(markdown);
  const [title, setTitle] = useState(savedTitle); // the title set by hand: empty means the one the text gives
  const [alt, setAlt] = useState(savedAlt);
  const image = kind === "image";
  const images = usePendingImages(feed);
  const [editing, setEditing] = useState(!!initialError);
  const base = `${page}/${id}`;

  const opts = () => ({ baseUrl: window.location.origin, path: { feed, id } }); // in handlers only: no window while rendering on the server
  async function save(e: FormEvent) {
    e.preventDefault();
    // Only what changed is sent: a text note's content is replaced (PUT) when its text changed or pictures were added, and its title set (PATCH)
    // when that changed; a picture has no text, only a title and an alt text. Nothing changed: nothing is sent.
    const textChanged = !image && (text !== markdown || images.pending.length > 0);
    const meta = { ...(title !== savedTitle && { title }), ...(image && alt !== savedAlt && { alt }) };
    const metaChanged = Object.keys(meta).length > 0;
    if (!textChanged && !metaChanged) return setEditing(false);
    setPending(true);
    const refused = await images.flush();
    if (refused) {
      setError(refused);
      return setPending(false);
    }
    const call = async () => {
      let last: { response?: Response; error?: { code?: string } } | undefined;
      if (textChanged) {
        last = await editNote({ ...opts(), body: new Blob([images.apply(text)], { type: "text/markdown" }), headers: { "Content-Type": "text/markdown" } });
        if (!last.response?.ok) return last;
      }
      if (metaChanged) last = await patchNote({ ...opts(), body: meta });
      return last!;
    };
    run(undefined, call, () => {
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
      <details open={editing} onToggle={(e) => setEditing(e.currentTarget.open)}>
        <summary className={summary}>Edit</summary>
        <form onSubmit={save} className="mt-3">
          {!image && (
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
          )}
          <label htmlFor="edit-title" className="mt-2 block text-muted">
            Title {image ? "(optional)" : "(optional, otherwise taken from the text)"}
          </label>
          <input id="edit-title" name="title" maxLength={100} autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full max-w-md rounded-sm border border-rule bg-transparent px-3 py-1.5 focus:border-carbon focus:outline-none" />
          {image && (
            <>
              <label htmlFor="edit-alt" className="mt-2 block text-muted">
                Alternative text (optional, for screen readers)
              </label>
              <input id="edit-alt" name="alt" maxLength={500} autoComplete="off" value={alt} onChange={(e) => setAlt(e.target.value)} className="mt-1 w-full max-w-md rounded-sm border border-rule bg-transparent px-3 py-1.5 focus:border-carbon focus:outline-none" />
            </>
          )}
          <button type="submit" disabled={pending} className="mt-2 rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon disabled:opacity-60">
            {pending ? "Saving…" : "Save"}
          </button>
        </form>
      </details>
      <details>
        <summary className={summary}>Delete</summary>
        <form onSubmit={remove} className="mt-3">
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
