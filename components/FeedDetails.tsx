"use client";

import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { deleteFeed, updateFeed } from "@/app/_lib/api";
import { feedDetailsErrorMessage } from "@/app/_lib/messages";
import { uploadImageFile, useApiForm } from "@/app/_lib/useApiForm";

const input = "w-full rounded-sm border border-rule bg-transparent px-3 py-1.5 focus:border-carbon focus:outline-none";
const summary = "cursor-pointer select-none text-muted hover:text-ink";

// A feed's title and description, and deleting it: plain forms to POST /<feed>/settings and /delete. With
// JavaScript they go through the generated API client and show refusals inline; without, the browser follows
// the 303 (the feed page says "Saved." or shows the refusal as `error`, or the home page says "Feed deleted.").
export function FeedDetails({ feed, title: savedTitle, description: savedDescription, image, imageUrl, error: initialError }: { feed: string; title: string; description: string; image: string; imageUrl: string | null; error?: string }) {
  const page = `/${feed}`;
  const { run, error, setError, pending, setPending, router } = useApiForm(page, initialError, feedDetailsErrorMessage);
  const [title, setTitle] = useState(savedTitle);
  const [description, setDescription] = useState(savedDescription);
  const [confirm, setConfirm] = useState("");
  // False while rendering on the server, true once hydrated: without JavaScript the delete button stays enabled
  // and the server checks the name.
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const opts = () => ({ baseUrl: window.location.origin, path: { feed } }); // in handlers only: no window while rendering on the server

  const picker = useRef<HTMLInputElement>(null);
  const save = (e: FormEvent | undefined, body: { title: string; description: string; image?: string } = { title, description }) =>
    run(e, () => updateFeed({ ...opts(), body }), () => {
      setError(undefined);
      setPending(false);
      router.replace(`${page}?saved=1`);
      router.refresh();
    });
  // The title image saves on its own, with the saved title and description (not unsaved edits in the form).
  async function choose(file: File) {
    setError(undefined);
    setPending(true);
    const up = await uploadImageFile(feed, file);
    if ("error" in up) {
      setError(up.error);
      setPending(false);
    } else save(undefined, { title: savedTitle, description: savedDescription, image: up.file });
  }
  const remove = (e: FormEvent) => run(e, () => deleteFeed(opts()), () => router.replace("/?deleted=" + feed), 404); // already gone: the goal is met

  return (
    <section aria-label="Feed details" className="mb-10 space-y-3 text-sm">
      <details>
        <summary className={summary}>Feed settings</summary>
        <form method="post" action={`${page}/settings`} onSubmit={(e) => save(e)} className="mt-3 max-w-md">
          <label htmlFor="feed-title" className="mb-1 block text-muted">
            Title
          </label>
          <input id="feed-title" name="title" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} className={`${input} mb-2`} />
          <label htmlFor="feed-description" className="mb-1 block text-muted">
            Description
          </label>
          <input id="feed-description" name="description" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} className={`${input} mb-2`} />
          <button type="submit" disabled={pending} className="rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon disabled:opacity-60">
            Save
          </button>
        </form>
        {hydrated && (
          <div className="mt-4 max-w-md">
            <p className="mb-1 text-muted">Title image</p>
            {imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="Current title image" loading="lazy" className="mb-2 h-16 w-auto max-w-full rounded-sm object-contain" />
            )}
            <input
              ref={picker}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              hidden
              aria-label="Image for the feed header"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) choose(file);
              }}
            />
            <button type="button" disabled={pending} onClick={() => picker.current?.click()} className="rounded-sm border border-rule px-3 py-1 font-bold disabled:opacity-60">
              Choose image
            </button>
            {image && (
              <button
                type="button"
                disabled={pending}
                onClick={() => save(undefined, { title: savedTitle, description: savedDescription, image: "" })}
                className="ml-2 rounded-sm border border-rule px-3 py-1 text-muted disabled:opacity-60"
              >
                Remove image
              </button>
            )}
          </div>
        )}
      </details>
      <details>
        <summary className={summary}>Delete feed</summary>
        <form method="post" action={`${page}/delete`} onSubmit={remove} className="mt-3 max-w-md">
          <p className="text-muted">This deletes the feed and all its notes. It can&apos;t be undone. Type the feed&apos;s name to confirm.</p>
          <label htmlFor="feed-confirm" className="mb-1 mt-2 block text-muted">
            Feed name
          </label>
          <input
            id="feed-confirm"
            name="confirm"
            autoComplete="off"
            required
            pattern={feed}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={`${input} mb-2`}
          />
          <button type="submit" disabled={pending || (hydrated && confirm !== feed)} className="rounded-sm border border-error px-4 py-1.5 font-bold text-error disabled:opacity-60">
            Delete feed
          </button>
        </form>
      </details>
      <p role="alert" className="text-error">
        {error}
      </p>
    </section>
  );
}
