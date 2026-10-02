"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { uploadImage } from "@/app/_lib/api";
import { errorMessage, imageErrorMessage } from "@/app/_lib/messages";

type Result = { data?: unknown; error?: { code?: string }; response?: Response };

// The enhanced-form logic shared by the compose box and the edit and delete forms: `run` submits through a
// generated client call, `done` runs on success (or on status `doneOn`); a 401 goes to the feed page, which shows
// its unlock form (or proxy.ts sends a missing instance login on to /login); other refusals become `error`.
export function useApiForm(page: string, initialError?: string) {
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
      setError(errorMessage(error?.code ?? "unknown", response.headers.get("retry-after")));
    } catch {
      setError("Could not reach notefeed. Check your connection and try again.");
    }
    setPending(false);
  }

  return { run, error, setError, pending, setPending, router };
}

// Uploads one image to the feed (the generated client; the server decides the format by the bytes) and returns
// its file name and the markdown-ready URL, or the refusal's message. Shared by the markdown boxes and the title image.
export async function uploadImageFile(feed: string, file: File): Promise<{ file: string; url: string } | { error: string }> {
  try {
    const { data, error, response } = await uploadImage({ baseUrl: window.location.origin, path: { feed }, body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
    if (!response) throw new Error("no response");
    if (response.ok && data) return data;
    return { error: imageErrorMessage((error as { code?: string } | undefined)?.code ?? "unknown", response.headers.get("retry-after")) ?? "Something went wrong." };
  } catch {
    return { error: "Could not reach notefeed. Check your connection and try again." };
  }
}
