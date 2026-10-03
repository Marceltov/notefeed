"use client";

import { useRef, useState } from "react";
import { postFile } from "@/app/_lib/useApiForm";
import { type Pending, substitute } from "@/components/pendingFiles";

// The pictures waiting in a note box, and what posting them takes: `flush` uploads the ones not yet sent (each becomes a note of its
// own), `apply` swaps the local names in the text for the notes' file names. A picture that was sent stays sent when a later step
// fails, so posting again does not make it twice; removing it from the list forgets it.
export function usePendingImages(feed: string) {
  const [pending, setPending] = useState<Pending[]>([]);
  const sent = useRef(new Map<string, { id: string; file: string }>()); // by Pending.key
  const last = useRef<string | undefined>(undefined);

  /** Posts the files not yet sent, in order, and stops at the first refusal. Returns its message, or undefined when all are sent. `password` is for the post that creates a protected feed, `meta` (a title, tags) goes on every picture. */
  async function flush(password?: string, meta?: { title?: string; tags?: string[] }): Promise<string | undefined> {
    for (const p of pending) {
      if (sent.current.has(p.key)) continue;
      const result = await postFile(feed, p.file, password, meta);
      if ("error" in result) return result.error;
      sent.current.set(p.key, { id: result.id, file: result.file });
      last.current = result.id;
    }
    return undefined;
  }

  const apply = (text: string) =>
    substitute(text, new Map(pending.flatMap((p) => (sent.current.has(p.key) ? [[p.token, sent.current.get(p.key)!.file] as const] : []))));

  return { pending, setPending, flush, apply, lastId: () => last.current };
}
