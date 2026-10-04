"use client";

import { useState } from "react";
import { multipartBody } from "@/app/_lib/useApiForm";
import { onlyReferences, type Pending } from "@/components/pendingFiles";

/**
 * The compose box's request body: undefined when no picture waits (the box posts raw), else the text and the pictures in one
 * multipart body, without the text when it holds nothing but the pictures' references (the server then makes only the pictures,
 * and the title and tags go on them).
 */
export async function pendingBody(text: string, pending: Pending[]): Promise<FormData | undefined> {
  if (pending.length === 0) return undefined;
  return multipartBody(onlyReferences(text, pending.map((p) => p.token)) ? undefined : text, pending);
}

// The pictures waiting in a note box (for MarkdownInput), and the compose box's body of them with its text.
export function usePendingImages() {
  const [pending, setPending] = useState<Pending[]>([]);
  return { pending, setPending, body: (text: string) => pendingBody(text, pending) };
}
