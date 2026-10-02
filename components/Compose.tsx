"use client";

import { Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import { postNote } from "@/app/_lib/api";
import { MarkdownInput } from "@/components/MarkdownInput";
import { useApiForm } from "@/app/_lib/useApiForm";
import { PASSWORD_HINT, SENDER_NOTICE } from "@/app/_lib/messages";
import { extractTitle, idStamp, slugify } from "@/shared/notes";
import { PASSWORD_PATTERN } from "@/shared/password";
import { TAGS_HINT, TAGS_PATTERN } from "@/shared/tags";

// A plain multipart form to POST /<feed>, the same endpoint scripts use: without JavaScript the browser
// follows the 303 back to the feed page. With JavaScript the box posts through the API client generated
// from openapi.json (JSON, the session cookie rides along same-origin) and shows refusals inline.
// `exists`: false for a feed without a first note, which cannot take image uploads yet.
// `isNew`: a feed that doesn't exist yet, so the box offers to protect it with a password.
export function Compose({ feed, action, error: initialError, isNew, exists = true, sender }: { feed: string; action: string; error?: string; isNew?: boolean; exists?: boolean; sender?: boolean }) {
  const { run, error, pending, router } = useApiForm(action, initialError);
  const [text, setText] = useState("");
  const [password, setPassword] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false); // an image is uploading
  const filename = `${idStamp(new Date())}-${slugify(extractTitle(text))}.md`;

  const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
  const submit = (e: FormEvent) =>
    run(e, () => postNote({ baseUrl: window.location.origin, path: { feed }, body: { markdown: text, ...(password && { password }), ...(tagList.length && { tags: tagList }) } }), ({ data }) => router.push(`${action}?posted=${data?.id}`)); // the page remounts this box empty

  return (
    <form method="post" action={action} encType="multipart/form-data" onSubmit={submit} className="mb-12">
      <MarkdownInput
        id="markdown"
        name="markdown"
        label="Note in markdown"
        value={text}
        onChange={setText}
        feed={feed}
        rows={5}
        placeholder="# Write a note in markdown"
        describedBy="compose-hint compose-error"
        images={exists}
        onBusy={setBusy}
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
          disabled={pending || busy}
          className="inline-flex items-center gap-2 rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon disabled:opacity-60"
        >
          <Send aria-hidden className="h-4 w-4" />
          {pending ? "Posting…" : "Post note"}
        </button>
      </div>
      <div className="mt-2 text-sm">
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
          className="w-full max-w-sm rounded-sm border border-rule bg-transparent px-3 py-1.5 focus:border-carbon focus:outline-none"
        />
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
