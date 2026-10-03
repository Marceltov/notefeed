"use client";

import { ImagePlus, Trash2, X, SlidersHorizontal } from "lucide-react";
import { useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { deleteFeed, updateFeed } from "@/app/_lib/api";
import { heading } from "@/components/styles";
import { feedDetailsErrorMessage } from "@/app/_lib/messages";
import { uploadImageFile, useApiForm } from "@/app/_lib/useApiForm";

const input = "w-full rounded-sm border border-rule bg-transparent px-3 py-1.5 focus:border-carbon focus:outline-none";
const secondary = "inline-flex items-center gap-1.5 rounded-sm border border-rule px-3 py-1 font-bold hover:border-carbon disabled:opacity-60";

// A feed's title, description and title image, and deleting it: plain forms to POST /<feed>/details and /delete.
// `children` (the sharing and password sections) sit between the two, so deleting stays last. With
// JavaScript they go through the generated API client and show refusals inline; without, the browser follows
// the 303 (the feed page says "Saved." or shows the refusal as `error`, or the home page says "Feed deleted.").
export function FeedDetails({ feed, title: savedTitle, description: savedDescription, image, imageUrl, showSender: savedShowSender, readId, readIdChoice, identity, error: initialError, children }: { children?: ReactNode; feed: string; title: string; description: string; image: string; imageUrl: string | null; showSender: boolean; readId: string | null; readIdChoice: "custom" | "random" | "fixed"; identity: boolean; error?: string }) {
  const page = `/${feed}/settings`;
  const { run, error, setError, pending, setPending, router } = useApiForm(page, initialError, feedDetailsErrorMessage);
  const [title, setTitle] = useState(savedTitle);
  const [description, setDescription] = useState(savedDescription);
  const [showSender, setShowSender] = useState(savedShowSender);
  const [readIdValue, setReadIdValue] = useState(readId ?? "");
  const [confirm, setConfirm] = useState("");
  // False while rendering on the server, true once hydrated: without JavaScript the delete button stays enabled
  // and the server checks the name.
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const opts = () => ({ baseUrl: window.location.origin, path: { feed } }); // in handlers only: no window while rendering on the server

  const picker = useRef<HTMLInputElement>(null);
  // The read id goes along with every save while it can be chosen; an unchanged one is no change to the server.
  const save = (e: FormEvent | undefined, body: { title: string; description: string; image?: string; show_sender?: boolean; read_id?: string } = { title, description, ...(identity && { show_sender: showSender }), ...(readIdChoice === "custom" && readId && { read_id: readIdValue }) }) =>
    run(e, () => updateFeed({ ...opts(), body }), () => {
      setError(undefined);
      setPending(false);
      router.replace(`${page}?saved=1`);
      router.refresh();
    });
  // The title image saves on its own, with the title and description as they stand in the form.
  async function choose(file: File) {
    setError(undefined);
    setPending(true);
    const up = await uploadImageFile(feed, file);
    if ("error" in up) {
      setError(up.error);
      setPending(false);
    } else save(undefined, { title, description, image: up.file, ...(identity && { show_sender: showSender }) });
  }
  const remove = (e: FormEvent) => run(e, () => deleteFeed(opts()), () => router.replace("/?deleted=" + feed), 404); // already gone: the goal is met

  return (
    <div className="space-y-10 text-sm">
      <section aria-labelledby="general">
        <h2 id="general" className={heading}>
          <SlidersHorizontal aria-hidden className="h-4 w-4" />
          General
        </h2>
        <form method="post" action={`/${feed}/details`} onSubmit={(e) => save(e)} className="max-w-md">
          <label htmlFor="feed-title" className="mb-1 block text-muted">
            Title
          </label>
          <input id="feed-title" name="title" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} className={`${input} mb-2`} />
          <label htmlFor="feed-description" className="mb-1 block text-muted">
            Description
          </label>
          <input id="feed-description" name="description" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} className={`${input} mb-2`} />
          {identity && (
            <label className="mb-3 flex items-center gap-2">
              <input type="hidden" name="show_sender_present" value="1" />
              <input type="checkbox" name="show_sender" checked={showSender} onChange={(e) => setShowSender(e.target.checked)} />
              Show who posted
            </label>
          )}
          {readIdChoice !== "fixed" && readId && (
            <div className="mb-3">
              {readIdChoice === "custom" && (
                <>
                  <label htmlFor="feed-read-id" className="mb-1 block text-muted">
                    Read id
                  </label>
                  <input id="feed-read-id" name="read_id" minLength={3} maxLength={64} spellCheck={false} autoComplete="off" value={readIdValue} onChange={(e) => setReadIdValue(e.target.value)} className={`${input} mb-2 font-mono`} />
                </>
              )}
              <button type="submit" name="generate_read_id" value="1" formNoValidate disabled={pending} onClick={(e) => { if (hydrated) { e.preventDefault(); save(undefined, { title, description, ...(identity && { show_sender: showSender }), read_id: "" }); } }} className={`${secondary} font-normal`}>
                Generate a random one
              </button>
              <p className="mt-2 text-muted">
                The read id is in the read link and the RSS link. {readIdChoice === "custom" && "3 to 64 characters: a–z, 0–9, - and _. "}A short, readable one can be guessed: protect the feed with a password if that matters. The old link stops showing this feed and may later show another one. Image links in your notes that are relative follow the new id; full URLs don&apos;t, and you change those yourself.
              </p>
            </div>
          )}
          <button type="submit" disabled={pending} className="rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon disabled:opacity-60">
            Save changes
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
            <button type="button" disabled={pending} onClick={() => picker.current?.click()} className={secondary}>
              <ImagePlus aria-hidden className="h-4 w-4" />
              Choose image
            </button>
            {image && (
              <button
                type="button"
                disabled={pending}
                onClick={() => save(undefined, { title, description, image: "", ...(identity && { show_sender: showSender }) })}
                className={`${secondary} ml-2 font-normal text-muted`}
              >
                <X aria-hidden className="h-4 w-4" />
                Remove image
              </button>
            )}
          </div>
        )}
      </section>
      {children}
      <section aria-labelledby="delete" className="border-t border-rule pt-6">
        <h2 id="delete" className={`${heading} text-error`}>
          <Trash2 aria-hidden className="h-4 w-4" />
          Delete feed
        </h2>
        <form method="post" action={`/${feed}/delete`} onSubmit={remove} className="max-w-md">
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
          <button type="submit" disabled={pending || (hydrated && confirm !== feed)} className="inline-flex items-center gap-2 rounded-sm border border-error px-4 py-1.5 font-bold text-error disabled:opacity-60">
            <Trash2 aria-hidden className="h-4 w-4" />
            Delete feed
          </button>
        </form>
      </section>
      <p role="alert" className="text-error">
        {error}
      </p>
    </div>
  );
}
