"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { postNote } from "@/app/_lib/api";
import { encodeHeaderValue } from "@/shared/headers";
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

// Posts one image to the feed as a note of its own (the generated client; the server checks the bytes against the declared type) and returns the
// note's id and file name, or the refusal's message. `password` is only for the post that creates a protected feed; `meta` is a title and tags to put on the picture. Shared by the
// markdown boxes and the title image.
export async function postFile(feed: string, file: File, password?: string, meta: { title?: string; tags?: string[] } = {}): Promise<{ id: string; file: string; url: string } | { error: string }> {
  try {
    const { data, error, response } = await postNote({
      baseUrl: window.location.origin,
      path: { feed },
      body: file,
      headers: {
        "Content-Type": file.type, // the server accepts only the types it lists, and checks the bytes against it
        ...(password && { "X-Feed-Password": password }),
        ...(meta.title && { "X-Note-Title": encodeHeaderValue(meta.title) }),
        ...(meta.tags?.length && { "X-Note-Tags": meta.tags.join(",") }),
      },
    });
    if (!response) throw new Error("no response");
    if (response.ok && data?.file) return { id: data.id, file: data.file, url: data.file_url ?? "" };
    return { error: imageErrorMessage((error as { code?: string } | undefined)?.code ?? "unknown", response.headers.get("retry-after")) ?? "Something went wrong." };
  } catch {
    return { error: "Could not reach notefeed. Check your connection and try again." };
  }
}
