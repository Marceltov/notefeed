"use client";

import { Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import { postNote } from "@/app/_lib/api";
import { encodeHeaderValue } from "@/shared/headers";
import { MarkdownInput } from "@/components/MarkdownInput";
import { onlyReferences } from "@/components/pendingFiles";
import { usePendingImages } from "@/components/usePendingImages";
import { useApiForm } from "@/app/_lib/useApiForm";
import { PASSWORD_HINT, SENDER_NOTICE } from "@/app/_lib/messages";
import { PASSWORD_PATTERN } from "@/shared/password";
import { TAGS_HINT, TAGS_PATTERN } from "@/shared/tags";

// A plain multipart form to POST /<feed>, the same endpoint scripts use: without JavaScript the browser
// follows the 303 back to the feed page. With JavaScript the box posts through the API client generated
// from openapi.json (JSON, the session cookie rides along same-origin) and shows refusals inline.
// Pictures dropped, pasted or picked wait in the box (usePendingImages) and are posted, as notes of their own, when the note is.
// `isNew`: a feed that doesn't exist yet, so the box offers to protect it with a password.
export function Compose({ feed, action, error: initialError, isNew, sender }: { feed: string; action: string; error?: string; isNew?: boolean; sender?: boolean }) {
  const { run, error, setError, pending, setPending, router } = useApiForm(action, initialError);
  const images = usePendingImages(feed);
  const [text, setText] = useState("");
  const [password, setPassword] = useState("");
  const [tags, setTags] = useState("");
  const [title, setTitle] = useState("");

  const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    // Pictures alone make no text note, so what was typed as its title and tags goes on the pictures instead of being lost.
    const picturesOnly = onlyReferences(text, images.pending.map((p) => p.token));
    const refused = await images.flush(password, picturesOnly ? { title: title.trim(), tags: tagList } : undefined); // the first one of these creates the feed, with its password
    if (refused) {
      setError(refused);
      return setPending(false);
    }
    const posted = images.lastId();
    if (posted && picturesOnly) return router.push(`${action}?posted=${posted}`); // only pictures: no note of text
    // The page remounts this box empty.
    run(
      undefined,
      () =>
        postNote({
          baseUrl: window.location.origin,
          path: { feed },
          body: new Blob([images.apply(text)], { type: "text/markdown" }),
          headers: {
            "Content-Type": "text/markdown",
            ...(title.trim() && { "X-Note-Title": encodeHeaderValue(title.trim()) }),
            ...(password && { "X-Feed-Password": password }),
            ...(tagList.length && { "X-Note-Tags": tagList.join(",") }),
          },
        }),
      ({ data }) => router.push(`${action}?posted=${data?.id}`),
    );
  }

  return (
    <form method="post" action={action} encType="multipart/form-data" onSubmit={submit} className="mb-12">
      <MarkdownInput
        id="markdown"
        name="markdown"
        label="Note in markdown"
        value={text}
        onChange={setText}
        rows={5}
        placeholder="# Write a note in markdown"
        describedBy="compose-hint compose-error"
        pending={images.pending}
        onPendingChange={images.setPending}
      >
        <label htmlFor="note-title" className="sr-only">
          Title (optional, otherwise taken from the text)
        </label>
        <input
          id="note-title"
          name="title"
          type="text"
          autoComplete="off"
          maxLength={100}
          placeholder="Title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="min-w-0 flex-1 rounded-sm border border-rule bg-transparent px-3 py-1 focus:border-carbon focus:outline-none sm:max-w-xs"
        />
        <label htmlFor="note-tags" className="sr-only">
          Tags (optional, separated by commas)
        </label>
        <input
          id="note-tags"
          name="tags"
          type="text"
          autoComplete="off"
          placeholder="Tags, e.g. ci, deploy"
          pattern={TAGS_PATTERN}
          title={TAGS_HINT}
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className="min-w-0 flex-1 rounded-sm border border-rule bg-transparent px-3 py-1 focus:border-carbon focus:outline-none sm:max-w-xs"
        />
      </MarkdownInput>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <p id="compose-hint" className="min-w-0 break-all text-sm text-muted" />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon disabled:opacity-60"
        >
          <Send aria-hidden className="h-4 w-4" />
          {pending ? "Posting…" : "Post note"}
        </button>
      </div>
      {isNew && (
        <div className="mt-2 text-sm">
          <label htmlFor="new-feed-password" className="mb-1 block text-muted">
            Password (optional, protects this feed)
          </label>
          <input
            id="new-feed-password"
            name="password"
            type="password"
            autoComplete="new-password"
            maxLength={256}
            pattern={PASSWORD_PATTERN}
            title={PASSWORD_HINT}
            aria-describedby="new-feed-password-hint"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full max-w-sm rounded-sm border border-rule bg-transparent px-3 py-1.5 focus:border-carbon focus:outline-none"
          />
          <p id="new-feed-password-hint" className="mt-1 text-muted">
            {PASSWORD_HINT}
          </p>
        </div>
      )}
      {sender && <p className="mt-2 text-sm text-muted">{SENDER_NOTICE}</p>}
      <p id="compose-error" role="alert" className="mt-2 text-sm text-error">
        {error}
      </p>
    </form>
  );
}
