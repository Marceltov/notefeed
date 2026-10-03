"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { errorMessage, imageErrorMessage } from "@/app/_lib/messages";

type Result = { data?: unknown; error?: { code?: string }; response?: Response };

// The enhanced-form logic shared by the compose box and the edit and delete forms: `run` submits through a
// generated client call, `done` runs on success (or on status `doneOn`); a 401 goes to the feed page, which shows
// its unlock form (or proxy.ts sends a missing instance login on to /login); other refusals become `error`,
// worded by `message`.
export function useApiForm(page: string, initialError?: string, message = errorMessage) {
  const router = useRouter();
  const [error, setError] = useState(initialError);
  const [pending, setPending] = useState(false);

  async function run<T extends Result>(e: FormEvent | undefined, call: () => Promise<T>, done: (result: T) => void, doneOn?: number) {
    e?.preventDefault();
    setPending(true);
    try {
      const result = await call();
      const { error, response } = result;
      if (!response) throw new Error("no response"); // the client returns a network failure instead of throwing it
      if (response.ok || response.status === doneOn) return done(result);
      if (response.status === 401) return router.push(page);
      setError(message(error?.code ?? "unknown", response.headers.get("retry-after")));
    } catch {
      setError("Could not reach notefeed. Check your connection and try again.");
    }
    setPending(false);
  }

  return { run, error, setError, pending, setPending, router };
}

// Posts one image to the feed as a note of its own (a multipart `file` part to the same endpoint scripts use; the server decides the
// format by the bytes) and returns the note's id and file name, or the refusal's message. `password` is only for the post that
// creates a protected feed. Shared by the markdown boxes and the title image.
export async function uploadImageFile(feed: string, file: File, password?: string): Promise<{ id: string; file: string; url: string } | { error: string }> {
  try {
    const form = new FormData();
    form.set("file", file);
    if (password) form.set("password", password);
    const res = await fetch(`/api/v1/feeds/${encodeURIComponent(feed)}/notes`, { method: "POST", body: form, headers: { Accept: "application/json" } });
    const body = (await res.json().catch(() => ({}))) as { id?: string; file?: string; file_url?: string | null; code?: string };
    if (res.ok && body.id && body.file) return { id: body.id, file: body.file, url: body.file_url ?? "" };
    return { error: imageErrorMessage(body.code ?? "unknown", res.headers.get("retry-after")) ?? "Something went wrong." };
  } catch {
    return { error: "Could not reach notefeed. Check your connection and try again." };
  }
}
