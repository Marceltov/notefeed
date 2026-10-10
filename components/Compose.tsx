"use client";

import { Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import { postNote } from "@/app/_lib/api";
import { encodeHeaderValue } from "@/shared/headers";
import { MarkdownInput } from "@/components/MarkdownInput";
import { usePendingImages } from "@/components/usePendingImages";
import { multipart, useApiForm } from "@/app/_lib/useApiForm";
import { errorMessage, PASSWORD_HINT, SENDER_NOTICE, withPictures } from "@/app/_lib/messages";
import { PASSWORD_PATTERN } from "@/shared/password";
import { TAGS_HINT, TAGS_PATTERN } from "@/shared/tags";

// The compose box posts through the API client generated from openapi.json (the session cookie rides along same-origin) and
// shows refusals inline: the text as a raw markdown post, or, with pictures dropped, pasted or picked (they wait in the box,
// usePendingImages), the text and the pictures in one multipart request, so nothing is half-posted.
// `isNew`: a feed that doesn't exist yet, so the box offers to protect it with a password. `images` false: the instance takes no pictures.
// `imageBase`: the feed's read link, for the preview's stored pictures.
export function Compose({ feed, action, error: initialError, isNew, sender, images: imagesOn = true, imageBase }: { feed: string; action: string; error?: string; isNew?: boolean; sender?: boolean; images?: boolean; imageBase?: string }) {
  const images = usePendingImages();
  const { run, error, setError, pending, router } = useApiForm(action, initialError, withPictures(errorMessage, images.pending.length > 0));
  const [text, setText] = useState("");
  const [password, setPassword] = useState("");
  const [tags, setTags] = useState("");
  const [title, setTitle] = useState("");

  const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
  const headers = {
    ...(title.trim() && { "X-Note-Title": encodeHeaderValue(title.trim()) }),
    ...(password && { "X-Feed-Password": password }),
    ...(tagList.length && { "X-Note-Tags": tagList.join(",") }),
  };
  // The page remounts this box empty. With pictures only, the answer is the first picture's.
  const submit = (e: FormEvent) =>
    run(
      e,
      async () => {
        const form = await images.body(text); // undefined: no pictures, a raw markdown post
        return postNote({
          baseUrl: window.location.origin,
          path: { feed },
          ...(form
            ? { ...multipart(form), headers: { ...headers, "Content-Type": null } }
            : { body: new Blob([text], { type: "text/markdown" }), headers: { ...headers, "Content-Type": "text/markdown" } }),
        });
      },
      ({ data }) => router.push(`${action}?posted=${data?.id}`),
    );

  return (
    <form onSubmit={submit} className="mb-12">
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
        onMessage={setError}
        images={imagesOn}
        imageBase={imageBase}
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
