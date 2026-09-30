"use client";

import { useActionState, useState } from "react";
import { postNoteAction } from "@/app/actions";
import { extractTitle, idStamp, slugify } from "@/lib/slug";

export function Compose({ feed }: { feed: string }) {
  const [text, setText] = useState("");
  const [error, action, pending] = useActionState(postNoteAction.bind(null, feed), null);
  const filename = `${idStamp(new Date())}-${slugify(extractTitle(text))}.md`;

  return (
    <form action={action} className="mb-12">
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
